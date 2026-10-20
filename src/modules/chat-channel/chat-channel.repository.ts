import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import type { CreatedAtCursor } from '../../common/pagination/created-at-cursor.js';
import type { Tx } from '../../database/transaction.js';
import { ChatDelivery, type ChatOutcome } from './chat-delivery.entity.js';
import { ChatSettings } from './chat-settings.entity.js';
import { ChatTemplate } from './chat-template.entity.js';

export interface NewChatDelivery {
  eventId: string | null;
  eventType: string;
  sellerId: string | null;
  outcome: ChatOutcome;
  message: string | null;
  error: string | null;
}

type DeliveryRow = {
  id: string;
  event_id: string | null;
  event_type: string;
  seller_id: string | null;
  outcome: ChatOutcome;
  message: string | null;
  error: string | null;
  digested_at: Date | null;
  created_at: Date;
  seller_name: string | null;
};

@Injectable()
export class ChatChannelRepository {
  constructor(
    @InjectRepository(ChatSettings)
    private readonly settings: Repository<ChatSettings>,
    @InjectRepository(ChatTemplate)
    private readonly templates: Repository<ChatTemplate>,
    @InjectRepository(ChatDelivery)
    private readonly deliveries: Repository<ChatDelivery>,
  ) {}

  getSettings(): Promise<ChatSettings> {
    return this.settings.findOneByOrFail({ id: 1 });
  }

  async saveSettings(
    fields: Partial<ChatSettings>,
    by: string,
  ): Promise<ChatSettings> {
    const { id: _id, updatedAt: _at, updatedBy: _by, ...changes } = fields;
    await this.settings.update(
      { id: 1 },
      { ...changes, updatedAt: new Date(), updatedBy: by },
    );
    return this.getSettings();
  }

  listTemplates(): Promise<ChatTemplate[]> {
    return this.templates.find();
  }

  getTemplate(type: string): Promise<ChatTemplate | null> {
    return this.templates.findOneBy({ eventType: type });
  }

  async saveTemplate(
    type: string,
    fields: { enabled: boolean; template: string },
    by: string,
  ): Promise<ChatTemplate> {
    await this.templates.update(
      { eventType: type },
      { ...fields, updatedAt: new Date(), updatedBy: by },
    );
    return this.templates.findOneByOrFail({ eventType: type });
  }

  async hasDelivery(eventId: string): Promise<boolean> {
    return this.deliveries.existsBy({ eventId });
  }

  /** Ignores a second row for the same eventId. */
  async recordDelivery(row: NewChatDelivery, tx?: Tx): Promise<void> {
    const runner = tx ?? this.deliveries.manager;
    await runner.query(
      `INSERT INTO chat_deliveries (event_id, event_type, seller_id, outcome, message, error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING`,
      [
        row.eventId,
        row.eventType,
        row.sellerId,
        row.outcome,
        row.message,
        row.error,
        new Date(), // millisecond precision, so the paging cursor is exact
      ],
    );
  }

  /** Held rows (rate_limited_*, not digested) created in [since, before), oldest first. */
  pendingHeld(since: Date, before: Date): Promise<ChatDelivery[]> {
    return this.deliveries
      .createQueryBuilder('d')
      .where("d.outcome IN ('rate_limited_global', 'rate_limited_seller')")
      .andWhere('d.digested_at IS NULL')
      .andWhere('d.created_at >= :since AND d.created_at < :before', {
        since,
        before,
      })
      .orderBy('d.created_at', 'ASC')
      .addOrderBy('d.id', 'ASC')
      .getMany();
  }

  async markDigested(ids: string[], at: Date, tx?: Tx): Promise<void> {
    if (ids.length === 0) return;
    const runner = tx ?? this.deliveries.manager;
    await runner.query(
      'UPDATE chat_deliveries SET digested_at = $2 WHERE id = ANY($1::uuid[])',
      [ids, at],
    );
  }

  /** Newest first, with the seller's name; keyset on (created_at, id). */
  async listDeliveries(
    cursor: CreatedAtCursor | null,
    limit: number,
  ): Promise<(ChatDelivery & { sellerName: string | null })[]> {
    const rows: DeliveryRow[] = await this.deliveries.query(
      `SELECT d.id, d.event_id, d.event_type, d.seller_id, d.outcome, d.message,
              d.error, d.digested_at, d.created_at, u.name AS seller_name
       FROM chat_deliveries d
       LEFT JOIN users u ON u.id = d.seller_id
       WHERE ($1::timestamptz IS NULL OR (d.created_at, d.id) < ($1::timestamptz, $2::uuid))
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $3`,
      [cursor?.createdAt ?? null, cursor?.id ?? null, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventType: row.event_type,
      sellerId: row.seller_id,
      outcome: row.outcome,
      message: row.message,
      error: row.error,
      digestedAt: row.digested_at,
      createdAt: row.created_at,
      sellerName: row.seller_name,
    }));
  }

  async deleteCreatedBefore(before: Date): Promise<number> {
    const result = await this.deliveries.delete({
      createdAt: LessThan(before),
    });
    return result.affected ?? 0;
  }

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.deliveries.manager.transaction(work);
  }
}
