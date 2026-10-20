import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsModule } from './notifications.module.js';

/** The HTTP side; the worker imports NotificationsModule alone. */
@Module({
  imports: [NotificationsModule],
  controllers: [NotificationsController],
})
export class NotificationsApiModule {}
