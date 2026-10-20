import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { ChatOutcome } from '../chat-delivery.entity.js';

export class ChatTemplateDto {
  @ApiProperty({ example: 'campaign.opened' })
  eventType!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  template!: string;

  @ApiProperty({ type: [String], description: 'Variables the template may use' })
  variables!: string[];

  @ApiProperty()
  defaultTemplate!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ChatChannelDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  hasWebhook!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Last 4 characters' })
  webhookHint!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  maxPerHour!: number | null;

  @ApiProperty()
  sellerCooldownMinutes!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: [ChatTemplateDto] })
  templates!: ChatTemplateDto[];
}

export class UpdateChatSettingsDto {
  @IsBoolean()
  @ApiProperty()
  enabled!: boolean;

  @ValidateIf((o: UpdateChatSettingsDto) => o.maxPerHour !== null)
  @IsInt()
  @ApiProperty({ type: Number, nullable: true, description: '1 to 60, null for no limit' })
  maxPerHour!: number | null;

  @IsInt()
  @ApiProperty({ description: '0 to 1440' })
  sellerCooldownMinutes!: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Absent keeps the stored webhook, null removes it',
  })
  webhookUrl?: string | null;
}

export class UpdateChatTemplateDto {
  @IsBoolean()
  @ApiProperty()
  enabled!: boolean;

  @IsString()
  @ApiProperty()
  template!: string;
}

export class ChatTemplateBodyDto {
  @IsString()
  @ApiProperty()
  template!: string;
}

export class ChatTestBodyDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Absent uses the saved template' })
  template?: string;
}

export class ChatPreviewDto {
  @ApiProperty()
  message!: string;
}

export enum ChatDigestState {
  Included = 'included',
  Pending = 'pending',
}

export class ChatDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ type: String, nullable: true })
  sellerName!: string | null;

  @ApiProperty({ enum: ChatOutcome, enumName: 'ChatOutcome' })
  outcome!: ChatOutcome;

  @ApiProperty({ type: String, nullable: true })
  message!: string | null;

  @ApiProperty({ type: String, nullable: true })
  error!: string | null;

  @ApiProperty({
    enum: ChatDigestState,
    enumName: 'ChatDigestState',
    nullable: true,
    description: 'Only for rate-limited rows: in a digest, or waiting for one',
  })
  digest!: ChatDigestState | null;
}

export class ChatDeliveryPageDto {
  @ApiProperty({ type: [ChatDeliveryDto] })
  items!: ChatDeliveryDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
