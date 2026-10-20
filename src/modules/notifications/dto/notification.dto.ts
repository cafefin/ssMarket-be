import { ApiProperty } from '@nestjs/swagger';
import {
  ORDER_EVENT_TYPES,
  type OrderEventType,
} from '../../../events/domain-events.js';
import type { NotificationRole } from '../notification-rules.js';

const ROLES = ['buyer', 'seller'] as const;

/** The order event payload plus the recipient's role; data, never text. */
export class NotificationParamsDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  orderCode!: string;

  @ApiProperty({ format: 'uuid' })
  buyerId!: string;

  @ApiProperty()
  buyerName!: string;

  @ApiProperty({ format: 'uuid' })
  sellerId!: string;

  @ApiProperty()
  sellerName!: string;

  @ApiProperty({ description: "The round's title, or the first product's title" })
  title!: string;

  @ApiProperty({ type: 'integer', description: 'Integer VND' })
  total!: number;

  @ApiProperty({ enum: ROLES, enumName: 'NotificationActor' })
  actor!: 'buyer' | 'seller';

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ enum: ROLES, enumName: 'NotificationRole' })
  role!: NotificationRole;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ORDER_EVENT_TYPES, enumName: 'NotificationType' })
  type!: OrderEventType;

  @ApiProperty({ type: NotificationParamsDto })
  params!: NotificationParamsDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class UnreadCountDto {
  @ApiProperty({ type: 'integer' })
  count!: number;
}
