import { normalizeForSearch } from '../../common/text/normalize.js';

/**
 * The text a listing is searchable by: title, description and every item
 * name, in the same normal form that user queries are converted to.
 */
export function buildSearchText(listing: {
  title: string;
  description: string;
  items: ReadonlyArray<{ name: string }>;
}): string {
  return normalizeForSearch(
    [
      listing.title,
      listing.description,
      ...listing.items.map((item) => item.name),
    ].join(' '),
  );
}
