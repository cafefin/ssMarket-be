import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A domain event written in the same transaction as the change it describes. */
@Entity('outbox_events')
export class OutboxEvent {
  /** Also the event id; set by the application, not generated. */
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;
}
