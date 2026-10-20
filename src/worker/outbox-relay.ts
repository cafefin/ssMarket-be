import { Injectable, Logger } from '@nestjs/common';
import { OutboxRepository } from '../events/outbox.repository.js';
import { RabbitClient } from './rabbit.client.js';

const BATCH_SIZE = 100;

/** Publishes unsent outbox rows to RabbitMQ and marks them sent. */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = true;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly rabbit: RabbitClient,
  ) {}

  /** One pass; returns how many rows were published. */
  async runOnce(): Promise<number> {
    return this.outbox.transaction(async (tx) => {
      const rows = await this.outbox.lockUnpublished(tx, BATCH_SIZE);
      const published: string[] = [];
      const failed: string[] = [];
      for (const row of rows) {
        const envelope = {
          id: row.id,
          type: row.type,
          version: 1,
          occurredAt: row.occurredAt.toISOString(),
          payload: row.payload,
        };
        try {
          await this.rabbit.publish(
            row.type,
            Buffer.from(JSON.stringify(envelope)),
            { messageId: row.id, type: row.type },
          );
          published.push(row.id);
        } catch (error) {
          failed.push(row.id);
          this.logger.warn(
            `Publish of ${row.type} ${row.id} failed: ${(error as Error).message}`,
          );
          // The broker is likely down; later rows must not overtake this one.
          break;
        }
      }
      if (published.length > 0) {
        await this.outbox.markPublished(tx, published, new Date());
      }
      if (failed.length > 0) {
        await this.outbox.bumpAttempts(tx, failed);
      }
      return published.length;
    });
  }

  start(intervalMs = 1000): void {
    if (!this.stopped) return;
    this.stopped = false;
    const schedule = (): void => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.running = this.runOnce()
          .catch((error: unknown) =>
            this.logger.error(`Outbox pass failed: ${(error as Error).message}`),
          )
          .finally(schedule);
      }, intervalMs);
    };
    schedule();
  }

  /** Stops scheduling and waits for a pass in progress. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
