import { BadRequestException } from '@nestjs/common';
import type { Listing } from '../listings/listing.entity.js';
import { ListingMode, ListingStatus } from '../listings/listings.constants.js';
import { CART_MAX_LINES, CartService } from './cart.service.js';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';

function listing(id: string, overrides: Partial<Listing> = {}): Listing {
  return {
    id,
    title: `Product ${id}`,
    unit: 'cái',
    unitPrice: 15000,
    combos: [],
    images: [],
    mode: ListingMode.Preorder,
    status: ListingStatus.Open,
    sellerId: SELLER,
    seller: {
      id: SELLER,
      name: 'Seller',
      email: 'seller@company.vn',
      avatarUrl: null,
    },
    stockQuantity: null,
    campaignId: 'camp-1',
    campaign: {
      id: 'camp-1',
      status: 'open',
      orderDeadline: new Date(Date.now() + 86_400_000),
    },
    ...overrides,
  } as unknown as Listing;
}

describe('CartService.setLines', () => {
  let found: Listing[];
  let held: Array<{ listingId: string; quantity: string }>;
  const cart = {
    findForUser: vi.fn(),
    countForUser: vi.fn(),
    findLine: vi.fn(),
    upsert: vi.fn(),
    upsertMany: vi.fn(),
  };
  const listings = { findByIds: vi.fn() };
  let service: CartService;

  const rejection = async (
    lines: Array<{ listingId: string; quantity: string }>,
  ) => service.setLines(BUYER, lines).catch((error: unknown) => error);

  beforeEach(() => {
    vi.resetAllMocks();
    found = [listing('a'), listing('b')];
    held = [];
    listings.findByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(found.filter((item) => ids.includes(item.id))),
    );
    cart.findForUser.mockImplementation(() => Promise.resolve(held));
    cart.upsertMany.mockResolvedValue(undefined);
    service = new CartService(
      cart as never,
      listings as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('writes every line in one call and returns the cart', async () => {
    const lines = [
      { listingId: 'a', quantity: '1' },
      { listingId: 'b', quantity: '2' },
    ];

    const result = await service.setLines(BUYER, lines);

    expect(cart.upsertMany).toHaveBeenCalledExactlyOnceWith(BUYER, lines);
    expect(result).toEqual({ groups: [], lineCount: 0 });
  });

  it('refuses a product that appears twice', async () => {
    const error = await rejection([
      { listingId: 'a', quantity: '1' },
      { listingId: 'a', quantity: '2' },
    ]);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(cart.upsertMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an unknown product',
      () => undefined,
      { listingId: 'zzz', quantity: '1' },
      'LISTING_NOT_OPEN',
    ],
    [
      'a stopped product',
      () => {
        found[1] = listing('b', { status: ListingStatus.Closed });
      },
      { listingId: 'b', quantity: '1' },
      'LISTING_NOT_OPEN',
    ],
    [
      'the buyer own product',
      () => {
        found[1] = listing('b', { sellerId: BUYER });
      },
      { listingId: 'b', quantity: '1' },
      'OWN_LISTING',
    ],
    [
      'a zero quantity',
      () => undefined,
      { listingId: 'b', quantity: '0' },
      'INVALID_QUANTITY',
    ],
    [
      'more than the stock',
      () => {
        found[1] = listing('b', {
          mode: ListingMode.InStock,
          campaign: null,
          campaignId: null,
          stockQuantity: '2.000',
        } as Partial<Listing>);
      },
      { listingId: 'b', quantity: '3' },
      'OUT_OF_STOCK',
    ],
  ])('refuses all when there is %s', async (_name, arrange, bad, code) => {
    arrange();

    const error = await rejection([{ listingId: 'a', quantity: '1' }, bad]);

    expect(error).toMatchObject({ code });
    expect(cart.upsertMany).not.toHaveBeenCalled();
  });

  it('refuses a cart above the limit and allows replacing in a full cart', async () => {
    held = Array.from({ length: CART_MAX_LINES }, (_, i) => ({
      listingId: `held-${i}`,
      quantity: '1',
    }));
    const full = await rejection([{ listingId: 'a', quantity: '1' }]);
    expect(full).toMatchObject({ code: 'CART_FULL' });
    expect(cart.upsertMany).not.toHaveBeenCalled();

    held[0] = { listingId: 'a', quantity: '1' };
    await service.setLines(BUYER, [{ listingId: 'a', quantity: '2' }]);
    expect(cart.upsertMany).toHaveBeenCalledTimes(1);
  });
});
