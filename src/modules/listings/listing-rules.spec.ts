import {
  businessDate,
  isListingOpen,
  suggestReopenDates,
  type ListingInput,
  type ListingItemInput,
  validateListingInput,
} from './listing-rules.js';
import { ListingMode, ListingStatus } from './listings.constants.js';
import { mediaUrl, thumbnailKey } from './media-url.js';
import { buildSearchText } from './search-text.js';

const item = (overrides: Partial<ListingItemInput> = {}): ListingItemInput => ({
  name: 'Loa JBL Go 3',
  unit: 'cái',
  unitPrice: 500_000,
  stockQuantity: '1',
  ...overrides,
});

const inStock = (overrides: Partial<ListingInput> = {}): ListingInput => ({
  mode: ListingMode.InStock,
  title: 'Loa bluetooth cũ',
  categoryId: 1,
  description: 'Còn mới 90%',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  orderDeadline: null,
  deliveryDate: null,
  items: [item()],
  ...overrides,
});

const preorder = (overrides: Partial<ListingInput> = {}): ListingInput => ({
  mode: ListingMode.Preorder,
  title: 'Hoa quả tuần 41',
  categoryId: 2,
  description: '',
  acceptsPrepaidQr: true,
  acceptsPayOnDelivery: true,
  // 17:00 on 9 Oct in Vietnam
  orderDeadline: new Date('2026-10-09T10:00:00Z'),
  deliveryDate: '2026-10-12',
  items: [
    item({
      name: 'Cam sành',
      unit: 'kg',
      unitPrice: 35_000,
      stockQuantity: null,
    }),
  ],
  ...overrides,
});

describe('validateListingInput', () => {
  it('accepts a valid in-stock listing and a valid pre-order listing', () => {
    expect(validateListingInput(inStock())).toEqual([]);
    expect(validateListingInput(preorder())).toEqual([]);
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
    ['no items', inStock({ items: [] }), 'a listing needs 1-20 items'],
    [
      'too many items',
      inStock({ items: Array.from({ length: 21 }, () => item()) }),
      'a listing needs 1-20 items',
    ],
    [
      'no payment method',
      inStock({ acceptsPayOnDelivery: false }),
      'at least one payment method is required',
    ],
    [
      'an empty item name',
      inStock({ items: [item({ name: '  ' })] }),
      'item 1: name must be 1-120 characters',
    ],
    [
      'an unknown unit',
      inStock({ items: [item({ unit: 'thùng' })] }),
      'item 1: unit is not supported',
    ],
    [
      'a price below the minimum',
      inStock({ items: [item({ unitPrice: 999 })] }),
      'item 1: unit price must be a whole number from 1000 to 1000000000',
    ],
    [
      'a price above the maximum',
      inStock({ items: [item({ unitPrice: 1_000_000_001 })] }),
      'item 1: unit price must be a whole number from 1000 to 1000000000',
    ],
    [
      'a fractional price',
      inStock({ items: [item({ unitPrice: 1000.5 })] }),
      'item 1: unit price must be a whole number from 1000 to 1000000000',
    ],
    [
      'an in-stock item without stock',
      inStock({ items: [item({ stockQuantity: null })] }),
      'item 1: stock is required for in-stock listings',
    ],
    [
      'zero stock',
      inStock({ items: [item({ stockQuantity: '0' })] }),
      'item 1: stock must be greater than 0 with at most 3 decimals',
    ],
    [
      'stock with four decimals',
      inStock({ items: [item({ unit: 'kg', stockQuantity: '1.2345' })] }),
      'item 1: stock must be greater than 0 with at most 3 decimals',
    ],
    [
      'stock that is not a number',
      inStock({ items: [item({ stockQuantity: '-1' })] }),
      'item 1: stock must be greater than 0 with at most 3 decimals',
    ],
    [
      'fractional stock for a unit other than kg',
      inStock({ items: [item({ unit: 'hộp', stockQuantity: '1.5' })] }),
      'item 1: only kg may have fractional stock',
    ],
    [
      'an in-stock listing with a deadline',
      inStock({ orderDeadline: new Date('2026-10-09T10:00:00Z') }),
      'in-stock listings do not have an order deadline or delivery date',
    ],
    [
      'a pre-order item with stock',
      preorder({ items: [item({ unit: 'kg', stockQuantity: '10' })] }),
      'item 1: pre-order items do not have stock',
    ],
    [
      'a pre-order without a deadline',
      preorder({ orderDeadline: null }),
      'pre-order listings need an order deadline',
    ],
    [
      'a pre-order without a delivery date',
      preorder({ deliveryDate: null }),
      'pre-order listings need a delivery date',
    ],
    [
      'an impossible delivery date',
      preorder({ deliveryDate: '2026-02-30' }),
      'delivery date must be a valid date (YYYY-MM-DD)',
    ],
    [
      'a delivery date before the deadline',
      preorder({ deliveryDate: '2026-10-08' }),
      'delivery date cannot be before the order deadline',
    ],
  ])('rejects %s', (_label, input, problem) => {
    expect(validateListingInput(input)).toContain(problem);
  });

  it('allows fractional stock for kg and delivery on the deadline day', () => {
    expect(
      validateListingInput(
        inStock({ items: [item({ unit: 'kg', stockQuantity: '2.5' })] }),
      ),
    ).toEqual([]);
    expect(
      validateListingInput(preorder({ deliveryDate: '2026-10-09' })),
    ).toEqual([]);
  });

  it('reads the deadline day in Vietnam time, not UTC', () => {
    // 23:30 UTC on 8 Oct is already 06:30 on 9 Oct in Vietnam.
    const deadline = new Date('2026-10-08T23:30:00Z');

    expect(businessDate(deadline)).toBe('2026-10-09');
    expect(
      validateListingInput(
        preorder({ orderDeadline: deadline, deliveryDate: '2026-10-08' }),
      ),
    ).toContain('delivery date cannot be before the order deadline');
  });

  it('reports every problem at once', () => {
    const problems = validateListingInput(
      inStock({ title: 'abc', items: [item({ unit: 'x', unitPrice: 1 })] }),
    );

    expect(problems).toHaveLength(3);
  });
});

describe('isListingOpen', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const future = new Date('2026-10-06T00:00:00Z');
  const past = new Date('2026-10-04T00:00:00Z');

  it.each([
    [ListingStatus.Draft, null, false],
    [ListingStatus.Closed, null, false],
    [ListingStatus.Open, null, true],
    [ListingStatus.Open, future, true],
    [ListingStatus.Open, past, false],
    [ListingStatus.Open, now, false],
    [ListingStatus.Closed, future, false],
  ])('status %s with deadline %s -> %s', (status, orderDeadline, expected) => {
    expect(isListingOpen({ status, orderDeadline }, now)).toBe(expected);
  });
});

describe('buildSearchText', () => {
  it('joins title, description and item names in the search normal form', () => {
    expect(
      buildSearchText({
        title: 'Hoa quả tuần 41',
        description: 'Giao tận TẦNG',
        items: [{ name: 'Cam sành' }, { name: 'Bưởi da xanh' }],
      }),
    ).toBe('hoa qua tuan 41 giao tan tang cam sanh buoi da xanh');
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

    expect(
      validateListingInput(
        preorder({
          orderDeadline: next.orderDeadline,
          deliveryDate: next.deliveryDate,
        }),
      ),
    ).toEqual([]);
  });
});
