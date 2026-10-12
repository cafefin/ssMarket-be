import { BadRequestException } from '@nestjs/common';
import type { Listing } from '../listings/listing.entity.js';
import { ListingMode, ListingStatus } from '../listings/listings.constants.js';
import type { Order } from './order.entity.js';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';
import { OrdersService } from './orders.service.js';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const seller = {
  id: SELLER,
  bankBin: '970436',
  bankAccountNumber: '0123456789',
  bankAccountName: 'AN',
};

function listing(id: string, overrides: Partial<Listing> = {}): Listing {
  return {
    id,
    title: `Product ${id}`,
    unit: 'cái',
    unitPrice: 15000,
    combos: [],
    mode: ListingMode.Preorder,
    status: ListingStatus.Open,
    sellerId: SELLER,
    seller,
    campaignId: 'camp-1',
    campaign: {
      id: 'camp-1',
      status: 'open',
      orderDeadline: new Date(Date.now() + 86_400_000),
      acceptsPrepaidQr: true,
      acceptsPayOnDelivery: true,
    },
    ...overrides,
  } as unknown as Listing;
}

function orderWith(
  lines: Array<{ listingId: string; quantity: string; unitPrice?: number }>,
): Order {
  return {
    id: 'order-1',
    buyerId: BUYER,
    sellerId: SELLER,
    campaignId: 'camp-1',
    isPreorder: true,
    paymentStatus: PaymentStatus.Unpaid,
    fulfillmentStatus: FulfillmentStatus.Pending,
    campaign: {
      id: 'camp-1',
      status: 'open',
      orderDeadline: new Date(Date.now() + 86_400_000),
    },
    lines: lines.map((line) => ({
      listing: { id: line.listingId, title: `Old ${line.listingId}` },
      title: `Old ${line.listingId}`,
      unit: 'cái',
      unitPrice: 15000,
      combos: [],
      ...line,
    })),
  } as unknown as Order;
}

function setup(order: Order, listings: Listing[]) {
  const orders = {
    findForUpdate: vi.fn().mockResolvedValue(order),
    replaceLines: vi.fn().mockResolvedValue(undefined),
    findByIdWithRelations: vi.fn().mockResolvedValue(order),
    findActivePreorder: vi.fn().mockResolvedValue(null),
  };
  const listingsService = {
    findByIds: vi.fn().mockResolvedValue(listings),
    findById: vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(listings.find((item) => item.id === id) ?? null),
      ),
    invalidateCache: vi.fn().mockResolvedValue(undefined),
  };
  const users = { hasBankProfile: vi.fn().mockReturnValue(true) };
  const banks = { findByBin: vi.fn().mockReturnValue(null) };
  const transactions = {
    run: vi
      .fn()
      .mockImplementation((work: (tx: object) => unknown) => work({})),
  };
  const service = new OrdersService(
    orders as never,
    listingsService as never,
    users as never,
    banks as never,
    transactions as never,
  );
  // The response shape has its own tests; here only the write matters.
  vi.spyOn(service, 'getForParticipant').mockResolvedValue(undefined as never);
  return { service, orders, listingsService };
}

const input = (lines: Array<[string, string]>) => ({
  lines: lines.map(([listingId, quantity]) => ({ listingId, quantity })),
  paymentMethod: PaymentMethod.PayOnDelivery,
  deliveryLocation: 'Tầng 7',
});

