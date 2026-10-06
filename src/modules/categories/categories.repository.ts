import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  save(category: Partial<Category>): Promise<Category> {
    return this.repository.save(this.repository.create(category));
  }

  findById(id: number): Promise<Category | null> {
    return this.repository.findOne({ where: { id } });
  }

  findBySlug(slug: string): Promise<Category | null> {
    return this.repository.findOne({ where: { slug } });
  }
}
