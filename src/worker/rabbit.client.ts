import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  type AmqpConnectionManager,
  type ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { WorkerEnvironmentVariables } from '../config/env.validation.js';
import { assertTopology, EVENTS_EXCHANGE } from './topology.js';

export const RABBIT_CLIENT = Symbol('RABBIT_CLIENT');

export interface RabbitMessage {
  content: Buffer;
  headers: Record<string, unknown> | undefined;
  raw: ConsumeMessage;
}

/** Thin wrapper over amqp-connection-manager: confirms, reconnects, topology. */
@Injectable()
export class RabbitClient {
  private readonly logger = new Logger(RabbitClient.name);
  private readonly connection: AmqpConnectionManager;
  private readonly channel: ChannelWrapper;

  constructor(config: ConfigService<WorkerEnvironmentVariables, true>) {
    this.connection = connect([config.get('RABBITMQ_URL', { infer: true })]);
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`RabbitMQ disconnected: ${err?.message}`),
    );
    this.channel = this.connection.createChannel({
      json: false,
      confirm: true,
      publishTimeout: 5_000,
      setup: (channel: ConfirmChannel) => assertTopology(channel),
    });
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
    headers: Record<string, unknown> | undefined,
  ): Promise<void> {
    return this.channel
      .sendToQueue(queue, body, { persistent: true, headers })
      .then(() => undefined);
  }

  async consume(
    queue: string,
    onMessage: (message: RabbitMessage) => Promise<void>,
    prefetch: number,
  ): Promise<string> {
    const { consumerTag } = await this.channel.consume(
      queue,
      (raw) =>
        void onMessage({
          content: raw.content,
          headers: raw.properties.headers as Record<string, unknown> | undefined,
          raw,
        }),
      { prefetch },
    );
    return consumerTag;
  }

  cancel(consumerTag: string): Promise<void> {
    return this.channel.cancel(consumerTag);
  }

  ack(message: RabbitMessage): void {
    this.channel.ack(message.raw);
  }

  /** Rejects without requeue, so the queue dead-letters it to its retry queue. */
  reject(message: RabbitMessage): void {
    this.channel.nack(message.raw, false, false);
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
