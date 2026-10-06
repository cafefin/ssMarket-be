import { ApiProperty } from '@nestjs/swagger';
import { type User, UserLocale, UserRole } from '../user.entity.js';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({ enum: UserLocale, enumName: 'UserLocale' })
  locale!: UserLocale;

  @ApiProperty({ type: String, nullable: true })
  deliveryLocation!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bankBin!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bankAccountNumber!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bankAccountName!: string | null;

  static from(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.name = user.name;
    dto.avatarUrl = user.avatarUrl;
    dto.role = user.role;
    dto.locale = user.locale;
    dto.deliveryLocation = user.deliveryLocation;
    dto.bankBin = user.bankBin;
    dto.bankAccountNumber = user.bankAccountNumber;
    dto.bankAccountName = user.bankAccountName;
    return dto;
  }
}
