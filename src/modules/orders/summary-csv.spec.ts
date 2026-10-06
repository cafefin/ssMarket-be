import type { SalesSummaryDto, SummaryRowDto } from './dto/summary.dto.js';
import {
  FulfillmentStatus,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';
import { UserLocale } from '../users/user.entity.js';
import { buildSummaryCsv } from './summary-csv.js';

const row = (overrides: Partial<SummaryRowDto> = {}): SummaryRowDto => ({
  orderId: 'o1',
  code: 'SSM7K2Q9X',
  buyer: { name: 'Anh Minh', email: 'minh@example.com' },
  deliveryLocation: 'Tầng 7',
  quantities: { cam: 1.5, buoi: 2 },
  totalAmount: 192500,
  paymentMethod: PaymentMethod.PrepaidQr,
  paymentStatus: PaymentStatus.Paid,
  fulfillmentStatus: FulfillmentStatus.Pending,
  note: null,
  // 10:05 in Vietnam
  createdAt: '2026-10-06T03:05:00.000Z',
  ...overrides,
});

const summary = (rows: SummaryRowDto[] = [row()]): SalesSummaryDto => ({
  listing: {
    id: 'l1',
    title: 'Hoa quả',
    orderDeadline: null,
    deliveryDate: null,
  },
  items: [
    { id: 'cam', name: 'Cam sành', unit: 'kg', isActive: true },
    { id: 'buoi', name: 'Bưởi', unit: 'kg', isActive: true },
  ],
  rows,
  totals: {
    orderCount: rows.length,
    quantities: { cam: 1.5, buoi: 2 },
    totalAmount: 192500,
    paidAmount: 192500,
    outstandingAmount: 0,
  },
});

const linesOf = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('buildSummaryCsv', () => {
  it('starts with a byte-order mark and uses CRLF line endings', () => {
    const csv = buildSummaryCsv(summary());

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('has one column per item between the buyer and the total', () => {
    expect(linesOf(buildSummaryCsv(summary()))[0]).toBe(
      'Mã đơn,Người mua,Email,Nơi giao,Cam sành (kg),Bưởi (kg),Tổng tiền,Hình thức,Thanh toán,Giao hàng,Ghi chú,Thời điểm đặt',
    );
  });

  it('writes an order with bare numbers, Vietnamese labels and local time', () => {
    expect(linesOf(buildSummaryCsv(summary()))[1]).toBe(
      'SSM7K2Q9X,Anh Minh,minh@example.com,Tầng 7,1.5,2,192500,Chuyển khoản QR,Đã thanh toán,Chờ giao,,2026-10-06 10:05',
    );
  });

  it('leaves the cell empty for an item the buyer did not order', () => {
    const csv = buildSummaryCsv(summary([row({ quantities: { buoi: 2 } })]));

    expect(linesOf(csv)[1]).toContain('Tầng 7,,2,192500');
  });

  it('ends with totals, collected and outstanding rows of the same width', () => {
    const lines = linesOf(buildSummaryCsv(summary()));
    const width = lines[0].split(',').length;

    expect(lines.slice(-3)).toEqual([
      'Tổng,1 đơn,,,1.5,2,192500,,,,,',
      'Đã thu,,,,,,192500,,,,,',
      'Còn phải thu,,,,,,0,,,,,',
    ]);
    for (const line of lines.slice(-3)) {
      expect(line.split(',')).toHaveLength(width);
    }
  });

  it('quotes cells that contain commas, quotes or line breaks', () => {
    const csv = buildSummaryCsv(
      summary([
        row({
          deliveryLocation: 'Tầng 7, khu A',
          note: 'Gọi "Minh"\nsau 14h',
        }),
      ]),
    );

    expect(csv).toContain('"Tầng 7, khu A"');
    expect(csv).toContain('"Gọi ""Minh""\nsau 14h"');
  });

  it.each(['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)'])(
    'defuses a note that would run as a formula: %s',
    (note) => {
      const csv = buildSummaryCsv(summary([row({ note })]));

      expect(csv).toContain(`'${note.replace(/"/g, '""')}`);
      expect(csv).not.toMatch(
        new RegExp(`,${note[0] === '+' ? '\\+' : note[0]}`),
      );
    },
  );

  it('also defuses a formula in a name that buyers control', () => {
    const csv = buildSummaryCsv(
      summary([row({ buyer: { name: '=cmd|calc', email: 'a@example.com' } })]),
    );

    expect(linesOf(csv)[1]).toContain(",'=cmd|calc,");
  });

  it('writes only the header and totals when there are no orders', () => {
    const empty = summary([]);
    empty.totals = {
      orderCount: 0,
      quantities: {},
      totalAmount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
    };

    const lines = linesOf(buildSummaryCsv(empty));

    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('Tổng,0 đơn,,,0,0,0,,,,,');
  });

  describe('in English', () => {
    const lines = linesOf(buildSummaryCsv(summary(), UserLocale.En));

    it('translates the header', () => {
      expect(lines[0]).toBe(
        'Order code,Buyer,Email,Deliver to,Cam sành (kg),Bưởi (kg),Total,Method,Payment,Delivery,Note,Ordered at',
      );
    });

    it('translates the status labels and leaves data as it is', () => {
      expect(lines[1]).toBe(
        'SSM7K2Q9X,Anh Minh,minh@example.com,Tầng 7,1.5,2,192500,QR transfer,Paid,Pending,,2026-10-06 10:05',
      );
    });

    it('translates the totals', () => {
      expect(lines.slice(2).map((line) => line.split(',').slice(0, 2))).toEqual(
        [
          ['Total', '1 orders'],
          ['Collected', ''],
          ['Outstanding', ''],
        ],
      );
    });
  });
});
