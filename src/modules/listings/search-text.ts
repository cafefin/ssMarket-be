import { normalizeForSearch } from '../../common/text/normalize.js';

/**
 * The text a listing is searchable by: title and description, in the same
 * normal form that user queries are converted to.
 */
export function buildSearchText(listing: {
  title: string;
  description: string;
}): string {
  return normalizeForSearch([listing.title, listing.description].join(' '));
}
