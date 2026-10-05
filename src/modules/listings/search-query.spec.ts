import { BadRequestException } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type ListingCursor,
} from './listing-cursor.js';
import { toTsQuery } from './search-query.js';

describe('toTsQuery', () => {
  it.each([
    ['loa', 'loa:*'],
    ['Hoa quả', 'hoa & qua:*'],
    ['  cam   sành  ', 'cam & sanh:*'],
    ["loa & | ! ( ) : * '", 'loa:*'],
    ['JBL-Go 3', 'jbl & go & 3:*'],
    ["loa' OR 1=1 --", 'loa & or & 1 & 1:*'],
  ])('%j -> %j', (input, expected) => {
    expect(toTsQuery(input)).toBe(expected);
  });

  it.each(['', '   ', '!!!', '& | :*'])('%j has no terms', (input) => {
    expect(toTsQuery(input)).toBeNull();
  });
});

describe('listing cursor', () => {
  const recent: ListingCursor = {
    kind: 'recent',
    publishedAt: '2026-10-05T03:00:00.000Z',
    id: '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b',
  };

  it('round-trips both kinds', () => {
    expect(decodeCursor(encodeCursor(recent))).toEqual(recent);
    expect(decodeCursor(encodeCursor({ kind: 'ranked', offset: 24 }))).toEqual({
      kind: 'ranked',
      offset: 24,
    });
  });

  it('drops unknown properties', () => {
    const raw = Buffer.from(
      JSON.stringify({ kind: 'ranked', offset: 24, sql: 'DROP' }),
    ).toString('base64url');

    expect(decodeCursor(raw)).toEqual({ kind: 'ranked', offset: 24 });
  });

  it.each([
    ['garbage', 'not-base64-json'],
    ['a JSON string', Buffer.from('"x"').toString('base64url')],
    ['null', Buffer.from('null').toString('base64url')],
    ['an unknown kind', encodeCursor({ kind: 'other' } as never)],
    ['a negative offset', encodeCursor({ kind: 'ranked', offset: -1 })],
    ['a zero offset', encodeCursor({ kind: 'ranked', offset: 0 })],
    ['a fractional offset', encodeCursor({ kind: 'ranked', offset: 1.5 })],
    ['a huge offset', encodeCursor({ kind: 'ranked', offset: 10_001 })],
    ['a non-ISO date', encodeCursor({ ...recent, publishedAt: 'yesterday' })],
    [
      'a non-canonical date',
      encodeCursor({ ...recent, publishedAt: '2026-10-05' }),
    ],
    ['a non-uuid id', encodeCursor({ ...recent, id: "x' OR 1=1" })],
  ])('rejects %s', (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(BadRequestException);
  });
});
