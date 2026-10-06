import { DomainException } from '../../common/errors/domain.exception.js';
import { generateOrderCode } from './order-code.js';
import { lineTotal, quantityProblem, toThousandths } from './order-math.js';
import {
  assertCanCancel,
  assertCanDeliver,
  needsRefund,
  nextPaymentStatus,
  type OrderState,
} from './order-transitions.js';
import {
  FulfillmentStatus,
  OrderActor,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';

describe('toThousandths', () => {
  it.each([
    ['1', 1000],
    ['1.5', 1500],
    ['0.1', 100],
    ['0.001', 1],
    ['12.34', 12340],
    ['9999', 9999000],
  ])('%j -> %d', (quantity, expected) => {
    expect(toThousandths(quantity)).toBe(expected);
  });

  it.each(['', 'abc', '-1', '1.2345', '1.', '.5', '1e3', '12345678', ' 1'])(
    '%j is not a quantity',
    (quantity) => {
      expect(toThousandths(quantity)).toBeNull();
    },
  );
});

describe('lineTotal', () => {
  it.each([
    [35000, '2', 70000],
    [35000, '1.5', 52500],
    [33333, '0.1', 3333],
    [33335, '0.1', 3334],
    [1000, '0.001', 1],
    [1499, '0.001', 1],
    [1500, '0.001', 2],
    [1000000000, '9999', 9999000000000],
  ])('%d × %s = %d', (unitPrice, quantity, expected) => {
    expect(lineTotal(unitPrice, quantity)).toBe(expected);
  });

  it('never produces a fraction of a đồng', () => {
    for (const quantity of ['0.1', '0.3', '0.7', '1.1', '2.9']) {
      expect(Number.isInteger(lineTotal(33333, quantity))).toBe(true);
    }
  });

  it('refuses a malformed quantity instead of guessing', () => {
    expect(() => lineTotal(1000, 'abc')).toThrow('Invalid quantity: abc');
  });
});

describe('quantityProblem', () => {
  it.each(['0.1', '1.5', '12', '9999'])('kg accepts %j', (quantity) => {
    expect(quantityProblem(quantity, 'kg')).toBeNull();
  });

  it.each(['0', '0.05', '1.25', '10000', 'abc', '-1'])(
    'kg rejects %j',
    (quantity) => {
      expect(quantityProblem(quantity, 'kg')).not.toBeNull();
    },
  );

  it.each(['1', '25', '9999'])('cái accepts %j', (quantity) => {
    expect(quantityProblem(quantity, 'cái')).toBeNull();
  });

  it.each(['0', '1.5', '0.5', '10000', ''])('cái rejects %j', (quantity) => {
    expect(quantityProblem(quantity, 'cái')).not.toBeNull();
  });
});

describe('generateOrderCode', () => {
  it('is SSM followed by six unambiguous characters', () => {
    for (let i = 0; i < 2000; i += 1) {
      expect(generateOrderCode()).toMatch(/^SSM[2-9A-HJ-NP-Z]{6}$/);
    }
  });

  it('uses the injected random source', () => {
    expect(generateOrderCode(() => 0)).toBe('SSM222222');
    expect(generateOrderCode((max) => max - 1)).toBe('SSMZZZZZZ');
  });

  it('rarely repeats', () => {
    const codes = new Set(
      Array.from({ length: 5000 }, () => generateOrderCode()),
    );
    expect(codes.size).toBeGreaterThan(4990);
  });
});

const order = (overrides: Partial<OrderState> = {}): OrderState => ({
  paymentMethod: PaymentMethod.PrepaidQr,
  paymentStatus: PaymentStatus.Unpaid,
  fulfillmentStatus: FulfillmentStatus.Pending,
  isPreorder: false,
  ...overrides,
});

function expectInvalid(action: () => unknown): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainException);
  expect((thrown as DomainException).code).toBe('INVALID_ORDER_STATE');
}

