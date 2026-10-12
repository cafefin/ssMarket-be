import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ListingStatus } from '../listings/listings.constants.js';
import { CampaignStatus } from '../campaigns/campaign.entity.js';
import { CampaignSummaryService } from './campaign-summary.service.js';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';

const item = (
  id: string,
  sortOrder: number,
  status: ListingStatus = ListingStatus.Open,
) => ({ id, title: `Món ${id}`, unit: 'cái', sortOrder, status });

const campaign = (items: ReturnType<typeof item>[]) => ({
  id: 'c1',
  sellerId: 's1',
  title: 'Đợt 1',
  status: CampaignStatus.Open,
  orderDeadline: new Date('2026-10-10T03:00:00.000Z'),
  deliveryDate: '2026-10-12',
  items,
});

const order = (id: string, lines: Array<[string, string]>, total = 1000) => ({
  id,
  code: `C${id}`,
  buyer: { name: 'Minh', email: 'm@x.vn' },
  deliveryLocation: 'Tầng 7',
  totalAmount: total,
  paymentMethod: PaymentMethod.PayOnDelivery,
  paymentStatus: PaymentStatus.Unpaid,
  fulfillmentStatus: FulfillmentStatus.Pending,
  note: null,
  createdAt: new Date('2026-10-06T03:05:00.000Z'),
  lines: lines.map(([listingId, quantity]) => ({ listingId, quantity })),
});

function setup() {
  const orders = {
    countForCampaign: vi.fn().mockResolvedValue(2),
    listForCampaign: vi.fn().mockResolvedValue([]),
    totalsForCampaign: vi
      .fn()
      .mockResolvedValue({ orderCount: 0, totalAmount: 0, paidAmount: 0 }),
    itemTotalsForCampaign: vi.fn().mockResolvedValue(new Map()),
    ordersOfCampaign: vi.fn().mockResolvedValue(new Set()),
    findActivePreorder: vi.fn().mockResolvedValue(null),
  };
  const ordersService = {
    deliver: vi.fn().mockResolvedValue(undefined),
    confirmPayment: vi.fn().mockResolvedValue(undefined),
  };
  const campaigns = {
    findOwned: vi.fn(),
    findById: vi.fn(),
  };
  const service = new CampaignSummaryService(
    orders as never,
    ordersService as never,
    campaigns as never,
  );
  return { service, orders, ordersService, campaigns };
}

