import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity.js';
import { OutboxRepository } from './outbox.repository.js';
import { OutboxService } from './outbox.service.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [OutboxRepository, OutboxService],
  exports: [OutboxRepository, OutboxService],
})
export class EventsModule {}
