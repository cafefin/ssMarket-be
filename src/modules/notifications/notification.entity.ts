import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'recipient_id', type: 'uuid' })
  recipientId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({ type: 'jsonb' })
  params!: Record<string, unknown>;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  /** A plain column, not CreateDateColumn: merging `order.edited` rewrites it. */
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
