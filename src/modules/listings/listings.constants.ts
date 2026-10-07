export enum ListingMode {
  InStock = 'in_stock',
  Preorder = 'preorder',
}

export enum ListingSort {
  /** Newest first; the default. */
  Recent = 'recent',
  /** Pre-orders that are still taking orders, closing soonest first. */
  Deadline = 'deadline',
}

export enum ListingStatus {
  Draft = 'draft',
  Open = 'open',
  Closed = 'closed',
}

export const LISTING_UNITS = [
  'cái',
  'kg',
  'hộp',
  'túi',
  'chai',
  'bó',
  'combo',
] as const;
export type ListingUnit = (typeof LISTING_UNITS)[number];

/** The only unit that may be sold in fractional quantities. */
export const FRACTIONAL_UNIT: ListingUnit = 'kg';

export const LISTINGS_CACHE_NAMESPACE = 'listings';
export const LISTINGS_CACHE_TTL_SECONDS = 60;

export const LISTING_LIMITS = {
  titleMin: 5,
  titleMax: 120,
  descriptionMax: 5000,
  itemsMin: 1,
  itemsMax: 10,
  itemNameMax: 120,
  combosMax: 3,
  unitPriceMin: 1_000,
  unitPriceMax: 1_000_000_000,
  imagesMax: 5,
} as const;

/**
 * How worn a second-hand item is. Sellers pick a level; buyers see the level
 * with its percentage and filter by "at least".
 */
export enum ListingCondition {
  New = 'new',
  LikeNew = 'like_new',
  Excellent = 'excellent',
  Good = 'good',
  Fair = 'fair',
  Worn = 'worn',
}

export const CONDITION_PERCENT: Record<ListingCondition, number> = {
  [ListingCondition.New]: 100,
  [ListingCondition.LikeNew]: 99,
  [ListingCondition.Excellent]: 95,
  [ListingCondition.Good]: 90,
  [ListingCondition.Fair]: 80,
  [ListingCondition.Worn]: 70,
};

/** Business dates (deadline day, delivery day) are read in this time zone. */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
