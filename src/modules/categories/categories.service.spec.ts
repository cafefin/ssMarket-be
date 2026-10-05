import type { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';

describe('CategoriesService', () => {
  const fresh = {
    id: 2,
    slug: 'thuc-pham-tuoi',
    name: 'Thực phẩm tươi',
    sortOrder: 2,
  };
  const repository = {
    findAll: vi.fn().mockResolvedValue([fresh]),
    findById: vi.fn((id: number) => Promise.resolve(id === 2 ? fresh : null)),
    findBySlug: vi.fn((slug: string) =>
      Promise.resolve(slug === fresh.slug ? fresh : null),
    ),
  };
  const service = new CategoriesService(
    repository as unknown as CategoriesRepository,
  );

  it('lists categories from the repository', async () => {
    await expect(service.list()).resolves.toEqual([fresh]);
  });

  it('finds a category by id or slug, or returns null', async () => {
    await expect(service.findById(2)).resolves.toBe(fresh);
    await expect(service.findById(99)).resolves.toBeNull();
    await expect(service.findBySlug('thuc-pham-tuoi')).resolves.toBe(fresh);
    await expect(service.findBySlug('nope')).resolves.toBeNull();
  });
});
