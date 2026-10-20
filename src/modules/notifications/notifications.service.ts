import { Injectable, NotFoundException } from '@nestjs/common';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import type { Notification } from './notification.entity.js';
import type {
  NotificationDto,
  NotificationPageDto,
  UnreadCountDto,
} from './dto/notification.dto.js';
import { isOrderEvent, type EventEnvelope } from '../../events/domain-events.js';
import { notificationTargets } from './notification-rules.js';
import { NotificationsRepository } from './notifications.repository.js';

const PAGE_SIZE = 20;

@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationsRepository) {}

  /** Retention: removes notifications created before `before`. */
  deleteOlderThan(before: Date): Promise<number> {
    return this.notifications.deleteCreatedBefore(before);
  }

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

  async list(userId: string, cursor?: string): Promise<NotificationPageDto> {
    const decoded = cursor ? decodeCreatedAtCursor(cursor) : null;
    const rows = await this.notifications.list(userId, decoded, PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toDto(row)),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeCreatedAtCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountDto> {
    return { count: await this.notifications.countUnread(userId) };
  }

  async markRead(userId: string, id: string): Promise<void> {
    if (!(await this.notifications.markRead(userId, id, new Date()))) {
      throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications.markAllRead(userId, new Date());
  }

  private toDto(row: Notification): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      params: row.params,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
