import { normalizeForSearch } from '../../common/text/normalize.js';

/** A URL-safe slug from a Vietnamese name; empty when no letter or digit is left. */
export function categorySlug(name: string): string {
  return normalizeForSearch(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
}
