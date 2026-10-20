import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

/** No controller: the worker imports this module. The HTTP API is a separate module. */
@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
