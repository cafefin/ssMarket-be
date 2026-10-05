import { Injectable } from '@nestjs/common';
import type { Category } from './category.entity.js';
import { CategoriesRepository } from './categories.repository.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly categories: CategoriesRepository) {}

  list(): Promise<Category[]> {
    return this.categories.findAll();
  }

  findById(id: number): Promise<Category | null> {
    return this.categories.findById(id);
  }

  findBySlug(slug: string): Promise<Category | null> {
    return this.categories.findBySlug(slug);
  }
}
