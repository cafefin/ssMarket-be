import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateWorkerEnv } from '../config/env.validation.js';
import { DatabaseModule } from '../database/database.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../modules/notifications/notifications.module.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';
import { RedisModule } from '../redis/redis.module.js';
import { EVENT_HANDLERS, type EventHandlers } from './event-handlers.js';
import { Maintenance } from './maintenance.js';
import { OutboxRelay } from './outbox-relay.js';
import { RabbitClient } from './rabbit.client.js';
import { GCHAT_QUEUE, INAPP_QUEUE } from './topology.js';
import { WorkerRunner } from './worker.runner.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateWorkerEnv }),
    DatabaseModule,
    RedisModule,
    EventsModule,
    NotificationsModule,
    // ChatChannelModule (Task 11) is added here.
  ],
  providers: [
    RabbitClient,
    OutboxRelay,
    Maintenance,
    WorkerRunner,
    {
      provide: EVENT_HANDLERS,
      inject: [NotificationsService],
      useFactory: (notifications: NotificationsService): EventHandlers => ({
        [INAPP_QUEUE.name]: (event) => notifications.handleEvent(event),
        [GCHAT_QUEUE.name]: async () => {}, // replaced in Task 12
      }),
    },
  ],
})
export class WorkerModule {}
