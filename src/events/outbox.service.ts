import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/transaction.js';
import type { DomainEvent, EventEnvelope } from './domain-events.js';
import { OutboxRepository } from './outbox.repository.js';

@Injectable()
export class OutboxService {
  constructor(private readonly outbox: OutboxRepository) {}

  /** Writes the event inside the caller's transaction; returns its envelope. */
  async add(
    tx: Tx,
    event: DomainEvent,
    now = new Date(),
  ): Promise<EventEnvelope> {
    const envelope = {
      id: randomUUID(),
      version: 1 as const,
      occurredAt: now.toISOString(),
      ...event,
    } as EventEnvelope;
    await this.outbox.insert(tx, {
      id: envelope.id,
      type: event.type,
      payload: event.payload,
      occurredAt: now,
    });
    return envelope;
  }
}
