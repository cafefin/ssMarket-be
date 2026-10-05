import { normalizeForSearch } from '../../common/text/normalize.js';

/**
 * Builds a safe tsquery: every term must match, the last one as a prefix so
 * results appear while the user is still typing. Anything that is not a
 * letter or digit is treated as a separator, so tsquery operators typed by
 * the user can never reach the database.
 */
export function toTsQuery(q: string): string | null {
  const terms = normalizeForSearch(q)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (terms.length === 0) {
    return null;
  }
  return terms
    .map((term, index) => (index === terms.length - 1 ? `${term}:*` : term))
    .join(' & ');
}
