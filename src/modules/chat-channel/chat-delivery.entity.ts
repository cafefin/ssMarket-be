import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum ChatOutcome {
  Sent = 'sent',
  RateLimitedGlobal = 'rate_limited_global',
  RateLimitedSeller = 'rate_limited_seller',
  Failed = 'failed',
  Test = 'test',
  Digest = 'digest',
}

/** One line of the chat log. `sellerId` has no foreign key: the log outlives people. */
@Entity('chat_deliveries')
export class ChatDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 60 })
  eventType!: string;

  @Column({ name: 'seller_id', type: 'uuid', nullable: true })
  sellerId!: string | null;

  @Column({ type: 'enum', enum: ChatOutcome, enumName: 'chat_outcome' })
  outcome!: ChatOutcome;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'digested_at', type: 'timestamptz', nullable: true })
  digestedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
