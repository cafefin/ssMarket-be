import {
  BUSINESS_TIME_ZONE,
  FRACTIONAL_UNIT,
  LISTING_LIMITS,
  LISTING_UNITS,
  ListingMode,
  ListingStatus,
} from './listings.constants.js';

export interface ListingItemInput {
  /** Set when editing to keep an existing item; absent for a new one. */
  id?: string;
  name: string;
  unit: string;
  /** Integer VND. */
  unitPrice: number;
  /** Decimal string with up to 3 fraction digits; null means unlimited. */
  stockQuantity: string | null;
}

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
  items: ListingItemInput[];
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

function itemProblems(
  item: ListingItemInput,
  index: number,
  mode: ListingMode,
): string[] {
  const problems: string[] = [];
  const label = `item ${index + 1}`;
  const name = item.name.trim();

  if (name.length === 0 || name.length > LISTING_LIMITS.itemNameMax) {
    problems.push(
      `${label}: name must be 1-${LISTING_LIMITS.itemNameMax} characters`,
    );
  }
  if (!(LISTING_UNITS as readonly string[]).includes(item.unit)) {
    problems.push(`${label}: unit is not supported`);
  }
  if (
    !Number.isInteger(item.unitPrice) ||
    item.unitPrice < LISTING_LIMITS.unitPriceMin ||
    item.unitPrice > LISTING_LIMITS.unitPriceMax
  ) {
    problems.push(
      `${label}: unit price must be a whole number from ${LISTING_LIMITS.unitPriceMin} to ${LISTING_LIMITS.unitPriceMax}`,
    );
  }

  if (mode === ListingMode.Preorder) {
    if (item.stockQuantity !== null) {
      problems.push(`${label}: pre-order items do not have stock`);
    }
    return problems;
  }

  if (item.stockQuantity === null) {
    problems.push(`${label}: stock is required for in-stock listings`);
  } else if (
    !DECIMAL.test(item.stockQuantity) ||
    Number(item.stockQuantity) <= 0
  ) {
    problems.push(
      `${label}: stock must be greater than 0 with at most 3 decimals`,
    );
  } else if (
    item.unit !== FRACTIONAL_UNIT &&
    !Number.isInteger(Number(item.stockQuantity))
  ) {
    problems.push(
      `${label}: only ${FRACTIONAL_UNIT} may have fractional stock`,
    );
  }

  return problems;
}

/**
 * Checks everything that can be decided from the input alone. Returns the
 * list of problems, empty when the input is valid. Whether the deadline is
 * still in the future is checked when publishing, not here.
 */
export function validateListingInput(input: ListingInput): string[] {
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
  if (
    input.items.length < LISTING_LIMITS.itemsMin ||
    input.items.length > LISTING_LIMITS.itemsMax
  ) {
    problems.push(
      `a listing needs ${LISTING_LIMITS.itemsMin}-${LISTING_LIMITS.itemsMax} items`,
    );
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

  input.items.forEach((item, index) => {
    problems.push(...itemProblems(item, index, input.mode));
  });

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
