import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './listing-cursor.js';

describe('listing cursors', () => {
  const id = '0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11';

  it('round-trips a recent cursor and a ranked cursor', () => {
    const recent = {
      kind: 'recent' as const,
      publishedAt: '2026-10-06T03:05:00.000Z',
      id,
    };
    expect(decodeCursor(encodeCursor(recent))).toEqual(recent);
    expect(decodeCursor(encodeCursor({ kind: 'ranked', offset: 24 }))).toEqual({
      kind: 'ranked',
      offset: 24,
    });
  });

  it('rejects text that is not a cursor', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(BadRequestException);
  });

  it('round-trips a deadline cursor', () => {
    const cursor = {
      kind: 'deadline' as const,
      orderDeadline: '2026-10-09T10:00:00.000Z',
      id,
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    { kind: 'deadline', orderDeadline: 'tomorrow', id },
    { kind: 'deadline', orderDeadline: '2026-10-09T10:00:00.000Z', id: 'x' },
    { kind: 'deadline', id },
  ])('rejects a malformed deadline cursor %j', (value) => {
    const raw = Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(() => decodeCursor(raw)).toThrow(BadRequestException);
  });
});
