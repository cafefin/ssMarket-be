import { BUSINESS_TIME_ZONE } from '../listings/listings.constants.js';
import type { SalesSummaryDto } from './dto/summary.dto.js';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';

const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  [PaymentMethod.PrepaidQr]: 'Chuyển khoản QR',
  [PaymentMethod.PayOnDelivery]: 'Trả khi nhận',
};
const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  [PaymentStatus.Unpaid]: 'Chưa thanh toán',
  [PaymentStatus.Reported]: 'Chờ xác nhận',
  [PaymentStatus.Paid]: 'Đã thanh toán',
};
const FULFILLMENT_STATUS: Record<FulfillmentStatus, string> = {
  [FulfillmentStatus.Pending]: 'Chờ giao',
  [FulfillmentStatus.Delivered]: 'Đã giao',
  [FulfillmentStatus.Cancelled]: 'Đã hủy',
};

/**
 * One CSV cell. Text that starts with = + - or @ would be run as a formula
 * by Excel, and buyers control some of this text (notes, names), so such
 * cells get a leading apostrophe. Numbers are passed as numbers and are
 * written bare so the spreadsheet can add them up.
 */
function cell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function localDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * The seller summary as a CSV file that Excel opens directly: UTF-8 with a
 * byte-order mark (so Vietnamese shows correctly) and CRLF line endings.
 */
export function buildSummaryCsv(summary: SalesSummaryDto): string {
  const { items, rows, totals } = summary;
  const lines: (string | number | null)[][] = [];

  lines.push([
    'Mã đơn',
    'Người mua',
    'Email',
    'Nơi giao',
    ...items.map((item) => `${item.name} (${item.unit})`),
    'Tổng tiền',
    'Hình thức',
    'Thanh toán',
    'Giao hàng',
    'Ghi chú',
    'Thời điểm đặt',
  ]);
  for (const row of rows) {
    lines.push([
      row.code,
      row.buyer.name,
      row.buyer.email,
      row.deliveryLocation,
      ...items.map((item) => row.quantities[item.id] ?? null),
      row.totalAmount,
      PAYMENT_METHOD[row.paymentMethod],
      PAYMENT_STATUS[row.paymentStatus],
      FULFILLMENT_STATUS[row.fulfillmentStatus],
      row.note,
      localDateTime(row.createdAt),
    ]);
  }

  const blank = items.map(() => null);
  const tail = [null, null, null, null, null];
  lines.push([
    'Tổng',
    `${totals.orderCount} đơn`,
    null,
    null,
    ...items.map((item) => totals.quantities[item.id] ?? 0),
    totals.totalAmount,
    ...tail,
  ]);
  lines.push([
    'Đã thu',
    null,
    null,
    null,
    ...blank,
    totals.paidAmount,
    ...tail,
  ]);
  lines.push([
    'Còn phải thu',
    null,
    null,
    null,
    ...blank,
    totals.outstandingAmount,
    ...tail,
  ]);

  return (
    '﻿' + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}
