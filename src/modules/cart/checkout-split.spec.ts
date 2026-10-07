import { ListingMode } from '../listings/listings.constants.js';
import { PaymentMethod } from '../orders/orders.constants.js';
import { type SplitLine, splitIntoOrders } from './checkout-split.js';

const both = [PaymentMethod.PrepaidQr, PaymentMethod.PayOnDelivery];
const line = (overrides: Partial<SplitLine>): SplitLine => ({
  itemId: 'i1',
  listingId: 'l1',
  sellerId: 's1',
  mode: ListingMode.InStock,
  paymentMethods: both,
  ...overrides,
});

describe('splitIntoOrders', () => {
  it('puts one seller’s in-stock goods into one order', () => {
    expect(
      splitIntoOrders([
        line({ itemId: 'a', listingId: 'l1' }),
        line({ itemId: 'b', listingId: 'l2' }),
        line({ itemId: 'c', listingId: 'l2' }),
      ]),
    ).toEqual([
      {
        key: 'seller:s1',
        sellerId: 's1',
        itemIds: ['a', 'b', 'c'],
        paymentMethods: both,
      },
    ]);
  });

  it('makes one order per seller', () => {
    const orders = splitIntoOrders([
      line({ itemId: 'a', sellerId: 's1' }),
      line({ itemId: 'b', sellerId: 's2', listingId: 'l9' }),
    ]);
    expect(orders.map((order) => order.key)).toEqual([
      'seller:s1',
      'seller:s2',
    ]);
  });

  it('gives every pre-order listing its own order', () => {
    const orders = splitIntoOrders([
      line({ itemId: 'a', listingId: 'p1', mode: ListingMode.Preorder }),
      line({ itemId: 'b', listingId: 'p1', mode: ListingMode.Preorder }),
      line({ itemId: 'c', listingId: 'p2', mode: ListingMode.Preorder }),
      line({ itemId: 'd', listingId: 'l1' }),
    ]);
    expect(orders.map((order) => [order.key, order.itemIds])).toEqual([
      ['listing:p1', ['a', 'b']],
      ['listing:p2', ['c']],
      ['seller:s1', ['d']],
    ]);
  });

  it('keeps only the payment methods every listing accepts', () => {
    const [order] = splitIntoOrders([
      line({ itemId: 'a', listingId: 'l1' }),
      line({
        itemId: 'b',
        listingId: 'l2',
        paymentMethods: [PaymentMethod.PayOnDelivery],
      }),
    ]);
    expect(order.paymentMethods).toEqual([PaymentMethod.PayOnDelivery]);
  });

  it('splits a seller’s goods by listing when no method is shared', () => {
    const orders = splitIntoOrders([
      line({
        itemId: 'a',
        listingId: 'l1',
        paymentMethods: [PaymentMethod.PrepaidQr],
      }),
      line({
        itemId: 'b',
        listingId: 'l2',
        paymentMethods: [PaymentMethod.PayOnDelivery],
      }),
    ]);
    expect(orders).toEqual([
      {
        key: 'listing:l1',
        sellerId: 's1',
        itemIds: ['a'],
        paymentMethods: [PaymentMethod.PrepaidQr],
      },
      {
        key: 'listing:l2',
        sellerId: 's1',
        itemIds: ['b'],
        paymentMethods: [PaymentMethod.PayOnDelivery],
      },
    ]);
  });
});
