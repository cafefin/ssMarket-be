import { ApiProperty } from '@nestjs/swagger';

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'order.placed' })
  type!: string;

  /** Free-form values for the frontend's text; see OrderEventPayload, plus role. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  params!: Record<string, unknown>;

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
  @ApiProperty()
  count!: number;
}
