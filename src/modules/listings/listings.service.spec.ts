import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { CategoriesService } from '../categories/categories.service.js';
import type { UsersService } from '../users/users.service.js';
import type { ListingInput } from './listing-rules.js';
import { Listing } from './listing.entity.js';
import { ListingMode, ListingStatus } from './listings.constants.js';
import type { ListingsRepository } from './listings.repository.js';
import { ListingsService } from './listings.service.js';

const SELLER = 'seller-1';
const OTHER = 'other-1';

function input(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    mode: ListingMode.InStock,
    title: '  Loa bluetooth cũ ',
    categoryId: 1,
    description: 'Còn mới',
    acceptsPrepaidQr: false,
    acceptsPayOnDelivery: true,
    orderDeadline: null,
    deliveryDate: null,
    items: [
      {
        name: ' Loa JBL ',
        unit: 'cái',
        unitPrice: 500_000,
        stockQuantity: '1',
      },
      { name: 'Dây sạc', unit: 'cái', unitPrice: 20_000, stockQuantity: '3' },
    ],
    ...overrides,
  };
}

function stored(overrides: Partial<Listing> = {}): Listing {
  return Object.assign(new Listing(), {
    id: 'listing-1',
    sellerId: SELLER,
    mode: ListingMode.InStock,
    status: ListingStatus.Draft,
    acceptsPrepaidQr: false,
    acceptsPayOnDelivery: true,
    orderDeadline: null,
    deliveryDate: null,
    ...overrides,
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DomainException);
  return (error as DomainException).code;
}

describe('ListingsService', () => {
  const repository = {
    findByIdWithRelations: vi.fn(),
    findBySeller: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const users = { getById: vi.fn(), hasBankProfile: vi.fn() };
  const categories = { findById: vi.fn() };
  const cache = { bumpVersion: vi.fn() };
  let service: ListingsService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ now: new Date('2026-10-05T03:00:00Z') });
    repository.insert.mockResolvedValue('listing-1');
    repository.findByIdWithRelations.mockResolvedValue(stored());
    users.getById.mockResolvedValue({ id: SELLER });
    users.hasBankProfile.mockReturnValue(true);
    categories.findById.mockResolvedValue({ id: 1 });
    service = new ListingsService(
      repository as unknown as ListingsRepository,
      users as unknown as UsersService,
      categories as unknown as CategoriesService,
      cache as unknown as CacheService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('stores a draft with trimmed text, search text and ordered items', async () => {
      await service.create(SELLER, input());

      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: SELLER,
          status: ListingStatus.Draft,
          title: 'Loa bluetooth cũ',
          searchText: 'loa bluetooth cu con moi loa jbl day sac',
          publishedAt: null,
        }),
        [
          {
            name: 'Loa JBL',
            unit: 'cái',
            unitPrice: 500_000,
            stockQuantity: '1',
            sortOrder: 0,
          },
          {
            name: 'Dây sạc',
            unit: 'cái',
            unitPrice: 20_000,
            stockQuantity: '3',
            sortOrder: 1,
          },
        ],
      );
      expect(cache.bumpVersion).toHaveBeenCalledWith('listings');
    });

    it('rejects invalid input with every problem in the message', async () => {
      await expect(
        service.create(SELLER, input({ title: 'abc', items: [] })),
      ).rejects.toThrow(
        'title must be 5-120 characters; a listing needs 1-20 items',
      );
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('rejects an unknown category', async () => {
      categories.findById.mockResolvedValue(null);

      await expect(service.create(SELLER, input())).rejects.toThrow(
        'Unknown category',
      );
    });

    it('requires a bank profile to accept QR payments', async () => {
      users.hasBankProfile.mockReturnValue(false);

      await expect(
        codeOf(service.create(SELLER, input({ acceptsPrepaidQr: true }))),
      ).resolves.toBe('BANK_PROFILE_REQUIRED');
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('does not look at the bank profile for pay-on-delivery only', async () => {
      users.hasBankProfile.mockReturnValue(false);

      await service.create(SELLER, input());

      expect(users.getById).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('replaces the fields and items and bumps the cache', async () => {
      await service.update(
        SELLER,
        'listing-1',
        input({ title: 'Loa mới hơn' }),
      );

      expect(repository.update).toHaveBeenCalledWith(
        'listing-1',
        expect.objectContaining({ title: 'Loa mới hơn' }),
        expect.arrayContaining([expect.objectContaining({ sortOrder: 1 })]),
      );
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it('is 404 for a missing listing', async () => {
      repository.findByIdWithRelations.mockResolvedValue(null);

      await expect(
        service.update(SELLER, 'missing', input()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("is 403 for someone else's listing", async () => {
      await expect(
        service.update(OTHER, 'listing-1', input()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses to edit a closed listing', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ status: ListingStatus.Closed }),
      );

      await expect(
        codeOf(service.update(SELLER, 'listing-1', input())),
      ).resolves.toBe('INVALID_LISTING_STATE');
    });

    it('refuses to change the mode', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ mode: ListingMode.Preorder }),
      );

      await expect(
        service.update(SELLER, 'listing-1', input()),
      ).rejects.toThrow('The mode of a listing cannot be changed');
    });
  });

  describe('publish', () => {
    it('opens a draft and records the time', async () => {
      await service.publish(SELLER, 'listing-1');

      expect(repository.update).toHaveBeenCalledWith('listing-1', {
        status: ListingStatus.Open,
        publishedAt: new Date('2026-10-05T03:00:00Z'),
      });
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it.each([ListingStatus.Open, ListingStatus.Closed])(
      'refuses a listing that is %s',
      async (status) => {
        repository.findByIdWithRelations.mockResolvedValue(stored({ status }));

        await expect(
          codeOf(service.publish(SELLER, 'listing-1')),
        ).resolves.toBe('INVALID_LISTING_STATE');
      },
    );

    it.each([
      ['in the past', new Date('2026-10-05T02:59:59Z')],
      ['exactly now', new Date('2026-10-05T03:00:00Z')],
    ])('refuses a pre-order whose deadline is %s', async (_label, deadline) => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ mode: ListingMode.Preorder, orderDeadline: deadline }),
      );

      await expect(service.publish(SELLER, 'listing-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('publishes a pre-order with a future deadline', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({
          mode: ListingMode.Preorder,
          orderDeadline: new Date('2026-10-06T03:00:00Z'),
        }),
      );

      await expect(service.publish(SELLER, 'listing-1')).resolves.toBeDefined();
    });

    it('re-checks the bank profile when the listing accepts QR', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ acceptsPrepaidQr: true }),
      );
      users.hasBankProfile.mockReturnValue(false);

      await expect(codeOf(service.publish(SELLER, 'listing-1'))).resolves.toBe(
        'BANK_PROFILE_REQUIRED',
      );
    });

    it("is 403 for someone else's listing", async () => {
      await expect(service.publish(OTHER, 'listing-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('close', () => {
    it('closes an open listing', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ status: ListingStatus.Open }),
      );

      await service.close(SELLER, 'listing-1');

      expect(repository.update).toHaveBeenCalledWith('listing-1', {
        status: ListingStatus.Closed,
        closedAt: new Date('2026-10-05T03:00:00Z'),
      });
    });

    it('refuses a draft', async () => {
      await expect(codeOf(service.close(SELLER, 'listing-1'))).resolves.toBe(
        'INVALID_LISTING_STATE',
      );
    });
  });

  describe('getForViewer', () => {
    it('shows the seller their own draft', async () => {
      await expect(
        service.getForViewer(SELLER, 'listing-1'),
      ).resolves.toMatchObject({ id: 'listing-1' });
    });

    it('hides a draft from everyone else', async () => {
      await expect(
        service.getForViewer(OTHER, 'listing-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows an open listing to everyone', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ status: ListingStatus.Open }),
      );

      await expect(
        service.getForViewer(OTHER, 'listing-1'),
      ).resolves.toBeDefined();
    });

    it('hides an open pre-order after its deadline', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({
          status: ListingStatus.Open,
          mode: ListingMode.Preorder,
          orderDeadline: new Date('2026-10-05T02:00:00Z'),
        }),
      );

      await expect(
        service.getForViewer(OTHER, 'listing-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('lists the seller’s listings with an optional status filter', async () => {
    repository.findBySeller.mockResolvedValue([stored()]);

    await service.listMine(SELLER, ListingStatus.Draft);

    expect(repository.findBySeller).toHaveBeenCalledWith(
      SELLER,
      ListingStatus.Draft,
    );
  });
});