describe('nextPaymentStatus', () => {
  const { Unpaid, Reported, Paid } = PaymentStatus;

  it.each([
    ['report', Unpaid, Reported],
    ['confirm', Unpaid, Paid],
    ['confirm', Reported, Paid],
    ['reject', Reported, Unpaid],
  ] as const)('%s from %s gives %s', (action, from, to) => {
    expect(nextPaymentStatus(order({ paymentStatus: from }), action)).toBe(to);
  });

  it.each([
    ['report', Reported],
    ['report', Paid],
    ['confirm', Paid],
    ['reject', Unpaid],
    ['reject', Paid],
  ] as const)('%s from %s is not allowed', (action, from) => {
    expectInvalid(() =>
      nextPaymentStatus(order({ paymentStatus: from }), action),
    );
  });

  it('lets only QR orders be reported, but any order be confirmed', () => {
    const payOnDelivery = order({ paymentMethod: PaymentMethod.PayOnDelivery });

    expectInvalid(() => nextPaymentStatus(payOnDelivery, 'report'));
    expect(nextPaymentStatus(payOnDelivery, 'confirm')).toBe(Paid);
  });

  it('allows payment to be confirmed after delivery', () => {
    expect(
      nextPaymentStatus(
        order({ fulfillmentStatus: FulfillmentStatus.Delivered }),
        'confirm',
      ),
    ).toBe(Paid);
  });

  it.each(['report', 'confirm', 'reject'] as const)(
    'refuses %s on a cancelled order',
    (action) => {
      expectInvalid(() =>
        nextPaymentStatus(
          order({
            paymentStatus: Reported,
            fulfillmentStatus: FulfillmentStatus.Cancelled,
          }),
          action,
        ),
      );
    },
  );
});

describe('assertCanDeliver', () => {
  it('allows a pending order, paid or not', () => {
    expect(() => assertCanDeliver(order())).not.toThrow();
    expect(() =>
      assertCanDeliver(order({ paymentStatus: PaymentStatus.Paid })),
    ).not.toThrow();
  });

  it.each([FulfillmentStatus.Delivered, FulfillmentStatus.Cancelled])(
    'refuses an order that is %s',
    (fulfillmentStatus) => {
      expectInvalid(() => assertCanDeliver(order({ fulfillmentStatus })));
    },
  );
});

describe('assertCanCancel', () => {
  const now = new Date('2026-10-06T03:00:00Z');
  const future = new Date('2026-10-07T03:00:00Z');
  const past = new Date('2026-10-05T03:00:00Z');
  const { Buyer, Seller } = OrderActor;
  const at = (orderDeadline: Date | null) => ({ now, orderDeadline });

  it('lets the buyer cancel an unpaid pending order', () => {
    expect(() => assertCanCancel(order(), Buyer, at(null))).not.toThrow();
  });

  it.each([PaymentStatus.Reported, PaymentStatus.Paid])(
    'does not let the buyer cancel once payment is %s',
    (paymentStatus) => {
      expectInvalid(() =>
        assertCanCancel(order({ paymentStatus }), Buyer, at(null)),
      );
    },
  );

  it('lets the buyer cancel a pre-order only before its deadline', () => {
    const preorder = order({ isPreorder: true });

    expect(() => assertCanCancel(preorder, Buyer, at(future))).not.toThrow();
    expectInvalid(() => assertCanCancel(preorder, Buyer, at(past)));
    expectInvalid(() => assertCanCancel(preorder, Buyer, at(now)));
  });

  it('ignores the deadline for in-stock orders', () => {
    expect(() => assertCanCancel(order(), Buyer, at(past))).not.toThrow();
  });

  it('lets the seller cancel any pending order, whatever was paid', () => {
    for (const paymentStatus of Object.values(PaymentStatus)) {
      expect(() =>
        assertCanCancel(
          order({ paymentStatus, isPreorder: true }),
          Seller,
          at(past),
        ),
      ).not.toThrow();
    }
  });

  it.each([Buyer, Seller])(
    'lets nobody (%s) cancel a delivered or cancelled order',
    (actor) => {
      for (const fulfillmentStatus of [
        FulfillmentStatus.Delivered,
        FulfillmentStatus.Cancelled,
      ]) {
        expectInvalid(() =>
          assertCanCancel(order({ fulfillmentStatus }), actor, at(null)),
        );
      }
    },
  );
});

describe('needsRefund', () => {
  it('is true once money may have moved', () => {
    expect(needsRefund(order())).toBe(false);
    expect(needsRefund(order({ paymentStatus: PaymentStatus.Reported }))).toBe(
      true,
    );
    expect(needsRefund(order({ paymentStatus: PaymentStatus.Paid }))).toBe(
      true,
    );
  });
});
