import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { CategoriesService } from '../categories/categories.service.js';
import { Listing } from '../listings/listing.entity.js';
import { ListingStatus } from '../listings/listings.constants.js';
import type { UsersService } from '../users/users.service.js';
import type { CampaignInput, CampaignItemInput } from './campaign-rules.js';
import { Campaign, CampaignStatus } from './campaign.entity.js';
import {
  CampaignItemsInUseError,
  CampaignStateChangedError,
  type CampaignsRepository,
} from './campaigns.repository.js';
import { CampaignsService } from './campaigns.service.js';

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
  };
  const users = { getById: vi.fn(), hasBankProfile: vi.fn() };
  const categories = { findById: vi.fn() };
  const cache = { bumpVersion: vi.fn() };
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
    service = new CampaignsService(
      repository as unknown as CampaignsRepository,
      users as unknown as UsersService,
      categories as unknown as CategoriesService,
      cache as unknown as CacheService,
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
