import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, type Repository } from 'typeorm';
import type { Tx } from '../database/transaction.js';
import { OutboxEvent } from './outbox-event.entity.js';

export interface UnpublishedRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repository: Repository<OutboxEvent>,
  ) {}

  async insert(
    tx: Tx,
    row: { id: string; type: string; payload: object; occurredAt: Date },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO outbox_events (id, type, payload, occurred_at)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [row.id, row.type, JSON.stringify(row.payload), row.occurredAt],
    );
  }

  /** Locks up to `limit` unsent rows, oldest first, skipping rows another worker holds. */
  async lockUnpublished(tx: Tx, limit: number): Promise<UnpublishedRow[]> {
    const rows: {
      id: string;
      type: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }[] = await tx.query(
      `SELECT id, type, payload, occurred_at FROM outbox_events
       WHERE published_at IS NULL
       ORDER BY occurred_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      occurredAt: row.occurred_at,
    }));
  }

  async markPublished(tx: Tx, ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await tx.query(
      `UPDATE outbox_events SET published_at = $2 WHERE id = ANY($1::uuid[])`,
      [ids, at],
    );
  }

  async bumpAttempts(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.query(
      `UPDATE outbox_events SET attempts = attempts + 1 WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  /** Deletes rows published before `before`; returns how many. */
  async deletePublishedBefore(before: Date): Promise<number> {
    const result = await this.repository.delete({
      publishedAt: LessThan(before),
    });
    return result.affected ?? 0;
  }

  /** Runs `work` in a transaction (the relay owns its own). */
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.repository.manager.transaction(work);
  }
}
