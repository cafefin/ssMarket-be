import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { OutboxRepository } from '../events/outbox.repository.js';
import { ChatChannelRepository } from '../modules/chat-channel/chat-channel.repository.js';
import { vietnamHourKey } from '../modules/chat-channel/chat-format.js';
import { ChatDeliveryService } from '../modules/chat-channel/chat-delivery.service.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

const DAY_MS = 86_400_000;
const LOCK_SECONDS = 7200;

/**
 * Minute ticker: the Google Chat digest once per Vietnam clock hour and the
 * cleanup of old data once per hour. Redis locks make several workers run
 * each job once.
 */
@Injectable()
export class Maintenance {
  private readonly logger = new Logger(Maintenance.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = true;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly chat: ChatDeliveryService,
    private readonly outbox: OutboxRepository,
    private readonly notifications: NotificationsService,
    private readonly deliveries: ChatChannelRepository,
  ) {}

  async tick(now = new Date()): Promise<void> {
    const hour = vietnamHourKey(now);
    if (await this.claim(`chat:digest:${hour}`)) {
      try {
        await this.chat.runDigest(now);
      } catch (error) {
        this.logger.error(`Digest failed: ${(error as Error).message}`);
      }
    }
    if (await this.claim(`chat:cleanup:${hour}`)) {
      await this.cleanup(now);
    }
  }

  start(intervalMs = 60_000): void {
    if (!this.stopped) return;
    this.stopped = false;
    const run = (): void => {
      this.running = this.tick()
        .catch((error: unknown) =>
          this.logger.error(`Tick failed: ${(error as Error).message}`),
        )
        .finally(schedule);
    };
    const schedule = (): void => {
      if (this.stopped) return;
      this.timer = setTimeout(run, intervalMs);
    };
    run();
  }

  /** Stops scheduling and waits for a tick in progress. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async claim(key: string): Promise<boolean> {
    return (await this.redis.set(key, '1', 'EX', LOCK_SECONDS, 'NX')) === 'OK';
  }

  private async cleanup(now: Date): Promise<void> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const outbox = await this.outbox.deletePublishedBefore(before(7));
    const notifications = await this.notifications.deleteOlderThan(before(90));
    const deliveries = await this.deliveries.deleteCreatedBefore(before(30));
    if (outbox + notifications + deliveries > 0) {
      this.logger.log(
        `Cleanup deleted ${outbox} outbox events, ${notifications} notifications, ${deliveries} chat deliveries`,
      );
    }
  }
}
