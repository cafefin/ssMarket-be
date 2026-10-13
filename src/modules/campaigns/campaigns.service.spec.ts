import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { CategoriesService } from '../categories/categories.service.js';
import type { ListingImagesService } from '../listings/listing-images.service.js';
import { Listing } from '../listings/listing.entity.js';
import { ListingStatus } from '../listings/listings.constants.js';
import type { UsersService } from '../users/users.service.js';
import type { CampaignInput, CampaignItemInput } from './campaign-rules.js';
import { Campaign, CampaignStatus } from './campaign.entity.js';
import {
  CampaignItemsInUseError,
  CampaignStateChangedError,
  type CampaignsRepository,
  type ItemWrite,
} from './campaigns.repository.js';
import { CampaignsService } from './campaigns.service.js';
import { CampaignDetailDto } from './dto/campaign-response.dto.js';
import {
  decodeCampaignCursor,
  encodeCampaignCursor,
} from './campaign-cursor.js';

const SELLER = 'seller-1';
const OTHER = 'other-1';
const NOW = new Date('2026-10-12T03:00:00Z');

function itemInput(
  overrides: Partial<CampaignItemInput> = {},
): CampaignItemInput {
  return {
    id: null,
    title: ' Bánh bao chay ',
    description: 'Nhân nấm',
    unit: 'cái',
    unitPrice: 15_000,
    combos: [{ quantity: '10', price: 140_000 }],
    selling: true,
    ...overrides,
  };
}

function input(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return {
    title: '  Bánh bao tuần này ',
    description: 'Giao tận tầng',
    categoryId: 2,
    // 17:00 on 15 Oct in Vietnam
    orderDeadline: new Date('2026-10-15T10:00:00Z'),
    deliveryDate: '2026-10-17',
    acceptsPrepaidQr: false,
    acceptsPayOnDelivery: true,
    items: [itemInput()],
    ...overrides,
  };
}

function storedItem(overrides: Partial<Listing> = {}): Listing {
  return Object.assign(new Listing(), {
    id: 'item-1',
    title: 'Bánh bao chay',
    description: '',
    unit: 'cái',
    unitPrice: 15_000,
    status: ListingStatus.Draft,
    combos: [],
    images: [],
    ...overrides,
  });
}

function stored(overrides: Partial<Campaign> = {}): Campaign {
  return Object.assign(new Campaign(), {
    id: 'campaign-1',
    sellerId: SELLER,
    seller: { id: SELLER, name: 'Seller', email: 'seller@example.com' },
    categoryId: 2,
    category: { id: 2, slug: 'do-an', name: 'Đồ ăn', nameEn: 'Food' },
    title: 'Bánh bao tuần này',
    description: '',
    orderDeadline: new Date('2026-10-15T10:00:00Z'),
    deliveryDate: '2026-10-17',
    acceptsPrepaidQr: false,
    acceptsPayOnDelivery: true,
    status: CampaignStatus.Draft,
    reopenedFromId: null,
    publishedAt: null,
    items: [storedItem(), storedItem({ id: 'item-2', unitPrice: 18_000 })],
    ...overrides,
  });
}

function photos(...storageKeys: string[]): Listing['images'] {
  return storageKeys.map((storageKey, index) => ({
    id: `image-${index}`,
    storageKey,
    sortOrder: index,
  })) as Listing['images'];
}

/** A draft whose two products have photos. */
function storedWithPhotos(): Campaign {
  return stored({
    items: [
      storedItem({
        images: photos('listings/item-1/a.webp', 'listings/item-1/b.webp'),
      }),
      storedItem({ id: 'item-2', images: photos('listings/item-2/c.webp') }),
    ],
  });
}

async function rejection(promise: Promise<unknown>): Promise<DomainException> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DomainException);
  return error as DomainException;
}

