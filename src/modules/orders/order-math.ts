import { FRACTIONAL_UNIT } from '../listings/listings.constants.js';
import { ORDER_LIMITS } from './orders.constants.js';

const DECIMAL = /^\d{1,7}(\.\d{1,3})?$/;

/** "1.5" -> 1500. Integers only from here on; money never touches a float. */
export function toThousandths(quantity: string): number | null {
  if (!DECIMAL.test(quantity)) {
    return null;
  }
  const [whole, fraction = ''] = quantity.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}

/**
 * Why a quantity cannot be ordered for an item sold in `unit`, or null when
 * it can. Only kg is sold in fractions, in steps of 0.1.
 */
export function quantityProblem(quantity: string, unit: string): string | null {
  const thousandths = toThousandths(quantity);
  if (thousandths === null) {
    return 'quantity must be a positive number';
  }
  if (thousandths > ORDER_LIMITS.quantityMax * 1000) {
    return `quantity must be at most ${ORDER_LIMITS.quantityMax}`;
  }
  if (unit === FRACTIONAL_UNIT) {
    return thousandths >= 100 && thousandths % 100 === 0
      ? null
      : 'kg is ordered in steps of 0.1, from 0.1';
  }
  return thousandths >= 1000 && thousandths % 1000 === 0
    ? null
    : 'quantity must be a whole number from 1';
}

/** unit price × quantity, rounded half up to a whole đồng. */
export function lineTotal(unitPrice: number, quantity: string): number {
  const thousandths = toThousandths(quantity);
  if (thousandths === null) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }
  // unitPrice ≤ 10^9 and thousandths ≤ 10^7, so the product stays far below
  // 2^53 and the arithmetic is exact.
  return Math.floor((unitPrice * thousandths + 500) / 1000);
}
