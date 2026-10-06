import { BUSINESS_TIME_ZONE } from '../listings/listings.constants.js';
import type { SalesSummaryDto } from './dto/summary.dto.js';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';
import { UserLocale } from '../users/user.entity.js';

interface CsvLabels {
  headBeforeItems: [string, string, string, string];
  headAfterItems: [string, string, string, string, string, string];
  paymentMethod: Record<PaymentMethod, string>;
  paymentStatus: Record<PaymentStatus, string>;
  fulfillmentStatus: Record<FulfillmentStatus, string>;
  total: string;
  orders: (count: number) => string;
  collected: string;
  outstanding: string;
}

const LABELS: Record<UserLocale, CsvLabels> = {
  [UserLocale.Vi]: {
    headBeforeItems: ['Mã đơn', 'Người mua', 'Email', 'Nơi giao'],
    headAfterItems: [
      'Tổng tiền',
      'Hình thức',
      'Thanh toán',
      'Giao hàng',
      'Ghi chú',
      'Thời điểm đặt',
    ],
    paymentMethod: {
      [PaymentMethod.PrepaidQr]: 'Chuyển khoản QR',
      [PaymentMethod.PayOnDelivery]: 'Trả khi nhận',
    },
    paymentStatus: {
      [PaymentStatus.Unpaid]: 'Chưa thanh toán',
      [PaymentStatus.Reported]: 'Chờ xác nhận',
      [PaymentStatus.Paid]: 'Đã thanh toán',
    },
    fulfillmentStatus: {
      [FulfillmentStatus.Pending]: 'Chờ giao',
      [FulfillmentStatus.Delivered]: 'Đã giao',
      [FulfillmentStatus.Cancelled]: 'Đã hủy',
    },
    total: 'Tổng',
    orders: (count) => `${count} đơn`,
    collected: 'Đã thu',
    outstanding: 'Còn phải thu',
  },
  [UserLocale.En]: {
    headBeforeItems: ['Order code', 'Buyer', 'Email', 'Deliver to'],
    headAfterItems: [
      'Total',
      'Method',
      'Payment',
      'Delivery',
      'Note',
      'Ordered at',
    ],
    paymentMethod: {
      [PaymentMethod.PrepaidQr]: 'QR transfer',
      [PaymentMethod.PayOnDelivery]: 'Pay on delivery',
    },
    paymentStatus: {
      [PaymentStatus.Unpaid]: 'Unpaid',
      [PaymentStatus.Reported]: 'Awaiting confirmation',
      [PaymentStatus.Paid]: 'Paid',
    },
    fulfillmentStatus: {
      [FulfillmentStatus.Pending]: 'Pending',
      [FulfillmentStatus.Delivered]: 'Delivered',
      [FulfillmentStatus.Cancelled]: 'Cancelled',
    },
    total: 'Total',
    orders: (count) => `${count} orders`,
    collected: 'Collected',
    outstanding: 'Outstanding',
  },
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
export function buildSummaryCsv(
  summary: SalesSummaryDto,
  locale: UserLocale = UserLocale.Vi,
): string {
  const labels = LABELS[locale];
  const { items, rows, totals } = summary;
  const lines: (string | number | null)[][] = [];

  lines.push([
    ...labels.headBeforeItems,
    ...items.map((item) => `${item.name} (${item.unit})`),
    ...labels.headAfterItems,
  ]);
  for (const row of rows) {
    lines.push([
      row.code,
      row.buyer.name,
      row.buyer.email,
      row.deliveryLocation,
      ...items.map((item) => row.quantities[item.id] ?? null),
      row.totalAmount,
      labels.paymentMethod[row.paymentMethod],
      labels.paymentStatus[row.paymentStatus],
      labels.fulfillmentStatus[row.fulfillmentStatus],
      row.note,
      localDateTime(row.createdAt),
    ]);
  }

  const blank = items.map(() => null);
  const tail = [null, null, null, null, null];
  lines.push([
    labels.total,
    labels.orders(totals.orderCount),
    null,
    null,
    ...items.map((item) => totals.quantities[item.id] ?? 0),
    totals.totalAmount,
    ...tail,
  ]);
  lines.push([
    labels.collected,
    null,
    null,
    null,
    ...blank,
    totals.paidAmount,
    ...tail,
  ]);
  lines.push([
    labels.outstanding,
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
