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

  findAll(): Promise<Category[]> {
    return this.repository.find({ order: { sortOrder: 'ASC' } });
  }

  findById(id: number): Promise<Category | null> {
    return this.repository.findOne({ where: { id } });
  }

  findBySlug(slug: string): Promise<Category | null> {
    return this.repository.findOne({ where: { slug } });
  }
}
