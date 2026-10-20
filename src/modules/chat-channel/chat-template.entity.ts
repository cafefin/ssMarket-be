import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('chat_templates')
export class ChatTemplate {
  @PrimaryColumn({ name: 'event_type', type: 'varchar', length: 60 })
  eventType!: string;

  @Column({ type: 'boolean' })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 1000 })
  template!: string;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
