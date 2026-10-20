import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AmqpConnectionManager,
  type ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { WorkerEnvironmentVariables } from '../config/env.validation.js';
import { assertTopology, EVENTS_EXCHANGE } from './topology.js';

/** Properties copied when a message is moved to another queue (the DLQ). */
export interface ForwardedProperties {
  headers: Record<string, unknown> | undefined;
  messageId?: string;
  type?: string;
  contentType?: string;
}

export interface RabbitMessage extends ForwardedProperties {
  content: Buffer;
  /** The channel generation that delivered it; delivery tags are per channel. */
  generation: number;
  raw: ConsumeMessage;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Thin wrapper over amqp-connection-manager: confirms, reconnects, topology. */
@Injectable()
export class RabbitClient {
  private readonly logger = new Logger(RabbitClient.name);
  private readonly connection: AmqpConnectionManager;
  private readonly channel: ChannelWrapper;
  /**
   * Bumped for every new amqplib channel (in `setup`, which runs before the
   * consumers are re-registered on it) and when the wrapper closes. The
   * wrapper's `connect` event fires only after the consumers are back, so
   * bumping there would orphan the first deliveries on the new channel.
   */
  private generation = 0;

  constructor(config: ConfigService<WorkerEnvironmentVariables, true>) {
    this.connection = connect([config.get('RABBITMQ_URL', { infer: true })]);
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`RabbitMQ disconnected: ${err?.message}`),
    );
    this.channel = this.connection.createChannel({
      json: false,
      confirm: true,
      publishTimeout: 5_000,
      setup: (channel: ConfirmChannel) => {
        this.generation += 1;
        return assertTopology(channel);
      },
    });
    this.channel.on('close', () => {
      this.generation += 1;
    });
    // Emitted when setup fails or a consumer cannot be re-established;
    // without a listener Node would throw an uncaught exception.
    this.channel.on('error', (err: unknown) =>
      this.logger.error(
        `RabbitMQ channel error: ${errorText(err)}`,
      ),
    );
  }

  /** Resolves once the topology exists on the broker. */
  waitForConnect(): Promise<void> {
    return this.channel.waitForConnect();
  }

  /** Resolves when the broker confirmed the message; rejects after 5 s. */
  publish(
    routingKey: string,
    body: Buffer,
    options: { messageId: string; type: string },
  ): Promise<void> {
    return this.channel
      .publish(EVENTS_EXCHANGE, routingKey, body, {
        persistent: true,
        contentType: 'application/json',
        messageId: options.messageId,
        type: options.type,
      })
      .then(() => undefined);
  }

  sendToQueue(
    queue: string,
    body: Buffer,
    properties: ForwardedProperties,
  ): Promise<void> {
    return this.channel
      .sendToQueue(queue, body, { persistent: true, ...properties })
      .then(() => undefined);
  }

  async consume(
    queue: string,
    onMessage: (message: RabbitMessage) => Promise<void>,
    prefetch: number,
  ): Promise<string> {
    const { consumerTag } = await this.channel.consume(
      queue,
      (raw) => {
        const { properties } = raw;
        const message: RabbitMessage = {
          content: raw.content,
          headers: properties.headers as Record<string, unknown> | undefined,
          messageId: properties.messageId as string | undefined,
          type: properties.type as string | undefined,
          contentType: properties.contentType as string | undefined,
          generation: this.generation,
          raw,
        };
        // QueueConsumer.handle catches handler errors itself; this only covers
        // a failure of handle (or a synchronous throw) and never throws out.
        Promise.resolve()
          .then(() => onMessage(message))
          .catch((error: unknown) => {
            this.logger.error(
              `Handler for ${queue} failed on message ${message.messageId ?? '(no id)'}: ${errorText(error)}`,
            );
            this.reject(message);
          });
      },
      { prefetch },
    );
    return consumerTag;
  }

  cancel(consumerTag: string): Promise<void> {
    return this.channel.cancel(consumerTag);
  }

  /** Never throws; a no-op for a message from a channel that was replaced. */
  ack(message: RabbitMessage): void {
    this.settle(message, 'ack', () => this.channel.ack(message.raw));
  }

  /**
   * Rejects without requeue, so the queue dead-letters it to its retry queue.
   * Never throws; a no-op for a message from a channel that was replaced.
   */
  reject(message: RabbitMessage): void {
    this.settle(message, 'nack', () =>
      this.channel.nack(message.raw, false, false),
    );
  }

  private settle(message: RabbitMessage, action: string, run: () => void): void {
    const id = message.messageId ?? '(no id)';
    if (message.generation !== this.generation) {
      // The channel that delivered it closed, so the broker requeued it; its
      // tag would point at another message on the current channel.
      this.logger.warn(`Skipped ${action} of message ${id}: its channel closed`);
      return;
    }
    try {
      run();
    } catch (error) {
      this.logger.error(`RabbitMQ ${action} of message ${id} failed: ${errorText(error)}`);
    }
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
