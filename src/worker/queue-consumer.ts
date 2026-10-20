import type { LoggerService } from '@nestjs/common';
import { parseEnvelope } from '../events/domain-events.js';
import type { EventHandler } from './event-handlers.js';
import type { RabbitClient, RabbitMessage } from './rabbit.client.js';
import {
  afterFailure,
  deadLetterQueue,
  failedAttempts,
  MAX_ATTEMPTS,
} from './topology.js';

/** One queue, one handler: ack, retry through the retry queue, or dead-letter. */
export class QueueConsumer {
  private tag: string | undefined;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly rabbit: RabbitClient,
    private readonly queue: string,
    private readonly handler: EventHandler,
    private readonly logger: LoggerService,
  ) {}

  async start(prefetch = 5): Promise<void> {
    this.tag = await this.rabbit.consume(
      this.queue,
      (message) => this.track(this.handle(message)),
      prefetch,
    );
  }

  /** Stops taking messages, then waits for those in progress. */
  async stop(): Promise<void> {
    if (this.tag !== undefined) {
      await this.rabbit.cancel(this.tag);
      this.tag = undefined;
    }
    await Promise.allSettled(this.inFlight);
  }

  /** Exposed for tests: handles one delivery. */
  async handle(message: RabbitMessage): Promise<void> {
    const event = parseEnvelope(message.content.toString('utf8'));
    if (!event) {
      this.logger.error(`${this.queue}: unreadable message, sent to the DLQ`);
      await this.rabbit.sendToQueue(
        deadLetterQueue(this.queue),
        message.content,
        message.headers,
      );
      this.rabbit.ack(message);
      return;
    }
    try {
      await this.handler(event);
      this.rabbit.ack(message);
    } catch (error) {
      const previous = failedAttempts(message.headers, this.queue);
      const reason = (error as Error).message;
      if (afterFailure(previous) === 'retry') {
        this.logger.warn(
          `${this.queue}: ${event.type} ${event.id} failed (attempt ${previous + 1}/${MAX_ATTEMPTS}): ${reason}`,
        );
        this.rabbit.reject(message);
      } else {
        this.logger.error(
          `${this.queue}: ${event.type} ${event.id} failed ${MAX_ATTEMPTS} times, sent to the DLQ: ${reason}`,
        );
        await this.rabbit.sendToQueue(
          deadLetterQueue(this.queue),
          message.content,
          message.headers,
        );
        this.rabbit.ack(message);
      }
    }
  }

  private track(work: Promise<void>): Promise<void> {
    this.inFlight.add(work);
    const done = (): void => {
      this.inFlight.delete(work);
    };
    work.then(done, done);
    return work;
  }
}
