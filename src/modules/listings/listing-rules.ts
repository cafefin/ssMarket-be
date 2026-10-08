import {
  BUSINESS_TIME_ZONE,
  FRACTIONAL_UNIT,
  LISTING_LIMITS,
  LISTING_UNITS,
  ListingCondition,
  ListingMode,
  ListingStatus,
} from './listings.constants.js';
import { type Combo, lineTotal, toThousandths } from './pricing.js';

export interface ListingInput {
  mode: ListingMode;
  title: string;
  categoryId: number;
  description: string;
  acceptsPrepaidQr: boolean;
  acceptsPayOnDelivery: boolean;
  orderDeadline: Date | null;
  /** Calendar date, YYYY-MM-DD. */
  deliveryDate: string | null;
  /** Second-hand condition; only for in-stock goods outside food categories. */
  condition: ListingCondition | null;
  unit: string;
  /** Integer VND. */
  unitPrice: number;
  /** Decimal string with up to 3 fraction digits; null for a pre-order. */
  stockQuantity: string | null;
  /** "N units for a set price"; at most three. */
  combos: Combo[];
}

/** What validation needs to know about the chosen category. */
export interface ListingCategoryFacts {
  /** Food and other goods that go off: they have no "condition". */
  isPerishable: boolean;
}

const DECIMAL = /^\d{1,7}(\.\d{1,3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date of an instant, as people in the office see it. */
export function businessDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
  }).format(instant);
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function productProblems(input: ListingInput): string[] {
  const problems: string[] = [];

  if (!(LISTING_UNITS as readonly string[]).includes(input.unit)) {
    problems.push('unit is not supported');
  }
  if (
    !Number.isInteger(input.unitPrice) ||
    input.unitPrice < LISTING_LIMITS.unitPriceMin ||
    input.unitPrice > LISTING_LIMITS.unitPriceMax
  ) {
    problems.push(
      `unit price must be a whole number from ${LISTING_LIMITS.unitPriceMin} to ${LISTING_LIMITS.unitPriceMax}`,
    );
  }

  problems.push(...comboProblems(input));

  if (input.mode === ListingMode.Preorder) {
    if (input.stockQuantity !== null) {
      problems.push('pre-orders do not have stock');
    }
    return problems;
  }

  if (input.stockQuantity === null) {
    problems.push('stock is required for in-stock products');
  } else if (
    !DECIMAL.test(input.stockQuantity) ||
    Number(input.stockQuantity) <= 0
  ) {
    problems.push('stock must be greater than 0 with at most 3 decimals');
  } else if (
    input.unit !== FRACTIONAL_UNIT &&
    !Number.isInteger(Number(input.stockQuantity))
  ) {
    problems.push(`only ${FRACTIONAL_UNIT} may have fractional stock`);
  }

  return problems;
}

function comboProblems(input: ListingInput): string[] {
  const problems: string[] = [];
  if (input.combos.length > LISTING_LIMITS.combosMax) {
    problems.push(`at most ${LISTING_LIMITS.combosMax} combos`);
  }
  // Pieces are sold whole; kg in steps of 0.1.
  const step = input.unit === FRACTIONAL_UNIT ? 100 : 1000;
  const sizes = new Set<number>();
  input.combos.forEach((combo, index) => {
    const name = `combo ${index + 1}`;
    const size = toThousandths(combo.quantity);
    if (size === null || size <= step || size % step !== 0) {
      problems.push(
        `${name}: quantity must be more than one ${input.unit === FRACTIONAL_UNIT ? '0.1 kg step' : 'unit'} and a multiple of it`,
      );
      return;
    }
    if (sizes.has(size)) {
      problems.push(`${name}: another combo has the same quantity`);
    }
    sizes.add(size);
    if (
      !Number.isInteger(combo.price) ||
      combo.price < LISTING_LIMITS.unitPriceMin ||
      combo.price > LISTING_LIMITS.unitPriceMax
    ) {
      problems.push(
        `${name}: price must be a whole number from ${LISTING_LIMITS.unitPriceMin} to ${LISTING_LIMITS.unitPriceMax}`,
      );
    } else if (
      Number.isInteger(input.unitPrice) &&
      combo.price >= lineTotal(input.unitPrice, combo.quantity)
    ) {
      problems.push(
        `${name}: must cost less than buying the same quantity singly`,
      );
    }
  });
  return problems;
}

