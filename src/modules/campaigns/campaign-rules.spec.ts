import {
  type CampaignInput,
  type CampaignItemInput,
  validateCampaignInput,
} from './campaign-rules.js';

const item = (
  overrides: Partial<CampaignItemInput> = {},
): CampaignItemInput => ({
  id: null,
  title: 'Bánh bao chay',
  description: '',
  unit: 'cái',
  unitPrice: 15_000,
  combos: [],
  selling: true,
  ...overrides,
});

const input = (overrides: Partial<CampaignInput> = {}): CampaignInput => ({
  title: 'Bánh bao tuần này',
  description: 'Đặt trước thứ Sáu',
  categoryId: 1,
  orderDeadline: new Date('2026-10-16T10:00:00Z'),
  deliveryDate: '2026-10-18',
  acceptsPrepaidQr: true,
  acceptsPayOnDelivery: false,
  items: [item()],
  ...overrides,
});

describe('validateCampaignInput', () => {
  it('accepts a valid round', () => {
    expect(validateCampaignInput(input())).toEqual([]);
  });

  it('rejects a title of 4 characters', () => {
    expect(validateCampaignInput(input({ title: 'abcd' }))).toEqual([
      'title must be 5-120 characters',
    ]);
  });

  it('rejects a title of 121 characters', () => {
    expect(validateCampaignInput(input({ title: 'a'.repeat(121) }))).toEqual([
      'title must be 5-120 characters',
    ]);
  });

  it('rejects a description over 5000 characters', () => {
    expect(
      validateCampaignInput(input({ description: 'a'.repeat(5001) })),
    ).toEqual(['description must be at most 5000 characters']);
  });

  it('requires a payment method', () => {
    expect(
      validateCampaignInput(
        input({ acceptsPrepaidQr: false, acceptsPayOnDelivery: false }),
      ),
    ).toEqual(['at least one payment method is required']);
  });

  it('rejects an impossible delivery date', () => {
    expect(
      validateCampaignInput(input({ deliveryDate: '2026-02-30' })),
    ).toEqual(['delivery date must be a valid date (YYYY-MM-DD)']);
  });

  it('rejects delivery before the deadline', () => {
    expect(
      validateCampaignInput(input({ deliveryDate: '2026-10-15' })),
    ).toEqual(['delivery date cannot be before the order deadline']);
  });

  it('compares delivery with the deadline business date in Vietnam', () => {
    const orderDeadline = new Date('2026-10-16T17:30:00Z');
    expect(
      validateCampaignInput(
        input({ orderDeadline, deliveryDate: '2026-10-16' }),
      ),
    ).toEqual(['delivery date cannot be before the order deadline']);
    expect(
      validateCampaignInput(
        input({ orderDeadline, deliveryDate: '2026-10-17' }),
      ),
    ).toEqual([]);
  });

  it('rejects zero products', () => {
    expect(validateCampaignInput(input({ items: [] }))).toEqual([
      'a round needs 1-50 products',
    ]);
  });

  it('rejects 51 products', () => {
    expect(
      validateCampaignInput(
        input({ items: Array.from({ length: 51 }, () => item()) }),
      ),
    ).toEqual(['a round needs 1-50 products']);
  });

  it('rejects the same item id twice', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      validateCampaignInput(input({ items: [item({ id }), item({ id })] })),
    ).toEqual(['item 2: appears twice']);
  });

  it('rejects an item title of 1 character and accepts 3', () => {
    expect(
      validateCampaignInput(input({ items: [item({ title: 'X' })] })),
    ).toEqual(['item 1: title must be 2-120 characters']);
    expect(
      validateCampaignInput(input({ items: [item({ title: 'Xôi' })] })),
    ).toEqual([]);
  });

  it('rejects an item description over 5000 characters', () => {
    expect(
      validateCampaignInput(
        input({ items: [item({ description: 'a'.repeat(5001) })] }),
      ),
    ).toEqual(['item 1: description must be at most 5000 characters']);
  });

  it('rejects an unsupported unit', () => {
    expect(
      validateCampaignInput(input({ items: [item({ unit: 'thùng' })] })),
    ).toEqual(['item 1: unit is not supported']);
  });

  it('rejects a price below 1000', () => {
    expect(
      validateCampaignInput(input({ items: [item({ unitPrice: 999 })] })),
    ).toEqual([
      'item 1: unit price must be a whole number from 1000 to 1000000000',
    ]);
  });

  it('rejects a combo that is not cheaper than singles', () => {
    expect(
      validateCampaignInput(
        input({
          items: [item({ combos: [{ quantity: '10', price: 150_000 }] })],
        }),
      ),
    ).toEqual([
      'item 1: combo 1: must cost less than buying the same quantity singly',
    ]);
  });

  it('prefixes problems of the second item with item 2', () => {
    expect(
      validateCampaignInput(input({ items: [item(), item({ title: 'X' })] })),
    ).toEqual(['item 2: title must be 2-120 characters']);
  });
});
