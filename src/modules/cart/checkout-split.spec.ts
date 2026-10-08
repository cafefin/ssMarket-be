import { ListingMode } from '../listings/listings.constants.js';
import { PaymentMethod } from '../orders/orders.constants.js';
import { type SplitLine, splitIntoOrders } from './checkout-split.js';

const both = [PaymentMethod.PrepaidQr, PaymentMethod.PayOnDelivery];
const line = (overrides: Partial<SplitLine>): SplitLine => ({
  listingId: 'l1',
  sellerId: 's1',
  mode: ListingMode.InStock,
  paymentMethods: both,
  ...overrides,
});

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

  it('gives every pre-order its own order', () => {
    const orders = splitIntoOrders([
      line({ listingId: 'p1', mode: ListingMode.Preorder }),
      line({ listingId: 'p2', mode: ListingMode.Preorder }),
      line({ listingId: 'l1' }),
    ]);
    expect(orders.map((order) => [order.key, order.listingIds])).toEqual([
      ['listing:p1', ['p1']],
      ['listing:p2', ['p2']],
      ['seller:s1', ['l1']],
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
