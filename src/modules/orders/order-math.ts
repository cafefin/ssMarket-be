import { FRACTIONAL_UNIT } from '../listings/listings.constants.js';
import { toThousandths } from '../listings/pricing.js';
import { ORDER_LIMITS } from './orders.constants.js';

export {
  type Combo,
  lineTotal,
  lineTotalWithCombos,
  toThousandths,
} from '../listings/pricing.js';

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
