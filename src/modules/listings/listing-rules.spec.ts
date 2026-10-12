import {
  businessDate,
  isCampaignOpen,
  isListingOpen,
  paymentTermsOf,
  productProblems,
  suggestReopenDates,
  type ListingInput,
  validateListingInput,
} from './listing-rules.js';
import {
  ListingCondition,
  ListingMode,
  ListingStatus,
} from './listings.constants.js';
import { mediaUrl, thumbnailKey } from './media-url.js';
import { buildSearchText } from './search-text.js';

const inStock = (overrides: Partial<ListingInput> = {}): ListingInput => ({
  mode: ListingMode.InStock,
  title: 'Loa bluetooth cũ',
  categoryId: 1,
  description: 'Còn mới 90%',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  condition: ListingCondition.LikeNew,
  unit: 'cái',
  unitPrice: 500_000,
  stockQuantity: '1',
  combos: [],
  ...overrides,
});

/** What a pre-order looked like before rounds; no longer a listing input. */
const preorder = (overrides: Partial<ListingInput> = {}): ListingInput => ({
  mode: ListingMode.Preorder,
  title: 'Hoa quả tuần 41',
  categoryId: 2,
  description: '',
  acceptsPrepaidQr: true,
  acceptsPayOnDelivery: true,
  condition: null,
  unit: 'kg',
  unitPrice: 35_000,
  stockQuantity: null,
  combos: [],
  ...overrides,
});

describe('validateListingInput', () => {
  it('accepts a valid in-stock listing', () => {
    expect(validateListingInput(inStock())).toEqual([]);
  });

  it('refuses a pre-order: those are created as a round', () => {
    expect(validateListingInput(preorder())).toEqual([
      'pre-orders are created as a round',
    ]);
  });

  it.each<[string, ListingInput, string]>([
    [
      'a short title',
      inStock({ title: ' abc ' }),
      'title must be 5-120 characters',
    ],
    [
      'a long title',
      inStock({ title: 'a'.repeat(121) }),
      'title must be 5-120 characters',
    ],
    [
      'a long description',
      inStock({ description: 'a'.repeat(5001) }),
      'description must be at most 5000 characters',
    ],
    [
      'no payment method',
      inStock({ acceptsPayOnDelivery: false }),
      'at least one payment method is required',
    ],
    ['an unknown unit', inStock({ unit: 'thùng' }), 'unit is not supported'],
    [
      'a price below the minimum',
      inStock({ unitPrice: 999 }),
      'unit price must be a whole number from 1000 to 1000000000',
    ],
    [
      'a price above the maximum',
      inStock({ unitPrice: 1_000_000_001 }),
      'unit price must be a whole number from 1000 to 1000000000',
    ],
    [
      'a fractional price',
      inStock({ unitPrice: 1000.5 }),
      'unit price must be a whole number from 1000 to 1000000000',
    ],
    [
      'an in-stock product without stock',
      inStock({ stockQuantity: null }),
      'stock is required for in-stock products',
    ],
    [
      'zero stock',
      inStock({ stockQuantity: '0' }),
      'stock must be greater than 0 with at most 3 decimals',
    ],
    [
      'stock with four decimals',
      inStock({ unit: 'kg', stockQuantity: '1.2345' }),
      'stock must be greater than 0 with at most 3 decimals',
    ],
    [
      'stock that is not a number',
      inStock({ stockQuantity: '-1' }),
      'stock must be greater than 0 with at most 3 decimals',
    ],
    [
      'fractional stock for a unit other than kg',
      inStock({ unit: 'hộp', stockQuantity: '1.5' }),
      'only kg may have fractional stock',
    ],
  ])('rejects %s', (_label, input, problem) => {
    expect(validateListingInput(input)).toContain(problem);
  });

  it('allows fractional stock for kg', () => {
    expect(
      validateListingInput(inStock({ unit: 'kg', stockQuantity: '2.5' })),
    ).toEqual([]);
  });

  it('reads the deadline day in Vietnam time, not UTC', () => {
    // 23:30 UTC on 8 Oct is already 06:30 on 9 Oct in Vietnam.
    expect(businessDate(new Date('2026-10-08T23:30:00Z'))).toBe('2026-10-09');
  });

  it('reports every problem at once', () => {
    const problems = validateListingInput(
      inStock({ title: 'abc', unit: 'x', unitPrice: 1 }),
    );

    expect(problems).toHaveLength(3);
  });
});

