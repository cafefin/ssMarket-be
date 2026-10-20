import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import type { CreatedAtCursor } from '../../common/pagination/created-at-cursor.js';
import { Notification } from './notification.entity.js';

export interface NewNotification {
  recipientId: string;
  eventId: string;
  type: string;
  params: Record<string, unknown>;
  orderId: string | null;
  createdAt: Date;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  /** Inserts unless (eventId, recipientId) exists or the recipient is gone. */
  async insert(row: NewNotification): Promise<void> {
    await this.repository.query(
      `INSERT INTO notifications (recipient_id, event_id, type, params, order_id, created_at)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE EXISTS (SELECT 1 FROM users WHERE id = $1)
       ON CONFLICT (event_id, recipient_id) DO NOTHING`,
      [
        row.recipientId,
        row.eventId,
        row.type,
        JSON.stringify(row.params),
        row.orderId,
        row.createdAt,
      ],
    );
  }

  /**
   * Rewrites the recipient's newest unread order.edited row of that order;
   * false when there is none. Never moves a row back in time, so a late
   * redelivery of an older edit cannot overwrite a newer one (it still
   * counts as merged, so it adds no second row).
   */
  async mergeEdited(row: NewNotification): Promise<boolean> {
    // TypeORM's postgres driver answers UPDATE ... RETURNING as [rows, affectedCount].
    const [updated]: [unknown[], number] = await this.repository.query(
      `UPDATE notifications
       SET params = $4, event_id = $2, created_at = $6
       WHERE id = (
         SELECT id FROM notifications
         WHERE recipient_id = $1 AND order_id = $5 AND type = $3::text AND read_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) AND created_at <= $6
       RETURNING id`,
      [
        row.recipientId,
        row.eventId,
        row.type,
        JSON.stringify(row.params),
        row.orderId,
        row.createdAt,
      ],
    );
    if (updated.length > 0) return true;
    const existing: unknown[] = await this.repository.query(
      `SELECT 1 FROM notifications
       WHERE recipient_id = $1 AND order_id = $2 AND type = 'order.edited' AND read_at IS NULL
       LIMIT 1`,
      [row.recipientId, row.orderId],
    );
    return existing.length > 0;
  }

  list(
    recipientId: string,
    cursor: CreatedAtCursor | null,
    limit: number,
  ): Promise<Notification[]> {
    const query = this.repository
      .createQueryBuilder('n')
      .where('n.recipient_id = :recipientId', { recipientId });
    if (cursor) {
      query.andWhere('(n.created_at, n.id) < (:createdAt, :id)', {
        createdAt: cursor.createdAt,
        id: cursor.id,
      });
    }
    return query
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .limit(limit)
      .getMany();
  }

  countUnread(recipientId: string): Promise<number> {
    return this.repository.count({ where: { recipientId, readAt: IsNull() } });
  }

  /** False when no such notification belongs to the recipient. */
  async markRead(recipientId: string, id: string, at: Date): Promise<boolean> {
    const [, affected]: [unknown, number] = await this.repository.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, $3)
       WHERE id = $2 AND recipient_id = $1`,
      [recipientId, id, at],
    );
    return affected > 0;
  }

  async markAllRead(recipientId: string, at: Date): Promise<void> {
    await this.repository.update(
      { recipientId, readAt: IsNull() },
      { readAt: at },
    );
  }

  async deleteCreatedBefore(before: Date): Promise<number> {
    const result = await this.repository.delete({ createdAt: LessThan(before) });
    return result.affected ?? 0;
  }
}
