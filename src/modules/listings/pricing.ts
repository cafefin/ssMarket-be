// Money and quantity arithmetic shared by listings (combo rules) and orders
// (line totals). Quantities are decimal strings with up to 3 fraction digits
// and are handled as integer thousandths; money is integer VND throughout.

const DECIMAL = /^\d{1,7}(\.\d{1,3})?$/;

/** "1.5" -> 1500. Integers only from here on; money never touches a float. */
export function toThousandths(quantity: string): number | null {
  if (!DECIMAL.test(quantity)) {
    return null;
  }
  const [whole, fraction = ''] = quantity.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}

/** unit price × quantity in thousandths, rounded half up to a whole đồng. */
function retailTotal(unitPrice: number, thousandths: number): number {
  // unitPrice ≤ 10^9 and thousandths ≤ 10^7, so the product stays far below
  // 2^53 and the arithmetic is exact.
  return Math.floor((unitPrice * thousandths + 500) / 1000);
}

/** unit price × quantity, rounded half up to a whole đồng. */
export function lineTotal(unitPrice: number, quantity: string): number {
  const thousandths = toThousandths(quantity);
  if (thousandths === null) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }
  return retailTotal(unitPrice, thousandths);
}

/** A set quantity sold for a set price, e.g. 100 pieces for 900,000 đ. */
export interface Combo {
  /** Decimal string, like a line quantity. */
  quantity: string;
  /** The price of the whole combo, integer VND. */
  price: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The cheapest way to buy `quantity`: any number of each combo plus the rest
 * at the unit price. Dynamic programming over quantity in steps of the
 * greatest common divisor of the sizes; at most 99,990 steps (9,999 kg in
 * 0.1 kg steps) times 3 combos, so it is fast. Combos never cost more than
 * buying the same amount singly, because that option is always considered.
 */
export function lineTotalWithCombos(
  unitPrice: number,
  combos: ReadonlyArray<Combo>,
  quantity: string,
): number {
  const total = toThousandths(quantity);
  if (total === null) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }
  const sizes = combos
    .map((combo) => ({
      size: toThousandths(combo.quantity),
      price: combo.price,
    }))
    .filter(
      (combo): combo is { size: number; price: number } =>
        combo.size !== null && combo.size > 0 && combo.size <= total,
    );
  if (sizes.length === 0) {
    return retailTotal(unitPrice, total);
  }

  const step = sizes.reduce((g, combo) => gcd(g, combo.size), total);
  const steps = total / step;
  const best = Array.from<number>({ length: steps + 1 });
  best[0] = 0;
  for (let i = 1; i <= steps; i += 1) {
    let cheapest = retailTotal(unitPrice, i * step);
    for (const combo of sizes) {
      const before = i - combo.size / step;
      if (before >= 0) {
        cheapest = Math.min(cheapest, best[before] + combo.price);
      }
    }
    best[i] = cheapest;
  }
  return best[steps];
}
