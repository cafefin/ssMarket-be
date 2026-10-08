import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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
/** A buyer's change to their pre-order while the round is open. */
export class EditOrderDto {
  @ApiProperty({
    description: 'Decimal string, so no precision is lost in transit',
    example: '1.5',
  })
  @IsString()
  @MaxLength(16)
  quantity!: string;

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
