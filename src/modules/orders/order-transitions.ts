import { DomainException } from '../../common/errors/domain.exception.js';
import {
  FulfillmentStatus,
  OrderActor,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';

/** The part of an order that the state rules look at. */
export interface OrderState {
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  isPreorder: boolean;
}

export type PaymentAction = 'report' | 'confirm' | 'reject';

function invalid(message: string): DomainException {
  return new DomainException(409, 'INVALID_ORDER_STATE', message);
}

function assertNotCancelled(order: OrderState): void {
  if (order.fulfillmentStatus === FulfillmentStatus.Cancelled) {
    throw invalid('The order has been cancelled');
  }
}

/**
 * Payment and delivery move independently: an order may be delivered before
 * it is paid, which is normal for pay-on-delivery.
 *
 * report:  buyer,  unpaid   -> reported   (QR orders only)
 * confirm: seller, unpaid   -> paid
 *                  reported -> paid
 * reject:  seller, reported -> unpaid
 */
export function nextPaymentStatus(
  order: OrderState,
  action: PaymentAction,
): PaymentStatus {
  assertNotCancelled(order);
  const { paymentStatus } = order;

  if (action === 'report') {
    if (order.paymentMethod !== PaymentMethod.PrepaidQr) {
      throw invalid('Only QR orders can be reported as transferred');
    }
    if (paymentStatus !== PaymentStatus.Unpaid) {
      throw invalid('The payment has already been reported');
    }
    return PaymentStatus.Reported;
  }

  if (action === 'confirm') {
    if (paymentStatus === PaymentStatus.Paid) {
      throw invalid('The payment has already been confirmed');
    }
    return PaymentStatus.Paid;
  }

  if (paymentStatus !== PaymentStatus.Reported) {
    throw invalid('There is no reported payment to reject');
  }
  return PaymentStatus.Unpaid;
}

export function assertCanDeliver(order: OrderState): void {
  assertNotCancelled(order);
  if (order.fulfillmentStatus !== FulfillmentStatus.Pending) {
    throw invalid('The order has already been delivered');
  }
}

/**
 * Buyers may back out only while nothing has been paid and, for a pre-order,
 * while the seller has not yet bought goods for the round (the deadline).
 * Sellers may cancel anything not yet delivered.
 */
export function assertCanCancel(
  order: OrderState,
  actor: OrderActor,
  context: { now: Date; orderDeadline: Date | null },
): void {
  assertNotCancelled(order);
  if (order.fulfillmentStatus !== FulfillmentStatus.Pending) {
    throw invalid('A delivered order cannot be cancelled');
  }
  if (actor === OrderActor.Seller) {
    return;
  }

  if (order.paymentStatus !== PaymentStatus.Unpaid) {
    throw invalid('Ask the seller to cancel an order that has been paid for');
  }
  if (
    order.isPreorder &&
    context.orderDeadline !== null &&
    context.orderDeadline.getTime() <= context.now.getTime()
  ) {
    throw invalid('A pre-order cannot be cancelled after its deadline');
  }
}

/** True when cancelling means money has to go back to the buyer. */
export function needsRefund(order: OrderState): boolean {
  return order.paymentStatus !== PaymentStatus.Unpaid;
}
