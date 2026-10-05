import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CategoriesService } from './categories.service.js';
import { CategoryResponseDto } from './dto/category-response.dto.js';

@ApiTags('categories')
@Controller('categories')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOkResponse({ type: [CategoryResponseDto] })
  async list(): Promise<CategoryResponseDto[]> {
    const categories = await this.categories.list();
    return categories.map((category) => CategoryResponseDto.from(category));
  }
}