/**
 * Checks everything that can be decided from the input alone. Returns the
 * list of problems, empty when the input is valid. Whether the deadline is
 * still in the future is checked when publishing, not here.
 */
export function validateListingInput(
  input: ListingInput,
  category: ListingCategoryFacts = { isPerishable: false },
): string[] {
  const problems: string[] = [];
  const title = input.title.trim();

  if (
    title.length < LISTING_LIMITS.titleMin ||
    title.length > LISTING_LIMITS.titleMax
  ) {
    problems.push(
      `title must be ${LISTING_LIMITS.titleMin}-${LISTING_LIMITS.titleMax} characters`,
    );
  }
  if (input.description.length > LISTING_LIMITS.descriptionMax) {
    problems.push(
      `description must be at most ${LISTING_LIMITS.descriptionMax} characters`,
    );
  }
  if (!input.acceptsPrepaidQr && !input.acceptsPayOnDelivery) {
    problems.push('at least one payment method is required');
  }
  if (input.mode === ListingMode.InStock) {
    if (input.orderDeadline !== null || input.deliveryDate !== null) {
      problems.push(
        'in-stock listings do not have an order deadline or delivery date',
      );
    }
  } else {
    if (input.orderDeadline === null) {
      problems.push('pre-order listings need an order deadline');
    }
    if (input.deliveryDate === null) {
      problems.push('pre-order listings need a delivery date');
    } else if (!isRealDate(input.deliveryDate)) {
      problems.push('delivery date must be a valid date (YYYY-MM-DD)');
    } else if (
      input.orderDeadline !== null &&
      input.deliveryDate < businessDate(input.orderDeadline)
    ) {
      problems.push('delivery date cannot be before the order deadline');
    }
  }

  const needsCondition =
    input.mode === ListingMode.InStock && !category.isPerishable;
  if (needsCondition && input.condition === null) {
    problems.push('in-stock goods need a condition');
  } else if (!needsCondition && input.condition !== null) {
    problems.push(
      'only in-stock goods outside food categories have a condition',
    );
  }

  problems.push(...productProblems(input));

  return problems;
}

/** Open means buyers can see it and, from phase 2b, order from it. */
export function isListingOpen(
  listing: { status: ListingStatus; orderDeadline: Date | null },
  now: Date,
): boolean {
  return (
    listing.status === ListingStatus.Open &&
    (listing.orderDeadline === null ||
      listing.orderDeadline.getTime() > now.getTime())
  );
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Dates to propose when a finished pre-order round is reopened: the next
 * time the same weekday and hour come round after `now`, with delivery the
 * same number of days after the deadline as before. Sellers who run monthly
 * simply change them; they are only a starting point.
 */
export function suggestReopenDates(
  previousDeadline: Date,
  previousDeliveryDate: string,
  now: Date,
): { orderDeadline: Date; deliveryDate: string } {
  let orderDeadline = previousDeadline;
  while (orderDeadline.getTime() <= now.getTime()) {
    // Vietnam has no daylight saving, so a week is always 7 × 24 hours.
    orderDeadline = new Date(orderDeadline.getTime() + WEEK_MS);
  }

  const asUtcDay = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const gapDays = Math.round(
    (asUtcDay(previousDeliveryDate) -
      asUtcDay(businessDate(previousDeadline))) /
      DAY_MS,
  );
  const deliveryDate = new Date(
    asUtcDay(businessDate(orderDeadline)) + gapDays * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);

  return { orderDeadline, deliveryDate };
}
