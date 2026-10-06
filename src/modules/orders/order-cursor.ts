import { BadRequestException } from '@nestjs/common';

export interface OrderCursor {
  createdAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeOrderCursor(cursor: OrderCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeOrderCursor(raw: string): OrderCursor {
  const invalid = new BadRequestException('Invalid cursor');
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  const candidate = (value ?? {}) as Record<string, unknown>;
  if (
    typeof candidate.createdAt === 'string' &&
    typeof candidate.id === 'string' &&
    UUID.test(candidate.id) &&
    !Number.isNaN(Date.parse(candidate.createdAt)) &&
    new Date(candidate.createdAt).toISOString() === candidate.createdAt
  ) {
    return { createdAt: candidate.createdAt, id: candidate.id };
  }
  throw invalid;
}
