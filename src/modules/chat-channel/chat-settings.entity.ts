import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The single settings row of the Google Chat channel (id is always 1). */
@Entity('chat_channel_settings')
export class ChatSettings {
  @PrimaryColumn({ type: 'smallint' })
  id!: number;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'webhook_url', type: 'text', nullable: true })
  webhookUrl!: string | null;

  @Column({ name: 'max_per_hour', type: 'smallint', nullable: true })
  maxPerHour!: number | null;

  @Column({ name: 'seller_cooldown_minutes', type: 'smallint', default: 30 })
  sellerCooldownMinutes!: number;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