describe('OrdersService.edit', () => {
  it('keeps the snapshot of an existing line, prices a new one now, and recomputes the total', async () => {
    const order = orderWith([{ listingId: 'a', quantity: '2.000' }]);
    const { service, orders } = setup(order, [
      listing('a', { unitPrice: 20000 }),
      listing('b', { unitPrice: 18000 }),
    ]);

    await service.edit(
      BUYER,
      'order-1',
      input([
        ['a', '4'],
        ['b', '1'],
      ]),
    );

    const [, , lines, changes] = orders.replaceLines.mock.calls[0] as [
      unknown,
      string,
      Array<{ listingId: string; unitPrice: number; title: string }>,
      { totalAmount: number },
    ];
    expect(lines.map((line) => [line.listingId, line.unitPrice])).toEqual([
      ['a', 15000],
      ['b', 18000],
    ]);
    expect(lines[0].title).toBe('Old a');
    expect(changes.totalAmount).toBe(60000 + 18000);
  });

  it('refuses a product of another round or an unknown one', async () => {
    const order = orderWith([{ listingId: 'a', quantity: '1' }]);
    const { service, orders } = setup(order, [
      listing('a'),
      listing('x', { campaignId: 'camp-2' }),
    ]);

    await expect(
      service.edit(BUYER, 'order-1', input([['x', '1']])),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.edit(BUYER, 'order-1', input([['missing', '1']])),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orders.replaceLines).not.toHaveBeenCalled();
  });

  it('refuses a product that appears twice', async () => {
    const order = orderWith([{ listingId: 'a', quantity: '1' }]);
    const { service } = setup(order, [listing('a')]);

    await expect(
      service.edit(
        BUYER,
        'order-1',
        input([
          ['a', '1'],
          ['a', '2'],
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a malformed quantity before the stopped-product rule', async () => {
    const order = orderWith([{ listingId: 'a', quantity: '1' }]);
    const { service } = setup(order, [
      listing('a', { status: ListingStatus.Closed }),
    ]);

    await expect(
      service.edit(BUYER, 'order-1', input([['a', 'abc']])),
    ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  });

  describe('a stopped product', () => {
    const stopped = (id: string) =>
      listing(id, { status: ListingStatus.Closed });

    it('cannot be added', async () => {
      const order = orderWith([{ listingId: 'a', quantity: '1' }]);
      const { service } = setup(order, [listing('a'), stopped('b')]);

      await expect(
        service.edit(
          BUYER,
          'order-1',
          input([
            ['a', '1'],
            ['b', '1'],
          ]),
        ),
      ).rejects.toMatchObject({
        code: 'LISTING_NOT_OPEN',
        details: { listingId: 'b' },
      });
    });

    it('cannot be raised', async () => {
      const order = orderWith([{ listingId: 'a', quantity: '2.000' }]);
      const { service } = setup(order, [stopped('a')]);

      await expect(
        service.edit(BUYER, 'order-1', input([['a', '3']])),
      ).rejects.toMatchObject({ code: 'LISTING_NOT_OPEN' });
    });

    it('can be kept or lowered', async () => {
      const order = orderWith([{ listingId: 'a', quantity: '2.000' }]);
      const { service, orders } = setup(order, [stopped('a')]);

      await service.edit(BUYER, 'order-1', input([['a', '2.0']]));
      await service.edit(BUYER, 'order-1', input([['a', '1']]));

      expect(orders.replaceLines).toHaveBeenCalledTimes(2);
    });
  });

  it('uses the seller of the first product for the QR snapshot', async () => {
    const order = orderWith([{ listingId: 'a', quantity: '1' }]);
    const { service, orders } = setup(order, [listing('a')]);

    await service.edit(BUYER, 'order-1', {
      ...input([['a', '1']]),
      paymentMethod: PaymentMethod.PrepaidQr,
    });

    const [, , , changes] = orders.replaceLines.mock.calls[0] as [
      unknown,
      string,
      unknown,
      { sellerBankBin: string },
    ];
    expect(changes.sellerBankBin).toBe('970436');
  });
});

describe('OrdersService.createMany planning', () => {
  const request = (ids: string[]) => ({
    lines: ids.map((listingId) => ({ listingId, quantity: '1' })),
    paymentMethod: PaymentMethod.PayOnDelivery,
    deliveryLocation: 'Tầng 7',
  });

  it('refuses products of two rounds in one order', async () => {
    const { service } = setup(orderWith([]), [
      listing('a'),
      listing('x', { campaignId: 'camp-2' }),
    ]);

    await expect(
      service.createMany(BUYER, [request(['a', 'x'])]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a round product together with an in-stock product', async () => {
    const { service } = setup(orderWith([]), [
      listing('a'),
      listing('s', { campaignId: null, mode: ListingMode.InStock }),
    ]);

    await expect(
      service.createMany(BUYER, [request(['a', 's'])]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a second live order in the same round', async () => {
    const { service, orders } = setup(orderWith([]), [
      listing('a'),
      listing('b'),
    ]);
    orders.findActivePreorder.mockResolvedValue({ id: 'existing' });

    await expect(
      service.createMany(BUYER, [request(['a', 'b'])]),
    ).rejects.toMatchObject({
      code: 'ALREADY_ORDERED',
      details: { orderId: 'existing' },
    });
    expect(orders.findActivePreorder).toHaveBeenCalledWith('camp-1', BUYER);
  });
});
