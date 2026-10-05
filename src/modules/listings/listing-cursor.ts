import { BadRequestException } from '@nestjs/common';

/**
 * Newest-first browsing pages by keyset (stable while listings are added).
 * Ranked search results have no stable key, so they page by offset.
 */
export type ListingCursor =
  | { kind: 'recent'; publishedAt: string; id: string }
  | { kind: 'ranked'; offset: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: ListingCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): ListingCursor {
  const invalid = new BadRequestException('Invalid cursor');
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  if (typeof value !== 'object' || value === null) {
    throw invalid;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind === 'recent' &&
    typeof candidate.publishedAt === 'string' &&
    typeof candidate.id === 'string' &&
    UUID.test(candidate.id) &&
    !Number.isNaN(Date.parse(candidate.publishedAt)) &&
    new Date(candidate.publishedAt).toISOString() === candidate.publishedAt
  ) {
    return {
      kind: 'recent',
      publishedAt: candidate.publishedAt,
      id: candidate.id,
    };
  }
  if (
    candidate.kind === 'ranked' &&
    typeof candidate.offset === 'number' &&
    Number.isInteger(candidate.offset) &&
    candidate.offset > 0 &&
    candidate.offset <= 10_000
  ) {
    return { kind: 'ranked', offset: candidate.offset };
  }
  throw invalid;
}
