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
  itemsMax: 20,
  itemNameMax: 120,
  unitPriceMin: 1_000,
  unitPriceMax: 1_000_000_000,
  imagesMax: 5,
} as const;

/** Business dates (deadline day, delivery day) are read in this time zone. */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