describe('CampaignSummaryService.getSummary', () => {
  it('lists the products in round order and aligns quantities with them', async () => {
    const { service, orders, campaigns } = setup();
    campaigns.findOwned.mockResolvedValue(
      campaign([item('b', 1), item('a', 0), item('c', 2)]),
    );
    orders.listForCampaign.mockResolvedValue([
      order('o1', [
        ['c', '1'],
        ['a', '2'],
      ]),
    ]);
    orders.totalsForCampaign.mockResolvedValue({
      orderCount: 1,
      totalAmount: 5000,
      paidAmount: 2000,
    });
    orders.itemTotalsForCampaign.mockResolvedValue(
      new Map([
        ['a', 2],
        ['c', 1],
      ]),
    );

    const table = await service.getSummary('s1', 'c1', false);

    expect(table.items.map((i) => i.listingId)).toEqual(['a', 'b', 'c']);
    expect(table.rows[0].quantities).toEqual([2, 0, 1]);
    expect(table.itemTotals).toEqual([2, 0, 1]);
    expect(table.totals).toEqual({
      orderCount: 1,
      totalAmount: 5000,
      paidAmount: 2000,
      outstandingAmount: 3000,
    });
    expect(table.rows[0].createdAt).toBe('2026-10-06T03:05:00.000Z');
    expect(table.campaign).toMatchObject({ id: 'c1', title: 'Đợt 1' });
    expect(orders.listForCampaign).toHaveBeenCalledWith('c1', false);
  });

  it('keeps a stopped product that was ordered and leaves out one nobody ordered', async () => {
    const { service, orders, campaigns } = setup();
    campaigns.findOwned.mockResolvedValue(
      campaign([
        item('a', 0, ListingStatus.Closed),
        item('b', 1, ListingStatus.Closed),
        item('c', 2),
      ]),
    );
    orders.listForCampaign.mockResolvedValue([order('o1', [['a', '1']])]);
    orders.itemTotalsForCampaign.mockResolvedValue(new Map([['a', 1]]));

    const table = await service.getSummary('s1', 'c1', false);

    expect(table.items.map((i) => i.listingId)).toEqual(['a', 'c']);
    expect(table.rows[0].quantities).toEqual([1, 0]);
    expect(table.itemTotals).toEqual([1, 0]);
  });

  it('keeps a stopped product that only a cancelled order shown holds', async () => {
    const { service, orders, campaigns } = setup();
    campaigns.findOwned.mockResolvedValue(
      campaign([item('a', 0, ListingStatus.Closed), item('b', 1)]),
    );
    orders.listForCampaign.mockResolvedValue([order('o1', [['a', '3']])]);

    const table = await service.getSummary('s1', 'c1', true);

    expect(table.items.map((i) => i.listingId)).toEqual(['a', 'b']);
    expect(table.itemTotals).toEqual([0, 0]);
    expect(orders.listForCampaign).toHaveBeenCalledWith('c1', true);
  });

  it('refuses a round with more than 1000 orders', async () => {
    const { service, orders, campaigns } = setup();
    campaigns.findOwned.mockResolvedValue(campaign([item('a', 0)]));
    orders.countForCampaign.mockResolvedValue(1001);

    await expect(service.getSummary('s1', 'c1', false)).rejects.toMatchObject({
      status: 422,
      code: 'SUMMARY_TOO_LARGE',
    });
    expect(orders.listForCampaign).not.toHaveBeenCalled();
  });

  it('allows exactly 1000 orders', async () => {
    const { service, orders, campaigns } = setup();
    campaigns.findOwned.mockResolvedValue(campaign([item('a', 0)]));
    orders.countForCampaign.mockResolvedValue(1000);

    await expect(service.getSummary('s1', 'c1', false)).resolves.toBeDefined();
  });

  it('passes on the ownership errors', async () => {
    const { service, campaigns } = setup();
    campaigns.findOwned.mockRejectedValue(new ForbiddenException());

    await expect(service.getSummary('x', 'c1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('CampaignSummaryService.bulk', () => {
  it('reports orders of another round and carries on with the rest', async () => {
    const { service, orders, ordersService, campaigns } = setup();
    campaigns.findOwned.mockResolvedValue(campaign([item('a', 0)]));
    orders.ordersOfCampaign.mockResolvedValue(new Set(['o1', 'o2']));
    ordersService.deliver.mockRejectedValueOnce(new NotFoundException());

    const results = await service.bulk('s1', 'c1', 'deliver', [
      'o1',
      'o1',
      'o2',
      'o3',
    ]);

    expect(results).toEqual([
      { orderId: 'o1', ok: false, code: 'NOT_FOUND' },
      { orderId: 'o2', ok: true, code: null },
      { orderId: 'o3', ok: false, code: 'NOT_IN_CAMPAIGN' },
    ]);
    expect(orders.ordersOfCampaign).toHaveBeenCalledWith(
      ['o1', 'o2', 'o3'],
      'c1',
    );
  });

  it('is only for the seller', async () => {
    const { service, campaigns } = setup();
    campaigns.findOwned.mockRejectedValue(new ForbiddenException());

    await expect(
      service.bulk('x', 'c1', 'confirm_payment', ['o1']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CampaignSummaryService.myOrder', () => {
  it('answers 404 for a missing round and for a draft', async () => {
    const { service, campaigns } = setup();
    campaigns.findById.mockResolvedValueOnce(null);
    campaigns.findById.mockResolvedValueOnce({
      ...campaign([]),
      status: CampaignStatus.Draft,
    });

    await expect(service.myOrder('b1', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.myOrder('b1', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the live order id, or null', async () => {
    const { service, orders, campaigns } = setup();
    campaigns.findById.mockResolvedValue(campaign([]));
    orders.findActivePreorder.mockResolvedValueOnce({ id: 'o9' });

    expect(await service.myOrder('b1', 'c1')).toEqual({ orderId: 'o9' });
    expect(await service.myOrder('b1', 'c1')).toEqual({ orderId: null });
  });
});
