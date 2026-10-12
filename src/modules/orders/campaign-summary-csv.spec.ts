import type {
  CampaignSummaryRowDto,
  CampaignSummaryTableDto,
} from './dto/campaign-summary.dto.js';
import { buildCampaignSummaryCsv } from './campaign-summary-csv.js';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';
import { UserLocale } from '../users/user.entity.js';

const row = (
  overrides: Partial<CampaignSummaryRowDto> = {},
): CampaignSummaryRowDto => ({
  orderId: 'o1',
  code: 'SSM7K2Q9X',
  buyer: { name: 'Anh Minh', email: 'minh@example.com' },
  deliveryLocation: 'Tầng 7',
  quantities: [2, 0, 1],
  totalAmount: 52000,
  paymentMethod: PaymentMethod.PrepaidQr,
  paymentStatus: PaymentStatus.Paid,
  fulfillmentStatus: FulfillmentStatus.Pending,
  note: null,
  // 10:05 in Vietnam
  createdAt: '2026-10-06T03:05:00.000Z',
  ...overrides,
});

const summary = (
  rows: CampaignSummaryRowDto[] = [row()],
  titles: string[] = ['Bánh bao chay', 'Bánh bao thịt', 'Bánh bao trứng'],
): CampaignSummaryTableDto => ({
  campaign: {
    id: 'c1',
    title: 'Bánh bao tuần này',
    orderDeadline: '2026-10-10T03:00:00.000Z',
    deliveryDate: '2026-10-12',
  },
  items: titles.map((title, index) => ({
    listingId: `l${index}`,
    title,
    unit: 'cái',
  })),
  rows,
  itemTotals: [2, 0, 1],
  totals: {
    orderCount: rows.length,
    totalAmount: 52000,
    paidAmount: 52000,
    outstandingAmount: 0,
  },
});

const linesOf = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('buildCampaignSummaryCsv', () => {
  it('starts with a byte-order mark and uses CRLF line endings', () => {
    const csv = buildCampaignSummaryCsv(summary());

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('has one column per product with its unit', () => {
    expect(linesOf(buildCampaignSummaryCsv(summary()))[0]).toBe(
      'Mã đơn,Người mua,Email,Nơi giao,Bánh bao chay (cái),Bánh bao thịt (cái),Bánh bao trứng (cái),Tổng tiền,Hình thức,Thanh toán,Giao hàng,Ghi chú,Thời điểm đặt',
    );
  });

  it('writes an order with bare numbers, Vietnamese labels and local time', () => {
    expect(linesOf(buildCampaignSummaryCsv(summary()))[1]).toBe(
      'SSM7K2Q9X,Anh Minh,minh@example.com,Tầng 7,2,0,1,52000,Chuyển khoản QR,Đã thanh toán,Chờ giao,,2026-10-06 10:05',
    );
  });

  it('ends with the total, collected and outstanding lines of the same width', () => {
    const lines = linesOf(buildCampaignSummaryCsv(summary()));

    expect(lines.slice(-3)).toEqual([
      'Tổng,1 đơn,,,2,0,1,52000,,,,,',
      'Đã thu,,,,,,,52000,,,,,',
      'Còn phải thu,,,,,,,0,,,,,',
    ]);
    expect(new Set(lines.map((line) => line.split(',').length)).size).toBe(1);
  });

  it('writes the English labels for an English seller', () => {
    const lines = linesOf(buildCampaignSummaryCsv(summary(), UserLocale.En));

    expect(lines[0]).toBe(
      'Order code,Buyer,Email,Deliver to,Bánh bao chay (cái),Bánh bao thịt (cái),Bánh bao trứng (cái),Total,Method,Payment,Delivery,Note,Ordered at',
    );
    expect(lines[1]).toContain('QR transfer,Paid,Pending');
    expect(lines.at(-3)).toBe('Total,1 orders,,,2,0,1,52000,,,,,');
    expect(lines.at(-2)).toBe('Collected,,,,,,,52000,,,,,');
    expect(lines.at(-1)).toBe('Outstanding,,,,,,,0,,,,,');
  });

  it('quotes commas and quotes, in titles and in notes', () => {
    const lines = linesOf(
      buildCampaignSummaryCsv(
        summary(
          [row({ note: 'Giao "sớm", cảm ơn', deliveryLocation: 'Tầng 7, A' })],
          ['Bánh, nhân thịt', 'Bánh "đặc biệt"', 'Bánh bao trứng'],
        ),
      ),
    );

    expect(lines[0]).toContain(
      '"Bánh, nhân thịt (cái)","Bánh ""đặc biệt"" (cái)"',
    );
    expect(lines[1]).toContain('"Tầng 7, A"');
    expect(lines[1]).toContain('"Giao ""sớm"", cảm ơn"');
  });

  it.each(['=', '+', '-', '@'])(
    'defuses a note and an item title that start with %s',
    (char) => {
      const lines = linesOf(
        buildCampaignSummaryCsv(
          summary(
            [row({ note: `${char}SUM(A1)` })],
            [`${char}Bánh`, 'Bánh bao thịt', 'Bánh bao trứng'],
          ),
        ),
      );

      expect(lines[0]).toContain(`'${char}Bánh (cái)`);
      expect(lines[1]).toContain(`,'${char}SUM(A1),`);
    },
  );

  it('defuses a buyer name that starts with a formula character', () => {
    const lines = linesOf(
      buildCampaignSummaryCsv(
        summary([row({ buyer: { name: '=cmd', email: '+a@b.c' } })]),
      ),
    );

    expect(lines[1]).toContain(",'=cmd,'+a@b.c,");
  });

  it('writes only the header and totals when nobody ordered', () => {
    const lines = linesOf(buildCampaignSummaryCsv(summary([])));

    expect(lines).toHaveLength(4);
  });
});
