import type { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Category } from './category.entity.js';
import { CategoriesRepository } from './categories.repository.js';

describe('CategoriesRepository.save', () => {
  const typeorm = { create: vi.fn(), save: vi.fn() };
  let repository: CategoriesRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    typeorm.create.mockImplementation((value: unknown) => value);
    repository = new CategoriesRepository(
      typeorm as unknown as Repository<Category>,
    );
  });

  const violation = (code: string) =>
    new QueryFailedError('INSERT', [], Object.assign(new Error('x'), { code }));

  it('returns the saved category', async () => {
    typeorm.save.mockResolvedValue({ id: 7 });

    await expect(repository.save({ slug: 'sach' })).resolves.toEqual({ id: 7 });
  });

  it('turns a unique violation into CATEGORY_EXISTS', async () => {
    typeorm.save.mockRejectedValue(violation('23505'));

    const error = await repository.save({ slug: 'sach' }).catch((e) => e);

    expect(error).toBeInstanceOf(DomainException);
    expect(error).toMatchObject({ code: 'CATEGORY_EXISTS' });
    expect(error.getStatus()).toBe(409);
  });

  it('lets any other database error through', async () => {
    const failure = violation('23502');
    typeorm.save.mockRejectedValue(failure);

    await expect(repository.save({ slug: 'sach' })).rejects.toBe(failure);
  });
});
