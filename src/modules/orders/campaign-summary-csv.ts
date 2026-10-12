import { UserLocale } from '../users/user.entity.js';
import type { CampaignSummaryTableDto } from './dto/campaign-summary.dto.js';
import { cell, LABELS, localDateTime } from './summary-csv.js';

/**
 * The round summary as a CSV file that Excel opens directly: UTF-8 with a
 * byte-order mark and CRLF line endings, one quantity column per product.
 * Every cell goes through `cell`, which defuses formulas.
 */
export function buildCampaignSummaryCsv(
  summary: CampaignSummaryTableDto,
  locale: UserLocale = UserLocale.Vi,
): string {
  const labels = LABELS[locale];
  const { items, rows, itemTotals, totals } = summary;
  const lines: (string | number | null)[][] = [];

  lines.push([
    ...labels.headBeforeQuantity,
    ...items.map((item) => `${item.title} (${item.unit})`),
    ...labels.headAfterQuantity,
  ]);
  for (const row of rows) {
    lines.push([
      row.code,
      row.buyer.name,
      row.buyer.email,
      row.deliveryLocation,
      ...row.quantities,
      row.totalAmount,
      labels.paymentMethod[row.paymentMethod],
      labels.paymentStatus[row.paymentStatus],
      labels.fulfillmentStatus[row.fulfillmentStatus],
      row.note,
      localDateTime(row.createdAt),
    ]);
  }

  const tail = [null, null, null, null, null];
  const gap = items.map(() => null);
  lines.push([
    labels.total,
    labels.orders(totals.orderCount),
    null,
    null,
    ...itemTotals,
    totals.totalAmount,
    ...tail,
  ]);
  lines.push([
    labels.collected,
    null,
    null,
    null,
    ...gap,
    totals.paidAmount,
    ...tail,
  ]);
  lines.push([
    labels.outstanding,
    null,
    null,
    null,
    ...gap,
    totals.outstandingAmount,
    ...tail,
  ]);

  return (
    '﻿' + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}
