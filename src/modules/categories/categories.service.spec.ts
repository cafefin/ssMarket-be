import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CacheService } from '../../cache/cache.service.js';
import type { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';

describe('CategoriesService', () => {
  const fresh = {
    id: 2,
    slug: 'thuc-pham-tuoi',
    name: 'Thực phẩm tươi',
    nameEn: 'Fresh food',
    sortOrder: 2,
    isActive: true,
  };
  const repository = {
    findActive: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    maxSortOrder: vi.fn(),
    save: vi.fn(),
  };
  const cache = { bumpVersion: vi.fn() };
  let service: CategoriesService;

  beforeEach(() => {
    vi.resetAllMocks();
    repository.findActive.mockResolvedValue([fresh]);
    repository.findAll.mockResolvedValue([fresh]);
    repository.findById.mockImplementation((id: number) =>
      Promise.resolve(id === 2 ? fresh : null),
    );
    repository.findBySlug.mockImplementation((slug: string) =>
      Promise.resolve(slug === fresh.slug ? fresh : null),
    );
    repository.save.mockImplementation((category: { id?: number }) =>
      Promise.resolve({ id: 7, ...category }),
    );
    service = new CategoriesService(
      repository as unknown as CategoriesRepository,
      cache as unknown as CacheService,
    );
  });

  it('lists the active categories from the repository', async () => {
    await expect(service.list()).resolves.toEqual([fresh]);
    expect(repository.findActive).toHaveBeenCalled();
  });

  it('lists every category for the admin screen', async () => {
    await expect(service.listAll()).resolves.toEqual([fresh]);
    expect(repository.findAll).toHaveBeenCalled();
  });

  it('finds a category by id or slug, or returns null', async () => {
    await expect(service.findById(2)).resolves.toBe(fresh);
    await expect(service.findById(99)).resolves.toBeNull();
    await expect(service.findBySlug('thuc-pham-tuoi')).resolves.toBe(fresh);
    await expect(service.findBySlug('nope')).resolves.toBeNull();
  });

  it('creates a category at the end of the list with a slug from its name', async () => {
    repository.findBySlug.mockResolvedValue(null);
    repository.maxSortOrder.mockResolvedValue(6);

    const created = await service.create({ name: ' Sách ', nameEn: ' Books ' });

    expect(repository.save).toHaveBeenCalledWith({
      slug: 'sach',
      name: 'Sách',
      nameEn: 'Books',
      sortOrder: 7,
      isActive: true,
      isPerishable: false,
    });
    expect(created.id).toBe(7);
    expect(cache.bumpVersion).toHaveBeenCalledWith('listings');
  });

  it('refuses a name whose slug is taken', async () => {
    await expect(
      service.create({ name: 'Thực phẩm tươi', nameEn: 'Fresh' }),
    ).rejects.toMatchObject({ code: 'CATEGORY_EXISTS' });
  });

  it('refuses a name with no letter or digit', async () => {
    await expect(
      service.create({ name: '!!!', nameEn: 'Bang' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renames and hides without touching the slug', async () => {
    repository.findById.mockResolvedValue({ ...fresh });

    await service.update(2, { name: 'Rau củ', isActive: false });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        slug: 'thuc-pham-tuoi',
        name: 'Rau củ',
        isActive: false,
      }),
    );
    expect(cache.bumpVersion).toHaveBeenCalledWith('listings');
  });

  it('marks a category as perishable', async () => {
    repository.findById.mockResolvedValue({ ...fresh, isPerishable: false });

    await service.update(2, { isPerishable: true });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, isPerishable: true }),
    );
  });

  it('answers 404 for an unknown category', async () => {
    await expect(service.update(99, { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