describe('condition', () => {
  it('accepts the condition of in-stock goods', () => {
    expect(validateListingInput(inStock())).toEqual([]);
  });

  it('requires a condition for in-stock goods outside food', () => {
    expect(validateListingInput(inStock({ condition: null }))).toEqual([
      'in-stock goods need a condition',
    ]);
  });

  it('refuses a condition on pre-orders and on food', () => {
    const message =
      'only in-stock goods outside food categories have a condition';
    expect(
      validateListingInput(preorder({ condition: ListingCondition.New })),
    ).toContain(message);
    expect(validateListingInput(inStock(), { isPerishable: true })).toEqual([
      message,
    ]);
    expect(
      validateListingInput(inStock({ condition: null }), {
        isPerishable: true,
      }),
    ).toEqual([]);
  });
});

describe('combos', () => {
  const withCombos = (
    unit: string,
    combos: { quantity: string; price: number }[],
  ) => inStock({ unit, unitPrice: 10_000, stockQuantity: '500', combos });

  it('accepts up to three combos that are cheaper than buying singly', () => {
    expect(
      validateListingInput(
        withCombos('cái', [
          { quantity: '10', price: 95_000 },
          { quantity: '50', price: 450_000 },
          { quantity: '100', price: 900_000 },
        ]),
      ),
    ).toEqual([]);
    expect(
      validateListingInput(
        withCombos('kg', [{ quantity: '2.5', price: 24_000 }]),
      ),
    ).toEqual([]);
  });

  it.each<[string, string, { quantity: string; price: number }[], string]>([
    [
      'four combos',
      'cái',
      [2, 3, 4, 5].map((n) => ({ quantity: String(n), price: n * 9_000 })),
      'at most 3 combos',
    ],
    [
      'a combo of one piece',
      'cái',
      [{ quantity: '1', price: 9_000 }],
      'combo 1: quantity must be more than one unit and a multiple of it',
    ],
    [
      'half a piece',
      'cái',
      [{ quantity: '2.5', price: 20_000 }],
      'combo 1: quantity must be more than one unit and a multiple of it',
    ],
    [
      'kg finer than 0.1',
      'kg',
      [{ quantity: '1.25', price: 10_000 }],
      'combo 1: quantity must be more than one 0.1 kg step and a multiple of it',
    ],
    [
      'the same size twice',
      'cái',
      [
        { quantity: '10', price: 90_000 },
        { quantity: '10', price: 80_000 },
      ],
      'combo 2: another combo has the same quantity',
    ],
    [
      'a combo that saves nothing',
      'cái',
      [{ quantity: '10', price: 100_000 }],
      'combo 1: must cost less than buying the same quantity singly',
    ],
    [
      'a price below the minimum',
      'cái',
      [{ quantity: '10', price: 500 }],
      'combo 1: price must be a whole number from 1000 to 1000000000',
    ],
  ])('refuses %s', (_label, unit, combos, message) => {
    expect(validateListingInput(withCombos(unit, combos))).toContain(message);
  });
});

describe('isListingOpen', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const future = new Date('2026-10-06T00:00:00Z');
  const past = new Date('2026-10-04T00:00:00Z');

  it.each([
    [ListingStatus.Draft, false],
    [ListingStatus.Closed, false],
    [ListingStatus.Open, true],
  ])('in-stock goods with status %s -> %s', (status, expected) => {
    expect(isListingOpen({ status }, now)).toBe(expected);
    expect(isListingOpen({ status, campaign: null }, now)).toBe(expected);
  });

  it.each([
    [ListingStatus.Open, 'open' as const, future, true],
    [ListingStatus.Open, 'open' as const, past, false],
    [ListingStatus.Open, 'open' as const, now, false],
    [ListingStatus.Open, 'draft' as const, future, false],
    [ListingStatus.Open, 'closed' as const, future, false],
    [ListingStatus.Closed, 'open' as const, future, false],
    [ListingStatus.Draft, 'draft' as const, future, false],
  ])(
    'a product %s in a round %s with deadline %s -> %s',
    (status, campaignStatus, orderDeadline, expected) => {
      expect(
        isListingOpen(
          { status, campaign: { status: campaignStatus, orderDeadline } },
          now,
        ),
      ).toBe(expected);
    },
  );
});

