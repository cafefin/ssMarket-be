import { ListingMode } from '../listings/listings.constants.js';
import { PaymentMethod } from '../orders/orders.constants.js';
import { type SplitLine, splitIntoOrders } from './checkout-split.js';

const both = [PaymentMethod.PrepaidQr, PaymentMethod.PayOnDelivery];
const line = (overrides: Partial<SplitLine>): SplitLine => ({
  listingId: 'l1',
  sellerId: 's1',
  mode: ListingMode.InStock,
  campaignId: null,
  paymentMethods: both,
  ...overrides,
});
const item = (overrides: Partial<SplitLine>): SplitLine =>
  line({ mode: ListingMode.Preorder, campaignId: 'c1', ...overrides });

describe('splitIntoOrders', () => {
  it('puts one seller’s in-stock products into one order', () => {
    expect(
      splitIntoOrders([
        line({ listingId: 'l1' }),
        line({ listingId: 'l2' }),
        line({ listingId: 'l3' }),
      ]),
    ).toEqual([
      {
        key: 'seller:s1',
        sellerId: 's1',
        listingIds: ['l1', 'l2', 'l3'],
        paymentMethods: both,
      },
    ]);
  });

  it('makes one order per seller', () => {
    const orders = splitIntoOrders([
      line({ listingId: 'l1', sellerId: 's1' }),
      line({ listingId: 'l9', sellerId: 's2' }),
    ]);
    expect(orders.map((order) => order.key)).toEqual([
      'seller:s1',
      'seller:s2',
    ]);
  });

  it('puts the products of one round into one order', () => {
    expect(
      splitIntoOrders([item({ listingId: 'p1' }), item({ listingId: 'p2' })]),
    ).toEqual([
      {
        key: 'campaign:c1',
        sellerId: 's1',
        listingIds: ['p1', 'p2'],
        paymentMethods: both,
      },
    ]);
  });

  it('makes one order per round, apart from the seller’s in-stock goods', () => {
    const orders = splitIntoOrders([
      item({ listingId: 'p1', campaignId: 'c1' }),
      line({ listingId: 'l1' }),
      item({ listingId: 'p2', campaignId: 'c2' }),
      item({ listingId: 'p3', campaignId: 'c1' }),
    ]);
    expect(orders.map((order) => [order.key, order.listingIds])).toEqual([
      ['campaign:c1', ['p1', 'p3']],
      ['seller:s1', ['l1']],
      ['campaign:c2', ['p2']],
    ]);
  });

  it('never splits a round, even when no payment method can be used', () => {
    expect(
      splitIntoOrders([
        item({ listingId: 'p1', paymentMethods: [] }),
        item({ listingId: 'p2', paymentMethods: [] }),
      ]),
    ).toEqual([
      {
        key: 'campaign:c1',
        sellerId: 's1',
        listingIds: ['p1', 'p2'],
        paymentMethods: [],
      },
    ]);
  });

  it('keeps only the payment methods every product accepts', () => {
    const [order] = splitIntoOrders([
      line({ listingId: 'l1' }),
      line({
        listingId: 'l2',
        paymentMethods: [PaymentMethod.PayOnDelivery],
      }),
    ]);
    expect(order.paymentMethods).toEqual([PaymentMethod.PayOnDelivery]);
  });

  it('splits a seller’s products when no method is shared', () => {
    const orders = splitIntoOrders([
      line({ listingId: 'l1', paymentMethods: [PaymentMethod.PrepaidQr] }),
      line({ listingId: 'l2', paymentMethods: [PaymentMethod.PayOnDelivery] }),
    ]);
    expect(orders).toEqual([
      {
        key: 'listing:l1',
        sellerId: 's1',
        listingIds: ['l1'],
        paymentMethods: [PaymentMethod.PrepaidQr],
      },
      {
        key: 'listing:l2',
        sellerId: 's1',
        listingIds: ['l2'],
        paymentMethods: [PaymentMethod.PayOnDelivery],
      },
    ]);
  });
});
