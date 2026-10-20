import { BadRequestException } from '@nestjs/common';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from './created-at-cursor.js';

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('created-at cursor', () => {
  const cursor = {
    createdAt: '2026-05-01T10:00:00.000Z',
    id: '0b0f3d0e-5a54-4c0e-8b8e-1d2f3a4b5c6d',
  };

  it('round trips', () => {
    expect(decodeCreatedAtCursor(encodeCreatedAtCursor(cursor))).toEqual(
      cursor,
    );
  });

  it.each([
    ['garbage', '!!!'],
    ['non-JSON', Buffer.from('not json').toString('base64url')],
    ['a non-UUID id', b64({ ...cursor, id: 'abc' })],
    [
      'a non-canonical timestamp',
      b64({ ...cursor, createdAt: '2026-05-01 10:00:00' }),
    ],
  ])('rejects %s', (_name, raw) => {
    expect(() => decodeCreatedAtCursor(raw)).toThrow(BadRequestException);
  });
});
