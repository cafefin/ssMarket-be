import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { DomainException } from '../../common/errors/domain.exception.js';
import { Category } from './category.entity.js';

@Injectable()
export class CategoriesRepository {
  constructor(
    @InjectRepository(Category)
    private readonly repository: Repository<Category>,
  ) {}

  findActive(): Promise<Category[]> {
    return this.repository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  findAll(): Promise<Category[]> {
    return this.repository.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async maxSortOrder(): Promise<number> {
    const row = await this.repository
      .createQueryBuilder('c')
      .select('COALESCE(MAX(c.sort_order), 0)', 'max')
      .getRawOne<{ max: number }>();
    return Number(row?.max ?? 0);
  }

  async save(category: Partial<Category>): Promise<Category> {
    try {
      return await this.repository.save(this.repository.create(category));
    } catch (error) {
      // Two admins adding the same name at once both pass the service's
      // slug check; the unique index on slug decides.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new DomainException(
          409,
          'CATEGORY_EXISTS',
          'A category with this name already exists',
        );
      }
      throw error;
    }
  }

  findById(id: number): Promise<Category | null> {
    return this.repository.findOne({ where: { id } });
  }

  findBySlug(slug: string): Promise<Category | null> {
    return this.repository.findOne({ where: { slug } });
  }
}
