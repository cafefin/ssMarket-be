import { ApiProperty } from '@nestjs/swagger';
import type { Category } from '../category.entity.js';
import { CategoryResponseDto } from './category-response.dto.js';

export class AdminCategoryDto extends CategoryResponseDto {
  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ description: 'False when hidden from browsing and selling' })
  isActive!: boolean;

  static override from(category: Category): AdminCategoryDto {
    const dto = new AdminCategoryDto();
    dto.id = category.id;
    dto.slug = category.slug;
    dto.name = category.name;
    dto.nameEn = category.nameEn;
    dto.sortOrder = category.sortOrder;
    dto.isActive = category.isActive;
    return dto;
  }
}
