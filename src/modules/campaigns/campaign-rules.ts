import {
  businessDate,
  isRealDate,
  productProblems,
} from '../listings/listing-rules.js';
import { ListingMode } from '../listings/listings.constants.js';
import type { Combo } from '../listings/pricing.js';

export const CAMPAIGN_LIMITS = {
  titleMin: 5,
  titleMax: 120,
  descriptionMax: 5000,
  itemsMin: 1,
  itemsMax: 50,
  itemTitleMin: 2,
  itemTitleMax: 120,
} as const;

export interface CampaignItemInput {
  /** Set when editing an existing item. */
  id: string | null;
  title: string;
  description: string;
  unit: string;
  /** Integer VND. */
  unitPrice: number;
  combos: Combo[];
  /** False stops selling the item without removing it. */
  selling: boolean;
}

export interface CampaignInput {
  title: string;
  description: string;
  categoryId: number;
  orderDeadline: Date;
  /** YYYY-MM-DD. */
  deliveryDate: string;
  acceptsPrepaidQr: boolean;
  acceptsPayOnDelivery: boolean;
  items: CampaignItemInput[];
}

/** Problems decidable from the input alone; empty when valid. Item problems start with "item N: ". */
export function validateCampaignInput(input: CampaignInput): string[] {
  const problems: string[] = [];
  const title = input.title.trim();
  if (
    title.length < CAMPAIGN_LIMITS.titleMin ||
    title.length > CAMPAIGN_LIMITS.titleMax
  ) {
    problems.push(
      `title must be ${CAMPAIGN_LIMITS.titleMin}-${CAMPAIGN_LIMITS.titleMax} characters`,
    );
  }
  if (input.description.length > CAMPAIGN_LIMITS.descriptionMax) {
    problems.push(
      `description must be at most ${CAMPAIGN_LIMITS.descriptionMax} characters`,
    );
  }
  if (!input.acceptsPrepaidQr && !input.acceptsPayOnDelivery) {
    problems.push('at least one payment method is required');
  }
  if (!isRealDate(input.deliveryDate)) {
    problems.push('delivery date must be a valid date (YYYY-MM-DD)');
  } else if (input.deliveryDate < businessDate(input.orderDeadline)) {
    problems.push('delivery date cannot be before the order deadline');
  }
  if (
    input.items.length < CAMPAIGN_LIMITS.itemsMin ||
    input.items.length > CAMPAIGN_LIMITS.itemsMax
  ) {
    problems.push(
      `a round needs ${CAMPAIGN_LIMITS.itemsMin}-${CAMPAIGN_LIMITS.itemsMax} products`,
    );
  }
  const seen = new Set<string>();
  input.items.forEach((item, index) => {
    const name = `item ${index + 1}`;
    if (item.id !== null) {
      if (seen.has(item.id)) {
        problems.push(`${name}: appears twice`);
      }
      seen.add(item.id);
    }
    const itemTitle = item.title.trim();
    if (
      itemTitle.length < CAMPAIGN_LIMITS.itemTitleMin ||
      itemTitle.length > CAMPAIGN_LIMITS.itemTitleMax
    ) {
      problems.push(
        `${name}: title must be ${CAMPAIGN_LIMITS.itemTitleMin}-${CAMPAIGN_LIMITS.itemTitleMax} characters`,
      );
    }
    if (item.description.length > CAMPAIGN_LIMITS.descriptionMax) {
      problems.push(
        `${name}: description must be at most ${CAMPAIGN_LIMITS.descriptionMax} characters`,
      );
    }
    for (const problem of productProblems({
      mode: ListingMode.Preorder,
      unit: item.unit,
      unitPrice: item.unitPrice,
      stockQuantity: null,
      combos: item.combos,
    })) {
      problems.push(`${name}: ${problem}`);
    }
  });
  return problems;
}
