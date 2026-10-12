import { BadRequestException } from '@nestjs/common';
import {
  decodeCampaignCursor,
  encodeCampaignCursor,
} from './campaign-cursor.js';

const id = '11111111-1111-4111-8111-111111111111';
const raw = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('campaign cursor', () => {
  it('round-trips', () => {
    const cursor = { orderDeadline: '2026-10-16T10:00:00.000Z', id };
    expect(decodeCampaignCursor(encodeCampaignCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['garbage', '!!!'],
    ['non-JSON', Buffer.from('not json').toString('base64url')],
    ['a non-UUID id', raw({ orderDeadline: '2026-10-16T10:00:00.000Z', id: 'x' })],
    ['a non-ISO timestamp', raw({ orderDeadline: 'tomorrow', id })],
  ])('rejects %s', (_name, value) => {
    expect(() => decodeCampaignCursor(value)).toThrow(BadRequestException);
  });
});
