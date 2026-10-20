import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EVENT_HANDLERS, type EventHandlers } from './event-handlers.js';
import { Maintenance } from './maintenance.js';
import { OutboxRelay } from './outbox-relay.js';
import { QueueConsumer } from './queue-consumer.js';
import { RabbitClient } from './rabbit.client.js';

/** Starts the consumers, the outbox relay and the ticker; drains on shutdown. */
@Injectable()
export class WorkerRunner
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WorkerRunner.name);
  private consumers: QueueConsumer[] = [];

  constructor(
    private readonly rabbit: RabbitClient,
    private readonly relay: OutboxRelay,
    private readonly maintenance: Maintenance,
    @Inject(EVENT_HANDLERS) private readonly handlers: EventHandlers,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.rabbit.waitForConnect();
    for (const [queue, handler] of Object.entries(this.handlers)) {
      const consumer = new QueueConsumer(this.rabbit, queue, handler, this.logger);
      await consumer.start();
      this.consumers.push(consumer);
    }
    this.relay.start();
    this.maintenance.start();
    this.logger.log(`Worker started: ${this.consumers.length} consumers`);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.maintenance.stop();
    await this.relay.stop();
    const stopped = await Promise.allSettled(
      this.consumers.map((consumer) => consumer.stop()),
    );
    for (const result of stopped) {
      if (result.status === 'rejected') {
        this.logger.error(
          `A consumer failed to stop: ${(result.reason as Error).message}`,
        );
      }
    }
    this.consumers = [];
    try {
      await this.rabbit.close();
    } catch (error) {
      this.logger.error(`Closing RabbitMQ failed: ${(error as Error).message}`);
    }
  }
}
