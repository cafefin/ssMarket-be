import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../orders.constants.js';

export class CancelOrderDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Required when the seller cancels',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

// There is deliberately no price or total here: the server computes every
// amount from its own data, and unknown properties are rejected.
export class EditOrderLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId!: string;

  @ApiProperty({
    description: 'Decimal string, so no precision is lost in transit',
    example: '1.5',
  })
  @IsString()
  @MaxLength(16)
  quantity!: string;
}

/** A buyer's change to their pre-order while the round is open. */
export class EditOrderDto {
  @ApiProperty({
    type: [EditOrderLineDto],
    description:
      'The whole order after the change: products of its round, each once',
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EditOrderLineDto)
  lines!: EditOrderLineDto[];

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiProperty({ example: 'Tầng 7' })
  @IsString()
  @MaxLength(500)
  deliveryLocation!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
