import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { OutboxService } from '../../events/outbox.service.js';
import type { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { CategoriesService } from '../categories/categories.service.js';
import type { UsersService } from '../users/users.service.js';
import type { ListingInput } from './listing-rules.js';
import { Listing } from './listing.entity.js';
import {
  ListingCondition,
  ListingMode,
  ListingStatus,
} from './listings.constants.js';
import { decodeCursor, encodeCursor } from './listing-cursor.js';
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
    condition: ListingCondition.Good,
    unit: 'cái',
    unitPrice: 500_000,
    stockQuantity: '1',
    combos: [{ quantity: '2', price: 900_000 }],
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
    campaignId: null,
    campaign: null,
    title: 'Loa',
    unitPrice: 500_000,
    seller: { name: 'Seller' },
    category: { name: 'Đồ điện tử' },
    ...overrides,
  });
}

/** A product of a pre-order round, as the repository loads it. */
function item(
  campaign: { status: 'draft' | 'open' | 'closed'; orderDeadline: Date },
  overrides: Partial<Listing> = {},
): Listing {
  return stored({
    mode: ListingMode.Preorder,
    status: ListingStatus.Open,
    acceptsPrepaidQr: null,
    acceptsPayOnDelivery: null,
    campaignId: 'campaign-1',
    campaign: campaign as Listing['campaign'],
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
    publishDraft: vi.fn(),
  };
  const users = { getById: vi.fn(), hasBankProfile: vi.fn() };
  const categories = { findById: vi.fn() };
  const cache = { bumpVersion: vi.fn() };
  const outbox = { add: vi.fn() };
  let service: ListingsService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ now: new Date('2026-10-05T03:00:00Z') });
    repository.insert.mockResolvedValue('listing-1');
    repository.findByIdWithRelations.mockResolvedValue(stored());
    users.getById.mockResolvedValue({ id: SELLER });
    users.hasBankProfile.mockReturnValue(true);
    categories.findById.mockResolvedValue({ id: 1, isActive: true });
    service = new ListingsService(
      repository as unknown as ListingsRepository,
      users as unknown as UsersService,
      categories as unknown as CategoriesService,
      cache as unknown as CacheService,
      outbox as unknown as OutboxService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('stores a draft with trimmed text, search text, price and combos', async () => {
      await service.create(SELLER, input());

      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: SELLER,
          status: ListingStatus.Draft,
          title: 'Loa bluetooth cũ',
          searchText: 'loa bluetooth cu con moi',
          unit: 'cái',
          unitPrice: 500_000,
          stockQuantity: '1',
          publishedAt: null,
        }),
        [{ quantity: '2', price: 900_000 }],
      );
      expect(cache.bumpVersion).toHaveBeenCalledWith('listings');
    });

    it('rejects invalid input with every problem in the message', async () => {
      await expect(
        service.create(SELLER, input({ title: 'abc', unitPrice: 1 })),
      ).rejects.toThrow(
        'title must be 5-120 characters; unit price must be a whole number from 1000 to 1000000000',
      );
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('refuses a pre-order: those are created as a round', async () => {
      await expect(
        service.create(
          SELLER,
          input({
            mode: ListingMode.Preorder,
            condition: null,
            stockQuantity: null,
          }),
        ),
      ).rejects.toThrow('pre-orders are created as a round');
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('rejects an unknown category', async () => {
      categories.findById.mockResolvedValue(null);

      await expect(service.create(SELLER, input())).rejects.toThrow(
        'Unknown category',
      );
    });

    it('refuses a hidden category', async () => {
      categories.findById.mockResolvedValue({ id: 1, isActive: false });

      await expect(codeOf(service.create(SELLER, input()))).resolves.toBe(
        'CATEGORY_INACTIVE',
      );
      expect(repository.insert).not.toHaveBeenCalled();
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
    it('replaces the fields and combos and bumps the cache', async () => {
      await service.update(
        SELLER,
        'listing-1',
        input({ title: 'Loa mới hơn' }),
      );

      expect(repository.update).toHaveBeenCalledWith(
        'listing-1',
        expect.objectContaining({ title: 'Loa mới hơn' }),
        [{ quantity: '2', price: 900_000 }],
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

    it('lets a listing stay in a category that was hidden later', async () => {
      categories.findById.mockResolvedValue({ id: 1, isActive: false });
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ categoryId: 1 }),
      );

      await service.update(SELLER, 'listing-1', input({ categoryId: 1 }));

      expect(repository.update).toHaveBeenCalled();
    });

    it('refuses to move a listing into a hidden category', async () => {
      categories.findById.mockResolvedValue({ id: 5, isActive: false });
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ categoryId: 1 }),
      );

      await expect(
        codeOf(service.update(SELLER, 'listing-1', input({ categoryId: 5 }))),
      ).resolves.toBe('CATEGORY_INACTIVE');
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
      await expect(
        service.update(
          SELLER,
          'listing-1',
          input({ mode: ListingMode.Preorder }),
        ),
      ).rejects.toThrow('The mode of a listing cannot be changed');
    });
  });

  describe('a product of a pre-order round', () => {
    const future = new Date('2026-10-06T03:00:00Z');

    it.each<[string, () => Promise<unknown>]>([
      ['edited', () => service.update(SELLER, 'listing-1', input())],
      ['published', () => service.publish(SELLER, 'listing-1')],
      ['closed', () => service.close(SELLER, 'listing-1')],
    ])('cannot be %s through the listing', async (_label, act) => {
      repository.findByIdWithRelations.mockResolvedValue(
        item({ status: 'open', orderDeadline: future }),
      );

      const error = await act().catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).code).toBe('INVALID_LISTING_STATE');
      expect((error as DomainException).message).toBe(
        'Change this product through its pre-order round',
      );
      expect(repository.update).not.toHaveBeenCalled();
      expect(cache.bumpVersion).not.toHaveBeenCalled();
    });

    it('is still 403 for someone else', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        item({ status: 'open', orderDeadline: future }),
      );

      await expect(service.close(OTHER, 'listing-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('publish', () => {
    beforeEach(() => {
      repository.publishDraft.mockResolvedValue(true);
    });

    it('opens a draft and records the time', async () => {
      await service.publish(SELLER, 'listing-1');

      expect(repository.publishDraft).toHaveBeenCalledWith(
        'listing-1',
        new Date('2026-10-05T03:00:00Z'),
        expect.any(Function),
      );
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it('writes listing.published inside the update transaction', async () => {
      outbox.add.mockResolvedValue({});
      const tx = { fake: true };

      await service.publish(SELLER, 'listing-1');
      const within = repository.publishDraft.mock.calls[0][2] as (
        tx: unknown,
      ) => Promise<void>;
      await within(tx);

      expect(outbox.add).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          type: 'listing.published',
          payload: expect.objectContaining({ listingId: 'listing-1' }),
        }),
      );
    });

    it('refuses when another publish got there first', async () => {
      repository.publishDraft.mockResolvedValue(false);

      await expect(codeOf(service.publish(SELLER, 'listing-1'))).resolves.toBe(
        'INVALID_LISTING_STATE',
      );
      expect(cache.bumpVersion).not.toHaveBeenCalled();
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

    it('re-checks the bank profile when the listing accepts QR', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        stored({ acceptsPrepaidQr: true }),
      );
      users.hasBankProfile.mockReturnValue(false);

      await expect(codeOf(service.publish(SELLER, 'listing-1'))).resolves.toBe(
        'BANK_PROFILE_REQUIRED',
      );
    });

    it('refuses a draft whose category has been hidden', async () => {
      categories.findById.mockResolvedValue({ id: 1, isActive: false });

      await expect(codeOf(service.publish(SELLER, 'listing-1'))).resolves.toBe(
        'CATEGORY_INACTIVE',
      );
      expect(repository.update).not.toHaveBeenCalled();
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

    it('shows a product of an open round to everyone', async () => {
      repository.findByIdWithRelations.mockResolvedValue(
        item({
          status: 'open',
          orderDeadline: new Date('2026-10-05T04:00:00Z'),
        }),
      );

      await expect(
        service.getForViewer(OTHER, 'listing-1'),
      ).resolves.toBeDefined();
    });

    it.each([
      ['after its deadline', 'open', new Date('2026-10-05T02:00:00Z')],
      ['once it is closed', 'closed', new Date('2026-10-05T04:00:00Z')],
      ['while it is a draft', 'draft', new Date('2026-10-05T04:00:00Z')],
    ] as const)(
      'hides a product of a round %s',
      async (_label, status, orderDeadline) => {
        repository.findByIdWithRelations.mockResolvedValue(
          item({ status, orderDeadline }),
        );

        await expect(
          service.getForViewer(OTHER, 'listing-1'),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          service.getForViewer(SELLER, 'listing-1'),
        ).resolves.toBeDefined();
      },
    );
  });

  it('lists the seller’s listings with an optional status filter', async () => {
    repository.findBySeller.mockResolvedValue([stored()]);

    await service.listMine(SELLER, ListingStatus.Draft);

    expect(repository.findBySeller).toHaveBeenCalledWith(
      SELLER,
      ListingStatus.Draft,
    );
  });

  describe('search ordering and filters', () => {
    const cacheStore = {
      getVersion: vi.fn(),
      getOrSet: vi.fn(),
    };
    const search = { searchOpen: vi.fn() };
    let searching: ListingsService;

    const CAMPAIGN = '7d1f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a22';
    const row = (id: string, deadline: Date | null, sortOrder = 0) => ({
      id,
      title: 'Cam sành',
      mode: deadline ? ListingMode.Preorder : ListingMode.InStock,
      campaign_id: deadline ? CAMPAIGN : null,
      campaign_title: deadline ? 'Hoa quả tuần 41' : null,
      order_deadline: deadline,
      delivery_date: deadline ? '2026-10-12' : null,
      sort_order: sortOrder,
      published_at: new Date('2026-10-05T03:00:00Z'),
      category_id: 1,
      category_slug: 'do-cu',
      category_name: 'Đồ cũ',
      category_name_en: 'Second-hand',
      seller_id: SELLER,
      seller_name: 'Seller',
      seller_email: 'seller.one@example.com',
      seller_avatar_url: null,
      image_key: null,
      unit_price: 100000,
      unit: 'cái',
      has_combos: false,
      order_count: 0,
      stock_quantity: null,
    });

    beforeEach(() => {
      cacheStore.getVersion.mockResolvedValue(1);
      cacheStore.getOrSet.mockImplementation(
        (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
      );
      searching = new ListingsService(
        search as unknown as ListingsRepository,
        users as unknown as UsersService,
        categories as unknown as CategoriesService,
        cacheStore as unknown as CacheService,
        outbox as unknown as OutboxService,
      );
    });

    it.each([
      ['24.000', 24],
      ['0.000', 0],
      [null, null],
    ])('maps stock_quantity %j to %j', async (stock, expected) => {
      search.searchOpen.mockResolvedValue([
        { ...row('listing-1', null), stock_quantity: stock },
      ]);

      const page = await searching.search({});

      expect(page.items[0].stockQuantity).toBe(expected);
    });

    it('names the seller by the part of their email before @', async () => {
      search.searchOpen.mockResolvedValue([row('listing-1', null)]);

      const page = await searching.search({});

      expect(page.items[0].seller.handle).toBe('seller.one');
      expect(page.items[0].unitPrice).toBe(100000);
    });

    it('lists in-stock goods of every seller by default', async () => {
      search.searchOpen.mockResolvedValue([]);

      await searching.search({});

      expect(search.searchOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: ListingMode.InStock,
          sellerId: null,
          tsQuery: null,
        }),
      );
    });

    it('passes the seller and the mode through', async () => {
      search.searchOpen.mockResolvedValue([]);

      await searching.search({ mode: ListingMode.Preorder, seller: SELLER });

      expect(search.searchOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: ListingMode.Preorder,
          sellerId: SELLER,
        }),
      );
    });

    it('has no round on in-stock goods and the round on its products', async () => {
      const deadline = new Date('2026-10-09T10:00:00.000Z');
      search.searchOpen.mockResolvedValueOnce([row('listing-1', null)]);
      search.searchOpen.mockResolvedValueOnce([row('listing-2', deadline)]);

      const inStock = await searching.search({});
      const preorder = await searching.search({ mode: ListingMode.Preorder });

      expect(inStock.items[0].campaign).toBeNull();
      expect(preorder.items[0].campaign).toEqual({
        id: CAMPAIGN,
        title: 'Hoa quả tuần 41',
        orderDeadline: '2026-10-09T10:00:00.000Z',
        deliveryDate: '2026-10-12',
      });
    });

    const recent = encodeCursor({
      kind: 'recent',
      publishedAt: '2026-10-05T03:00:00.000Z',
      id: '0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11',
    });
    const byDeadline = encodeCursor({
      kind: 'deadline',
      orderDeadline: '2026-10-09T10:00:00.000Z',
      campaignId: CAMPAIGN,
      sortOrder: 0,
      id: '0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11',
    });

    it.each([
      ['a recent cursor on pre-orders', { mode: ListingMode.Preorder }, recent],
      ['a deadline cursor on in-stock goods', {}, byDeadline],
      [
        'a deadline cursor on a pre-order keyword search',
        { mode: ListingMode.Preorder, q: 'cam' },
        byDeadline,
      ],
    ])('rejects %s', async (_label, params, cursor) => {
      await expect(searching.search({ ...params, cursor })).rejects.toThrow(
        BadRequestException,
      );
      expect(search.searchOpen).not.toHaveBeenCalled();
    });

    it('ends a page of pre-orders with a deadline cursor', async () => {
      const deadline = new Date('2026-10-09T10:00:00.000Z');
      search.searchOpen.mockResolvedValue([
        row('0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11', deadline, 2),
        row('1b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11', deadline, 3),
      ]);

      const page = await searching.search({
        mode: ListingMode.Preorder,
        limit: 1,
      });

      expect(decodeCursor(page.nextCursor as string)).toEqual({
        kind: 'deadline',
        orderDeadline: '2026-10-09T10:00:00.000Z',
        campaignId: CAMPAIGN,
        sortOrder: 2,
        id: '0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11',
      });
    });

    it('pages a pre-order keyword search by offset', async () => {
      const deadline = new Date('2026-10-09T10:00:00.000Z');
      search.searchOpen.mockResolvedValue([
        row('0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11', deadline),
        row('1b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11', deadline),
      ]);

      const page = await searching.search({
        mode: ListingMode.Preorder,
        q: 'cam',
        limit: 1,
      });

      expect(decodeCursor(page.nextCursor as string)).toEqual({
        kind: 'ranked',
        offset: 1,
      });
    });

    it('ends a page of in-stock goods with a recent cursor', async () => {
      search.searchOpen.mockResolvedValue([
        row('0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11', null),
        row('1b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11', null),
      ]);

      const page = await searching.search({ limit: 1 });

      expect(decodeCursor(page.nextCursor as string)).toEqual({
        kind: 'recent',
        publishedAt: '2026-10-05T03:00:00.000Z',
        id: '0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11',
      });
    });
  });
});
