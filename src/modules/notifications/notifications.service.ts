import { Injectable } from '@nestjs/common';
import { isOrderEvent, type EventEnvelope } from '../../events/domain-events.js';
import { notificationTargets } from './notification-rules.js';
import { NotificationsRepository } from './notifications.repository.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationsRepository) {}

  /** In-app queue handler. Idempotent: a redelivered event changes nothing. */
  async handleEvent(event: EventEnvelope): Promise<void> {
    if (!isOrderEvent(event)) return;
    for (const target of notificationTargets(event.type, event.payload)) {
      const row = {
        recipientId: target.recipientId,
        eventId: event.id,
        type: event.type,
        params: target.params as unknown as Record<string, unknown>,
        orderId: event.payload.orderId,
        createdAt: new Date(event.occurredAt),
      };
      if (event.type === 'order.edited' && (await this.notifications.mergeEdited(row))) {
        continue;
      }
      await this.notifications.insert(row);
    }
  }
}
