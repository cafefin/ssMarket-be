import { ApiProperty } from '@nestjs/swagger';
import type { User } from '../user.entity.js';

/** What any signed-in person may see about another. No email, no bank. */
export class PublicUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  deliveryLocation!: string | null;

  static from(user: User): PublicUserDto {
    const dto = new PublicUserDto();
    dto.id = user.id;
    dto.name = user.name;
    dto.avatarUrl = user.avatarUrl;
    dto.deliveryLocation = user.deliveryLocation;
    return dto;
  }
}
