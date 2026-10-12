import { BadRequestException } from '@nestjs/common';

/** Campaigns page by keyset on the deadline, soonest first. */
export interface CampaignCursor {
  orderDeadline: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function encodeCampaignCursor(cursor: CampaignCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Throws BadRequestException('Invalid cursor'). */
export function decodeCampaignCursor(raw: string): CampaignCursor {
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
    isIsoTimestamp(candidate.orderDeadline) &&
    typeof candidate.id === 'string' &&
    UUID.test(candidate.id)
  ) {
    return { orderDeadline: candidate.orderDeadline, id: candidate.id };
  }
  throw invalid;
}