describe('paymentTermsOf', () => {
  it('reads the terms of in-stock goods from the listing', () => {
    expect(
      paymentTermsOf({ acceptsPrepaidQr: true, acceptsPayOnDelivery: false }),
    ).toEqual({ acceptsPrepaidQr: true, acceptsPayOnDelivery: false });
    expect(
      paymentTermsOf({
        acceptsPrepaidQr: false,
        acceptsPayOnDelivery: true,
        campaign: null,
      }),
    ).toEqual({ acceptsPrepaidQr: false, acceptsPayOnDelivery: true });
  });

  it('reads the terms of a product of a round from the round', () => {
    expect(
      paymentTermsOf({
        acceptsPrepaidQr: null,
        acceptsPayOnDelivery: null,
        campaign: { acceptsPrepaidQr: true, acceptsPayOnDelivery: false },
      }),
    ).toEqual({ acceptsPrepaidQr: true, acceptsPayOnDelivery: false });
  });

  it('accepts nothing when a product of a round was loaded without it', () => {
    expect(
      paymentTermsOf({ acceptsPrepaidQr: null, acceptsPayOnDelivery: null }),
    ).toEqual({ acceptsPrepaidQr: false, acceptsPayOnDelivery: false });
  });
});

describe('buildSearchText', () => {
  it('joins title and description in the search normal form', () => {
    expect(
      buildSearchText({
        title: 'Cam sành Hà Giang',
        description: 'Giao tận TẦNG',
      }),
    ).toBe('cam sanh ha giang giao tan tang');
  });
});

describe('media urls', () => {
  it('derives the thumbnail key and the browser path', () => {
    expect(thumbnailKey('listings/a/b.webp')).toBe('listings/a/b_thumb.webp');
    expect(mediaUrl('listings/a/b.webp')).toBe('/api/media/listings/a/b.webp');
  });
});

describe('suggestReopenDates', () => {
  // Friday 9 Oct 2026, 17:00 in Vietnam; delivery the following Monday.
  const deadline = new Date('2026-10-09T10:00:00Z');
  const delivery = '2026-10-12';

  it('moves a round that ended this week to the same time next week', () => {
    const next = suggestReopenDates(
      deadline,
      delivery,
      new Date('2026-10-10T02:00:00Z'),
    );

    expect(next.orderDeadline.toISOString()).toBe('2026-10-16T10:00:00.000Z');
    expect(next.deliveryDate).toBe('2026-10-19');
  });

  it('skips as many weeks as needed to land in the future', () => {
    const next = suggestReopenDates(
      deadline,
      delivery,
      new Date('2026-11-01T00:00:00Z'),
    );

    expect(next.orderDeadline.toISOString()).toBe('2026-11-06T10:00:00.000Z');
    expect(next.deliveryDate).toBe('2026-11-09');
  });

  it('keeps a deadline that is still ahead', () => {
    const next = suggestReopenDates(
      deadline,
      delivery,
      new Date('2026-10-08T00:00:00Z'),
    );

    expect(next.orderDeadline).toEqual(deadline);
    expect(next.deliveryDate).toBe(delivery);
  });

  it('keeps same-day delivery on the same day, across a month boundary', () => {
    const next = suggestReopenDates(
      new Date('2026-10-30T03:00:00Z'),
      '2026-10-30',
      new Date('2026-10-30T04:00:00Z'),
    );

    expect(next.deliveryDate).toBe('2026-11-06');
  });

  it('always proposes dates that pass validation', () => {
    const next = suggestReopenDates(
      deadline,
      delivery,
      new Date('2027-03-03T00:00:00Z'),
    );

    expect(next.orderDeadline.getTime()).toBeGreaterThan(
      new Date('2027-03-03T00:00:00Z').getTime(),
    );
    expect(next.deliveryDate >= businessDate(next.orderDeadline)).toBe(true);
  });
});

describe('isCampaignOpen', () => {
  const now = new Date('2026-10-12T00:00:00Z');
  const deadline = new Date('2026-10-16T10:00:00Z');

  it('is true when open with a future deadline', () => {
    expect(
      isCampaignOpen({ status: 'open', orderDeadline: deadline }, now),
    ).toBe(true);
  });

  it.each(['draft', 'closed'] as const)('is false when %s', (status) => {
    expect(isCampaignOpen({ status, orderDeadline: deadline }, now)).toBe(
      false,
    );
  });

  it('is false when the deadline equals now', () => {
    expect(isCampaignOpen({ status: 'open', orderDeadline: now }, now)).toBe(
      false,
    );
  });
});

describe('productProblems', () => {
  it('returns the problems of one product', () => {
    expect(
      productProblems({
        mode: ListingMode.Preorder,
        unit: 'thùng',
        unitPrice: 999,
        stockQuantity: null,
        combos: [],
      }),
    ).toEqual([
      'unit is not supported',
      'unit price must be a whole number from 1000 to 1000000000',
    ]);
  });
});