describe('CampaignsService', () => {
  const repository = {
    findById: vi.fn(),
    findBySeller: vi.fn(),
    insert: vi.fn(),
    save: vi.fn(),
    setStatus: vi.fn(),
    delete: vi.fn(),
    itemUsage: vi.fn(),
    searchOpen: vi.fn(),
  };
  const users = { getById: vi.fn(), hasBankProfile: vi.fn() };
  const categories = { findById: vi.fn(), findBySlug: vi.fn() };
  const cache = {
    bumpVersion: vi.fn(),
    getVersion: vi.fn(),
    getOrSet: vi.fn(),
  };
  const images = { copyAll: vi.fn(), removeFiles: vi.fn() };
  let service: CampaignsService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ now: NOW });
    repository.insert.mockResolvedValue('campaign-1');
    repository.findById.mockResolvedValue(stored());
    repository.itemUsage.mockResolvedValue(new Map());
    users.getById.mockResolvedValue({ id: SELLER });
    users.hasBankProfile.mockReturnValue(true);
    categories.findById.mockResolvedValue({ id: 2, isActive: true });
    cache.getVersion.mockResolvedValue(3);
    cache.getOrSet.mockImplementation(
      (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
    );
    repository.searchOpen.mockResolvedValue([]);
    service = new CampaignsService(
      repository as unknown as CampaignsRepository,
      users as unknown as UsersService,
      categories as unknown as CategoriesService,
      cache as unknown as CacheService,
      images as unknown as ListingImagesService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('stores a draft with its products in the order given', async () => {
      await service.create(
        SELLER,
        input({
          items: [
            itemInput(),
            itemInput({ title: 'Xôi', combos: [], selling: false }),
          ],
        }),
      );

      expect(repository.insert).toHaveBeenCalledWith(
        {
          sellerId: SELLER,
          status: CampaignStatus.Draft,
          publishedAt: null,
          closedAt: null,
          categoryId: 2,
          title: 'Bánh bao tuần này',
          description: 'Giao tận tầng',
          orderDeadline: new Date('2026-10-15T10:00:00Z'),
          deliveryDate: '2026-10-17',
          acceptsPrepaidQr: false,
          acceptsPayOnDelivery: true,
          searchText: 'banh bao tuan nay',
        },
        [
          {
            id: null,
            title: 'Bánh bao chay',
            description: 'Nhân nấm',
            unit: 'cái',
            unitPrice: 15_000,
            combos: [{ quantity: '10', price: 140_000 }],
            status: ListingStatus.Draft,
            sortOrder: 0,
            publishedAt: null,
          },
          expect.objectContaining({
            title: 'Xôi',
            combos: [],
            status: ListingStatus.Closed,
            sortOrder: 1,
            publishedAt: null,
          }),
        ],
      );
      expect(cache.bumpVersion).toHaveBeenCalledWith('listings');
    });

    it('answers INVALID_CAMPAIGN with every problem of the input', async () => {
      const error = await rejection(
        service.create(
          SELLER,
          input({ title: 'abc', items: [itemInput({ title: 'X' })] }),
        ),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('INVALID_CAMPAIGN');
      expect(error.details).toEqual({
        problems: [
          'title must be 5-120 characters',
          'item 1: title must be 2-120 characters',
        ],
      });
      expect(error.message).toBe(
        'title must be 5-120 characters; item 1: title must be 2-120 characters',
      );
      expect(repository.insert).not.toHaveBeenCalled();
      expect(cache.bumpVersion).not.toHaveBeenCalled();
    });

    it('refuses a product id: a new round has no products yet', async () => {
      const error = await rejection(
        service.create(
          SELLER,
          input({ items: [itemInput(), itemInput({ id: 'item-9' })] }),
        ),
      );

      expect(error.code).toBe('INVALID_CAMPAIGN');
      expect(error.details).toEqual({
        problems: ['item 2: unknown product'],
      });
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('rejects an unknown category', async () => {
      categories.findById.mockResolvedValue(null);

      const error = await service
        .create(SELLER, input())
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe('Unknown category');
    });

    it('refuses a hidden category', async () => {
      categories.findById.mockResolvedValue({ id: 2, isActive: false });

      const error = await rejection(service.create(SELLER, input()));

      expect(error.getStatus()).toBe(400);
      expect(error.code).toBe('CATEGORY_INACTIVE');
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('requires a bank profile to accept QR payments', async () => {
      users.hasBankProfile.mockReturnValue(false);

      const error = await rejection(
        service.create(SELLER, input({ acceptsPrepaidQr: true })),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('BANK_PROFILE_REQUIRED');
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('does not look at the bank profile for pay-on-delivery only', async () => {
      users.hasBankProfile.mockReturnValue(false);

      await service.create(SELLER, input());

      expect(users.getById).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const edit = () =>
      input({
        items: [
          itemInput({ id: 'item-2', title: 'Bánh bao nhân thịt' }),
          itemInput({ title: 'Xôi' }),
          itemInput({ id: 'item-1', selling: false }),
        ],
      });

    it('writes the products of a draft as drafts and never deletes kept ones', async () => {
      await service.update(SELLER, 'campaign-1', edit());

      expect(repository.save).toHaveBeenCalledWith(
        'campaign-1',
        expect.objectContaining({
          title: 'Bánh bao tuần này',
          searchText: 'banh bao tuan nay',
          categoryId: 2,
        }),
        [
          expect.objectContaining({
            id: 'item-2',
            title: 'Bánh bao nhân thịt',
            status: ListingStatus.Draft,
            sortOrder: 0,
            publishedAt: null,
          }),
          expect.objectContaining({
            id: null,
            title: 'Xôi',
            status: ListingStatus.Draft,
            sortOrder: 1,
            publishedAt: null,
          }),
          expect.objectContaining({
            id: 'item-1',
            status: ListingStatus.Closed,
            sortOrder: 2,
            publishedAt: null,
          }),
        ],
        [],
        CampaignStatus.Draft,
      );
      expect(repository.save.mock.calls[0][1]).not.toHaveProperty('status');
      expect(repository.save.mock.calls[0][1]).not.toHaveProperty('sellerId');
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it('writes the products of an open round as open, new ones published now', async () => {
      repository.findById.mockResolvedValue(
        stored({ status: CampaignStatus.Open }),
      );

      await service.update(SELLER, 'campaign-1', edit());

      expect(repository.save.mock.calls[0][4]).toBe(CampaignStatus.Open);
      expect(repository.save.mock.calls[0][2]).toEqual([
        expect.objectContaining({
          id: 'item-2',
          status: ListingStatus.Open,
          publishedAt: NOW,
        }),
        expect.objectContaining({
          id: null,
          status: ListingStatus.Open,
          publishedAt: NOW,
        }),
        expect.objectContaining({
          id: 'item-1',
          status: ListingStatus.Closed,
          publishedAt: null,
        }),
      ]);
    });

    it('deletes the products that are left out', async () => {
      await service.update(
        SELLER,
        'campaign-1',
        input({ items: [itemInput({ id: 'item-2' })] }),
      );

      expect(repository.save.mock.calls[0][3]).toEqual(['item-1']);
    });

    it('removes the photo files of the deleted products once the save is done', async () => {
      repository.findById.mockResolvedValue(storedWithPhotos());
      repository.save.mockImplementation(() => {
        expect(images.removeFiles).not.toHaveBeenCalled();
        return Promise.resolve();
      });

      await service.update(
        SELLER,
        'campaign-1',
        input({ items: [itemInput({ id: 'item-2' })] }),
      );

      expect(images.removeFiles).toHaveBeenCalledTimes(1);
      expect(images.removeFiles).toHaveBeenCalledWith([
        'listings/item-1/a.webp',
        'listings/item-1/b.webp',
      ]);
    });

    it('keeps every photo file when the save fails', async () => {
      repository.findById.mockResolvedValue(storedWithPhotos());
      repository.save.mockRejectedValue(
        new CampaignItemsInUseError([{ listingId: 'item-1', title: 'Bánh' }]),
      );

      await rejection(
        service.update(
          SELLER,
          'campaign-1',
          input({ items: [itemInput({ id: 'item-2' })] }),
        ),
      );

      expect(images.removeFiles).not.toHaveBeenCalled();
    });

    it('answers CAMPAIGN_ITEM_HAS_ORDERS when a product to delete has orders', async () => {
      const items = [{ listingId: 'item-1', title: 'Bánh bao chay' }];
      repository.save.mockRejectedValue(new CampaignItemsInUseError(items));

      const error = await rejection(
        service.update(
          SELLER,
          'campaign-1',
          input({ items: [itemInput({ id: 'item-2' })] }),
        ),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('CAMPAIGN_ITEM_HAS_ORDERS');
      expect(error.details).toEqual({ items });
      expect(cache.bumpVersion).not.toHaveBeenCalled();
    });

    it('passes any other failure of the save on', async () => {
      repository.save.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.update(SELLER, 'campaign-1', input()),
      ).rejects.toThrow('connection lost');
    });

    it('refuses a product id of another round', async () => {
      const error = await rejection(
        service.update(
          SELLER,
          'campaign-1',
          input({
            items: [itemInput({ id: 'item-1' }), itemInput({ id: 'x' })],
          }),
        ),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('INVALID_CAMPAIGN');
      expect(error.details).toEqual({ problems: ['item 2: unknown product'] });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('refuses to edit a closed round', async () => {
      repository.findById.mockResolvedValue(
        stored({ status: CampaignStatus.Closed }),
      );

      const error = await rejection(
        service.update(SELLER, 'campaign-1', input()),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('INVALID_LISTING_STATE');
      expect(error.message).toBe('A closed round cannot be edited');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('lets a round stay in a category that was hidden later', async () => {
      categories.findById.mockResolvedValue({ id: 2, isActive: false });

      await service.update(SELLER, 'campaign-1', input());

      expect(repository.save).toHaveBeenCalled();
    });

    it('refuses to move a round into a hidden category', async () => {
      categories.findById.mockResolvedValue({ id: 5, isActive: false });

      const error = await rejection(
        service.update(SELLER, 'campaign-1', input({ categoryId: 5 })),
      );

      expect(error.code).toBe('CATEGORY_INACTIVE');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('is 404 for a missing round and 403 for someone else’s', async () => {
      await expect(
        service.update(OTHER, 'campaign-1', input()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      repository.findById.mockResolvedValue(null);
      await expect(
        service.update(SELLER, 'missing', input()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('opens a draft and its draft products at the same time', async () => {
      await service.publish(SELLER, 'campaign-1');

      expect(repository.setStatus).toHaveBeenCalledWith(
        'campaign-1',
        { status: CampaignStatus.Open, publishedAt: NOW },
        CampaignStatus.Draft,
        { from: ListingStatus.Draft, to: ListingStatus.Open, publishedAt: NOW },
      );
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it.each([CampaignStatus.Open, CampaignStatus.Closed])(
      'refuses a round that is %s',
      async (status) => {
        repository.findById.mockResolvedValue(stored({ status }));

        const error = await rejection(service.publish(SELLER, 'campaign-1'));

        expect(error.code).toBe('INVALID_LISTING_STATE');
        expect(repository.setStatus).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['in the past', new Date('2026-10-12T02:59:59Z')],
      ['exactly now', NOW],
    ])('refuses a deadline that is %s', async (_label, orderDeadline) => {
      repository.findById.mockResolvedValue(stored({ orderDeadline }));

      await expect(service.publish(SELLER, 'campaign-1')).rejects.toThrow(
        'The order deadline must be in the future',
      );
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it('re-checks the bank profile when the round accepts QR', async () => {
      repository.findById.mockResolvedValue(stored({ acceptsPrepaidQr: true }));
      users.hasBankProfile.mockReturnValue(false);

      const error = await rejection(service.publish(SELLER, 'campaign-1'));

      expect(error.code).toBe('BANK_PROFILE_REQUIRED');
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it.each([[{ id: 2, isActive: false }], [null]])(
      'refuses a draft whose category is hidden or gone (%j)',
      async (category) => {
        categories.findById.mockResolvedValue(category);

        const error = await rejection(service.publish(SELLER, 'campaign-1'));

        expect(error.code).toBe('CATEGORY_INACTIVE');
        expect(repository.setStatus).not.toHaveBeenCalled();
      },
    );

    it('is 403 for someone else’s round', async () => {
      await expect(service.publish(OTHER, 'campaign-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('close', () => {
    it('closes an open round and leaves its products as they are', async () => {
      repository.findById.mockResolvedValue(
        stored({ status: CampaignStatus.Open }),
      );

      await service.close(SELLER, 'campaign-1');

      expect(repository.setStatus).toHaveBeenCalledWith(
        'campaign-1',
        { status: CampaignStatus.Closed, closedAt: NOW },
        CampaignStatus.Open,
      );
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it.each([CampaignStatus.Draft, CampaignStatus.Closed])(
      'refuses a round that is %s',
      async (status) => {
        repository.findById.mockResolvedValue(stored({ status }));

        const error = await rejection(service.close(SELLER, 'campaign-1'));

        expect(error.code).toBe('INVALID_LISTING_STATE');
        expect(repository.setStatus).not.toHaveBeenCalled();
      },
    );
  });

  describe('remove', () => {
    it('deletes a draft', async () => {
      await service.remove(SELLER, 'campaign-1');

      expect(repository.delete).toHaveBeenCalledWith(
        'campaign-1',
        CampaignStatus.Draft,
      );
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it('removes the photo files of its products once it is deleted', async () => {
      repository.findById.mockResolvedValue(storedWithPhotos());
      repository.delete.mockImplementation(() => {
        expect(images.removeFiles).not.toHaveBeenCalled();
        return Promise.resolve();
      });

      await service.remove(SELLER, 'campaign-1');

      expect(images.removeFiles).toHaveBeenCalledTimes(1);
      expect(images.removeFiles).toHaveBeenCalledWith([
        'listings/item-1/a.webp',
        'listings/item-1/b.webp',
        'listings/item-2/c.webp',
      ]);
    });

    it('keeps every photo file when the delete fails', async () => {
      repository.findById.mockResolvedValue(storedWithPhotos());
      repository.delete.mockRejectedValue(new CampaignStateChangedError(false));

      await rejection(service.remove(SELLER, 'campaign-1'));

      expect(images.removeFiles).not.toHaveBeenCalled();
      expect(cache.bumpVersion).not.toHaveBeenCalled();
    });

    it.each([CampaignStatus.Open, CampaignStatus.Closed])(
      'refuses a round that is %s',
      async (status) => {
        repository.findById.mockResolvedValue(stored({ status }));

        const error = await rejection(service.remove(SELLER, 'campaign-1'));

        expect(error.getStatus()).toBe(409);
        expect(error.code).toBe('INVALID_LISTING_STATE');
        expect(repository.delete).not.toHaveBeenCalled();
      },
    );

    it('is 403 for someone else’s round', async () => {
      await expect(service.remove(OTHER, 'campaign-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('a round that changed under a write', () => {
    const open = () => stored({ status: CampaignStatus.Open });
    const calls: Array<[string, () => Promise<unknown>, () => void]> = [
      [
        'update',
        () => service.update(SELLER, 'campaign-1', input()),
        () =>
          repository.save.mockRejectedValue(
            new CampaignStateChangedError(false),
          ),
      ],
      [
        'publish',
        () => service.publish(SELLER, 'campaign-1'),
        () =>
          repository.setStatus.mockRejectedValue(
            new CampaignStateChangedError(false),
          ),
      ],
      [
        'close',
        () => service.close(SELLER, 'campaign-1'),
        () =>
          repository.setStatus.mockRejectedValue(
            new CampaignStateChangedError(false),
          ),
      ],
      [
        'remove',
        () => service.remove(SELLER, 'campaign-1'),
        () =>
          repository.delete.mockRejectedValue(
            new CampaignStateChangedError(false),
          ),
      ],
    ];

    it.each(calls)(
      '%s answers 409 INVALID_LISTING_STATE',
      async (name, run, fail) => {
        repository.findById.mockResolvedValue(
          name === 'close' ? open() : stored(),
        );
        fail();

        const error = await rejection(run());

        expect(error.getStatus()).toBe(409);
        expect(error.code).toBe('INVALID_LISTING_STATE');
        expect(error.message).toBe('The round changed; reload and try again');
        expect(cache.bumpVersion).not.toHaveBeenCalled();
      },
    );

    it.each(calls)(
      '%s answers 404 when the round is gone',
      async (name, run, fail) => {
        repository.findById.mockResolvedValue(
          name === 'close' ? open() : stored(),
        );
        fail();
        const gone = new CampaignStateChangedError(true);
        repository.save.mockRejectedValue(gone);
        repository.setStatus.mockRejectedValue(gone);
        repository.delete.mockRejectedValue(gone);

        await expect(run()).rejects.toBeInstanceOf(NotFoundException);
        expect(cache.bumpVersion).not.toHaveBeenCalled();
      },
    );
  });

  describe('getDetail', () => {
    const open = () =>
      stored({
        status: CampaignStatus.Open,
        publishedAt: new Date('2026-10-11T03:00:00Z'),
        items: [
          storedItem({ status: ListingStatus.Closed, unitPrice: 9_000 }),
          storedItem({
            id: 'item-2',
            status: ListingStatus.Open,
            unitPrice: 18_000,
          }),
          storedItem({
            id: 'item-3',
            status: ListingStatus.Open,
            unitPrice: 12_000,
          }),
        ],
      });

    it('gives the seller every product with its order numbers', async () => {
      repository.findById.mockResolvedValue(open());
      repository.itemUsage.mockResolvedValue(
        new Map([
          ['item-1', { orderCount: 2, referenced: true }],
          ['item-2', { orderCount: 0, referenced: true }],
        ]),
      );

      const detail = await service.getDetail(SELLER, 'campaign-1');

      expect(detail).toMatchObject({
        id: 'campaign-1',
        status: CampaignStatus.Open,
        isOpen: true,
        itemCount: 2,
        minPrice: 12_000,
        orderDeadline: '2026-10-15T10:00:00.000Z',
        deliveryDate: '2026-10-17',
        publishedAt: '2026-10-11T03:00:00.000Z',
        seller: { id: SELLER, handle: 'seller' },
      });
      expect(
        detail.items.map((item) => [
          item.id,
          item.selling,
          item.orderCount,
          item.removable,
        ]),
      ).toEqual([
        ['item-1', false, 2, false],
        ['item-2', true, 0, false],
        ['item-3', true, 0, true],
      ]);
    });

    it('gives everyone else the products on sale, without numbers', async () => {
      repository.findById.mockResolvedValue(open());

      const detail = await service.getDetail(OTHER, 'campaign-1');

      expect(
        detail.items.map((item) => [
          item.id,
          item.selling,
          item.orderCount,
          item.removable,
        ]),
      ).toEqual([
        ['item-2', true, 0, false],
        ['item-3', true, 0, false],
      ]);
      expect(repository.itemUsage).not.toHaveBeenCalled();
    });

    it('never shows others a product that is not open, even in an open round', async () => {
      repository.findById.mockResolvedValue(
        stored({
          status: CampaignStatus.Open,
          items: [
            storedItem({ status: ListingStatus.Draft }),
            storedItem({ id: 'item-2', status: ListingStatus.Open }),
          ],
        }),
      );

      const detail = await service.getDetail(OTHER, 'campaign-1');

      expect(detail.items.map((item) => item.id)).toEqual(['item-2']);
      expect(detail.itemCount).toBe(1);
    });

    it('still shows a closed or expired round, as not open', async () => {
      repository.findById.mockResolvedValue(
        stored({ status: CampaignStatus.Closed }),
      );
      await expect(
        service.getDetail(OTHER, 'campaign-1'),
      ).resolves.toMatchObject({ isOpen: false });

      repository.findById.mockResolvedValue(
        stored({
          status: CampaignStatus.Open,
          orderDeadline: new Date('2026-10-12T02:00:00Z'),
        }),
      );
      await expect(
        service.getDetail(OTHER, 'campaign-1'),
      ).resolves.toMatchObject({ isOpen: false });
    });

    it('hides a draft from everyone else, and a missing round from all', async () => {
      await expect(
        service.getDetail(OTHER, 'campaign-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getDetail(SELLER, 'campaign-1'),
      ).resolves.toMatchObject({ status: CampaignStatus.Draft, itemCount: 2 });

      repository.findById.mockResolvedValue(null);
      await expect(service.getDetail(SELLER, 'campaign-1')).rejects.toThrow(
        'Round not found',
      );
    });

    it('has no lowest price when nothing is on sale', async () => {
      repository.findById.mockResolvedValue(
        stored({ items: [storedItem({ status: ListingStatus.Closed })] }),
      );

      await expect(
        service.getDetail(SELLER, 'campaign-1'),
      ).resolves.toMatchObject({ itemCount: 0, minPrice: 0, thumbnails: [] });
    });

    it('shows the first photo of up to four products', async () => {
      const withPhoto = (id: string) =>
        storedItem({
          id,
          images: [
            { id: `${id}-a`, storageKey: `listings/${id}/a.webp` },
            { id: `${id}-b`, storageKey: `listings/${id}/b.webp` },
          ] as Listing['images'],
        });
      repository.findById.mockResolvedValue(
        stored({
          items: [
            withPhoto('i1'),
            storedItem({ id: 'i2' }),
            withPhoto('i3'),
            withPhoto('i4'),
            withPhoto('i5'),
            withPhoto('i6'),
          ],
        }),
      );

      const detail = await service.getDetail(SELLER, 'campaign-1');

      expect(detail.thumbnails).toHaveLength(4);
      expect(detail.thumbnails[0]).toContain('listings/i1/a');
      expect(detail.thumbnails[3]).toContain('listings/i5/a');
      expect(detail.items[0].images).toHaveLength(2);
    });
  });

  describe('search', () => {
    const row = (id: string, deadline: string) => ({
      id,
      title: `Round ${id}`,
      order_deadline: new Date(deadline),
      delivery_date: '2026-10-20',
      category_id: 2,
      category_slug: 'do-an',
      category_name: 'Đồ ăn',
      category_name_en: 'Food',
      category_is_perishable: true,
      seller_id: SELLER,
      seller_name: 'Seller',
      seller_email: 'an.nguyen@example.com',
      seller_avatar_url: null,
      item_count: 2,
      min_price: 15_000,
      image_keys: ['listings/a/x.webp'],
    });
    const IDS = {
      a: '11111111-1111-4111-8111-111111111111',
      b: '22222222-2222-4222-8222-222222222222',
      c: '33333333-3333-4333-8333-333333333333',
    };
    const lastCall = () => repository.searchOpen.mock.calls.at(-1)?.[0];

    it('clamps the limit to 1..50, asks for one row more and defaults to 20', async () => {
      await service.search({});
      expect(lastCall()).toMatchObject({ limit: 21, now: NOW });
      await service.search({ limit: 500 });
      expect(lastCall().limit).toBe(51);
      await service.search({ limit: 0 });
      expect(lastCall().limit).toBe(2);
    });

    it('shapes the rows and gives a cursor only when there is one more', async () => {
      repository.searchOpen.mockResolvedValue([
        row(IDS.a, '2026-10-13T10:00:00Z'),
        row(IDS.b, '2026-10-14T10:00:00Z'),
        row(IDS.c, '2026-10-15T10:00:00Z'),
      ]);

      const page = await service.search({ limit: 2 });

      expect(page.items.map((item) => item.id)).toEqual([IDS.a, IDS.b]);
      expect(page.items[0]).toMatchObject({
        title: `Round ${IDS.a}`,
        orderDeadline: '2026-10-13T10:00:00.000Z',
        deliveryDate: '2026-10-20',
        itemCount: 2,
        minPrice: 15_000,
        seller: { id: SELLER, handle: 'an.nguyen', avatarUrl: null },
        category: { id: 2, slug: 'do-an', nameEn: 'Food' },
      });
      expect(page.items[0].thumbnails).toHaveLength(1);
      expect(page.items[0].thumbnails[0]).toContain('listings/a/x');
      expect(decodeCampaignCursor(page.nextCursor as string)).toEqual({
        orderDeadline: '2026-10-14T10:00:00.000Z',
        id: IDS.b,
      });

      repository.searchOpen.mockResolvedValue([
        row(IDS.a, '2026-10-13T10:00:00Z'),
      ]);
      await expect(service.search({ limit: 2 })).resolves.toMatchObject({
        nextCursor: null,
      });
    });

    it('answers an empty page for an unknown category without a query', async () => {
      categories.findBySlug.mockResolvedValue(null);

      await expect(service.search({ category: 'nope' })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(repository.searchOpen).not.toHaveBeenCalled();
    });

    it('turns the filters into query arguments', async () => {
      categories.findBySlug.mockResolvedValue({ id: 2 });

      await service.search({
        q: 'Thịt bao',
        category: 'do-an',
        minPrice: 1_000,
        maxPrice: 20_000,
        sellerId: SELLER,
      });

      expect(lastCall()).toMatchObject({
        tsQuery: 'thit & bao:*',
        categoryId: 2,
        minPrice: 1_000,
        maxPrice: 20_000,
        sellerId: SELLER,
        cursor: null,
      });
    });

    it('rejects a lowest price above the highest', async () => {
      await expect(
        service.search({ minPrice: 20_000, maxPrice: 10_000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a malformed cursor and passes a good one on', async () => {
      await expect(
        service.search({ cursor: 'garbage' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const cursor = {
        orderDeadline: '2026-10-14T10:00:00.000Z',
        id: '6f9619ff-8b86-4011-b42d-00c04fc964ff',
      };

      await service.search({ cursor: encodeCampaignCursor(cursor) });

      expect(lastCall().cursor).toEqual(cursor);
    });

    it('caches by version and by every parameter', async () => {
      await service.search({});
      await service.search({ q: 'bao' });
      await service.search({ limit: 5 });
      await service.search({ minPrice: 1 });
      cache.getVersion.mockResolvedValue(4);
      await service.search({});

      const keys = cache.getOrSet.mock.calls.map((call) => call[0] as string);
      expect(new Set(keys).size).toBe(5);
      expect(keys[0]).toMatch(/^listings:v3:campaigns:[0-9a-f]{64}$/);
      expect(keys[4]).toMatch(/^listings:v4:campaigns:/);
      expect(cache.getOrSet.mock.calls[0][1]).toBe(60);
    });
  });

  describe('getDetail through the cache', () => {
    const open = () =>
      stored({
        status: CampaignStatus.Open,
        items: [storedItem({ status: ListingStatus.Open })],
      });

    it('reads others’ view through the cache and recomputes isOpen', async () => {
      const cachedDto = CampaignDetailDto.from(open(), NOW);
      cachedDto.orderDeadline = '2026-10-12T02:00:00.000Z';
      cachedDto.isOpen = true;
      cache.getOrSet.mockResolvedValue(cachedDto);

      const detail = await service.getDetail(OTHER, 'campaign-1');

      expect(cache.getOrSet.mock.calls[0][0]).toBe(
        'listings:v3:campaign:campaign-1',
      );
      expect(detail.isOpen).toBe(false);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('gives the seller the database view even when a cached copy exists', async () => {
      cache.getOrSet.mockResolvedValue(CampaignDetailDto.from(open(), NOW));
      repository.findById.mockResolvedValue(open());

      await service.getDetail(SELLER, 'campaign-1');

      expect(repository.itemUsage).toHaveBeenCalledWith('campaign-1');
    });

    it('never caches a draft or a missing round', async () => {
      cache.getOrSet.mockImplementation(
        async (_k: string, _t: number, loader: () => Promise<unknown>) =>
          loader(),
      );
      repository.findById.mockResolvedValue(stored());

      await expect(
        service.getDetail(OTHER, 'campaign-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reopen', () => {
    const finished = () =>
      stored({
        status: CampaignStatus.Closed,
        title: 'Bánh bao',
        description: 'Giao tận tầng',
        searchText: 'banh bao',
        acceptsPrepaidQr: true,
        orderDeadline: new Date('2026-10-05T10:00:00Z'),
        deliveryDate: '2026-10-07',
        items: [
          storedItem({
            id: 'old-1',
            title: 'Bánh chay',
            sortOrder: 0,
            status: ListingStatus.Open,
            combos: [{ quantity: '10', price: 140_000 }] as Listing['combos'],
            images: [{ id: 'img-1' }] as Listing['images'],
          }),
          storedItem({
            id: 'old-2',
            sortOrder: 1,
            status: ListingStatus.Closed,
          }),
          storedItem({
            id: 'old-3',
            title: 'Bánh thịt',
            sortOrder: 2,
            status: ListingStatus.Open,
            unitPrice: 18_000,
            images: [{ id: 'img-3' }] as Listing['images'],
          }),
        ],
      });

    it('refuses a draft and a round still taking orders', async () => {
      repository.findById.mockResolvedValue(stored());
      expect(
        (await rejection(service.reopen(SELLER, 'campaign-1'))).getStatus(),
      ).toBe(409);

      repository.findById.mockResolvedValue(
        stored({ status: CampaignStatus.Open }),
      );
      expect(
        (await rejection(service.reopen(SELLER, 'campaign-1'))).getStatus(),
      ).toBe(409);
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('is 403 for someone else’s round', async () => {
      repository.findById.mockResolvedValue(finished());

      await expect(service.reopen(OTHER, 'campaign-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('inserts a draft with the shared terms, moved dates and the products on sale', async () => {
      repository.findById
        .mockResolvedValueOnce(finished())
        .mockResolvedValueOnce(
          stored({
            id: 'new-1',
            items: [
              storedItem({ id: 'new-a', sortOrder: 0 }),
              storedItem({ id: 'new-b', sortOrder: 1 }),
            ],
          }),
        );

      const result = await service.reopen(SELLER, 'campaign-1');

      expect(result.id).toBe('new-1');
      const [fields, items] = repository.insert.mock.calls[0];
      expect(fields).toMatchObject({
        sellerId: SELLER,
        categoryId: 2,
        title: 'Bánh bao',
        description: 'Giao tận tầng',
        acceptsPrepaidQr: true,
        acceptsPayOnDelivery: true,
        searchText: 'banh bao',
        status: CampaignStatus.Draft,
        publishedAt: null,
        closedAt: null,
        reopenedFromId: 'campaign-1',
        // 05 Oct + 1 week, 17:00 in Vietnam; delivery two days later
        orderDeadline: new Date('2026-10-12T10:00:00Z'),
        deliveryDate: '2026-10-14',
      });
      expect(
        items.map((item: ItemWrite) => [
          item.id,
          item.title,
          item.unitPrice,
          item.status,
          item.sortOrder,
          item.publishedAt,
        ]),
      ).toEqual([
        [null, 'Bánh chay', 15_000, ListingStatus.Draft, 0, null],
        [null, 'Bánh thịt', 18_000, ListingStatus.Draft, 1, null],
      ]);
      expect(items[0].combos).toEqual([{ quantity: '10', price: 140_000 }]);
      expect(cache.bumpVersion).toHaveBeenCalledWith('listings');
    });

    it('copies the photos of each product into its new twin', async () => {
      const source = finished();
      repository.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(
        stored({
          id: 'new-1',
          items: [
            storedItem({ id: 'new-a', sortOrder: 0 }),
            storedItem({ id: 'new-b', sortOrder: 1 }),
          ],
        }),
      );

      await service.reopen(SELLER, 'campaign-1');

      expect(images.copyAll).toHaveBeenCalledTimes(2);
      expect(images.copyAll).toHaveBeenNthCalledWith(
        1,
        source.items[0].images,
        'new-a',
      );
      expect(images.copyAll).toHaveBeenNthCalledWith(
        2,
        source.items[2].images,
        'new-b',
      );
    });

    describe('when a photo cannot be copied', () => {
      const twins = () =>
        stored({
          id: 'new-1',
          items: [
            storedItem({ id: 'new-a', sortOrder: 0 }),
            storedItem({ id: 'new-b', sortOrder: 1 }),
          ],
        });

      beforeEach(() => {
        repository.insert.mockResolvedValue('new-1');
        images.copyAll
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('disk full'));
      });

      it('deletes the new draft and the files already copied, and fails', async () => {
        repository.findById
          .mockResolvedValueOnce(finished())
          .mockResolvedValueOnce(twins())
          // Read again for the photos the first product did get.
          .mockResolvedValueOnce(
            stored({
              id: 'new-1',
              items: [
                storedItem({
                  id: 'new-a',
                  images: photos('listings/new-a/x.webp'),
                }),
                storedItem({ id: 'new-b' }),
              ],
            }),
          );

        await expect(service.reopen(SELLER, 'campaign-1')).rejects.toThrow(
          'disk full',
        );

        expect(repository.delete).toHaveBeenCalledWith(
          'new-1',
          CampaignStatus.Draft,
        );
        expect(images.removeFiles).toHaveBeenCalledWith([
          'listings/new-a/x.webp',
        ]);
        expect(repository.delete.mock.invocationCallOrder[0]).toBeLessThan(
          images.removeFiles.mock.invocationCallOrder[0],
        );
      });

      it('still fails with the copy error when the draft cannot be deleted', async () => {
        const logged = vi
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        repository.findById
          .mockResolvedValueOnce(finished())
          .mockResolvedValue(twins());
        repository.delete.mockRejectedValue(new Error('connection lost'));

        await expect(service.reopen(SELLER, 'campaign-1')).rejects.toThrow(
          'disk full',
        );

        expect(logged).toHaveBeenCalledTimes(1);
        expect(logged.mock.calls[0][0]).toContain('new-1');
        // The rows are still there, so their files must be too.
        expect(images.removeFiles).not.toHaveBeenCalled();
      });
    });
  });

  it('lists the seller’s rounds with whether each still takes orders', async () => {
    const row = {
      id: 'campaign-1',
      title: 'Bánh bao tuần này',
      status: CampaignStatus.Open,
      order_deadline: new Date('2026-10-15T10:00:00Z'),
      delivery_date: '2026-10-17',
      created_at: new Date('2026-10-10T01:00:00Z'),
      item_count: 3,
      order_count: 5,
    };
    repository.findBySeller.mockResolvedValue([
      row,
      { ...row, id: 'campaign-2', order_deadline: NOW },
    ]);

    await expect(service.listMine(SELLER)).resolves.toEqual([
      {
        id: 'campaign-1',
        title: 'Bánh bao tuần này',
        status: CampaignStatus.Open,
        isOpen: true,
        orderDeadline: '2026-10-15T10:00:00.000Z',
        deliveryDate: '2026-10-17',
        itemCount: 3,
        orderCount: 5,
        createdAt: '2026-10-10T01:00:00.000Z',
      },
      expect.objectContaining({ id: 'campaign-2', isOpen: false }),
    ]);
    expect(repository.findBySeller).toHaveBeenCalledWith(SELLER);
  });

  it('finds any round for other modules, and an owned one for writes', async () => {
    await expect(service.findById('campaign-1')).resolves.toMatchObject({
      id: 'campaign-1',
    });
    await expect(
      service.findOwned(SELLER, 'campaign-1'),
    ).resolves.toMatchObject({ id: 'campaign-1' });
    await expect(service.findOwned(OTHER, 'campaign-1')).rejects.toThrow(
      'You can only change your own rounds',
    );
    repository.findById.mockResolvedValue(null);
    await expect(service.findOwned(SELLER, 'missing')).rejects.toThrow(
      'Round not found',
    );
    await expect(service.findById('missing')).resolves.toBeNull();
  });
});
