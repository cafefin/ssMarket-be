import { ApiProperty } from '@nestjs/swagger';
import type { Category } from '../category.entity.js';

export class CategoryResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ example: 'thuc-pham-tuoi' })
  slug!: string;

  @ApiProperty({ example: 'Thực phẩm tươi' })
  name!: string;

  @ApiProperty({ example: 'Fresh food' })
  nameEn!: string;

  @ApiProperty({
    description: 'Food and other goods that go off; no condition is asked',
  })
  isPerishable!: boolean;

  static from(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.slug = category.slug;
    dto.name = category.name;
    dto.nameEn = category.nameEn;
    dto.isPerishable = category.isPerishable;
    return dto;
  }
}
