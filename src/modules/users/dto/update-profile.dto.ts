import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * A field that is absent is left unchanged; a field sent as null is cleared.
 * The three bank fields must be sent together.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryLocation?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '970436' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'bankBin must be a 6-digit code' })
  bankBin?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,24}$/, {
    message: 'bankAccountNumber must be 4-24 letters or digits',
  })
  bankAccountNumber?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  bankAccountName?: string | null;
}
