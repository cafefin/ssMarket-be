import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UserRole } from '../users/user.entity.js';
import { CategoriesService } from './categories.service.js';
import { AdminCategoryDto } from './dto/admin-category.dto.js';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category-input.dto.js';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('admin')
@Controller('admin/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
@ApiCookieAuth()
@ApiForbiddenResponse({ description: 'The caller is not an admin' })
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOkResponse({ type: [AdminCategoryDto] })
  async list(): Promise<AdminCategoryDto[]> {
    const categories = await this.categories.listAll();
    return categories.map((category) => AdminCategoryDto.from(category));
  }

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiCreatedResponse({ type: AdminCategoryDto })
  @ApiConflictResponse({ description: 'CATEGORY_EXISTS' })
  async create(@Body() body: CreateCategoryDto): Promise<AdminCategoryDto> {
    return AdminCategoryDto.from(await this.categories.create(body));
  }

  @Patch(':id')
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiOkResponse({ type: AdminCategoryDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCategoryDto,
  ): Promise<AdminCategoryDto> {
    return AdminCategoryDto.from(await this.categories.update(id, body));
  }
}
