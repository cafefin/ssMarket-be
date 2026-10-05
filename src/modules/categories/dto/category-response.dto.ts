import { ApiProperty } from '@nestjs/swagger';
import type { Category } from '../category.entity.js';

export class CategoryResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ example: 'thuc-pham-tuoi' })
  slug!: string;

  @ApiProperty({ example: 'Thực phẩm tươi' })
  name!: string;

  static from(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.slug = category.slug;
    dto.name = category.name;
    return dto;
  }
}
