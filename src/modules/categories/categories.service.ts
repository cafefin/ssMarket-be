import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { LISTINGS_CACHE_NAMESPACE } from '../listings/listings.constants.js';
import { categorySlug } from './category-slug.js';
import type { Category } from './category.entity.js';
import { CategoriesRepository } from './categories.repository.js';

export interface CreateCategoryInput {
  name: string;
  nameEn: string;
  sortOrder?: number;
  isPerishable?: boolean;
}

export interface UpdateCategoryInput {
  name?: string;
  nameEn?: string;
  sortOrder?: number;
  isActive?: boolean;
  isPerishable?: boolean;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categories: CategoriesRepository,
    private readonly cache: CacheService,
  ) {}

  /** The categories people may browse and list under. */
  list(): Promise<Category[]> {
    return this.categories.findActive();
  }

  /** Every category, hidden ones included, for the admin screen. */
  listAll(): Promise<Category[]> {
    return this.categories.findAll();
  }

  findById(id: number): Promise<Category | null> {
    return this.categories.findById(id);
  }

  findBySlug(slug: string): Promise<Category | null> {
    return this.categories.findBySlug(slug);
  }

  async create(input: CreateCategoryInput): Promise<Category> {
    const name = input.name.trim();
    const slug = categorySlug(name);
    if (slug === '') {
      throw new BadRequestException('The name needs a letter or a digit');
    }
    if (await this.categories.findBySlug(slug)) {
      throw new DomainException(
        409,
        'CATEGORY_EXISTS',
        'A category with this name already exists',
      );
    }

    const created = await this.categories.save({
      slug,
      name,
      nameEn: input.nameEn.trim(),
      sortOrder: input.sortOrder ?? (await this.categories.maxSortOrder()) + 1,
      isActive: true,
      isPerishable: input.isPerishable ?? false,
    });
    await this.invalidateListings();
    return created;
  }

  async update(id: number, input: UpdateCategoryInput): Promise<Category> {
    const category = await this.categories.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // The slug stays as it was, so existing filter links keep working.
    if (input.name !== undefined) {
      category.name = input.name.trim();
    }
    if (input.nameEn !== undefined) {
      category.nameEn = input.nameEn.trim();
    }
    if (input.sortOrder !== undefined) {
      category.sortOrder = input.sortOrder;
    }
    if (input.isActive !== undefined) {
      category.isActive = input.isActive;
    }
    if (input.isPerishable !== undefined) {
      category.isPerishable = input.isPerishable;
    }

    const saved = await this.categories.save(category);
    await this.invalidateListings();
    return saved;
  }

  /** Cached listing responses carry the category's names. */
  private invalidateListings(): Promise<void> {
    return this.cache.bumpVersion(LISTINGS_CACHE_NAMESPACE);
  }
}
