import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { TransactionRunner } from '../src/database/transaction.js';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { ListingsService } from '../src/modules/listings/listings.service.js';
import { signIn } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

describe('Stock reservation', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let listings: ListingsService;
  let transactions: TransactionRunner;
  let speaker: string;
  let cable: string;
  let unlimited: string;

  const stockOf = async (itemId: string): Promise<string | null> => {
    const rows: Array<{ stock_quantity: string | null }> =
      await dataSource.query(
        'SELECT stock_quantity FROM listing_items WHERE id = $1',
        [itemId],
      );
    return rows[0].stock_quantity;
  };

  /** Reserves in its own transaction; rolls back and reports on a shortage. */
  const reserve = (lines: Array<{ itemId: string; quantity: string }>) =>
    transactions
      .run(async (tx) => {
        const short = await listings.reserveStock(tx, lines);
        if (short.length > 0) {
          throw Object.assign(new Error('short'), { short });
        }
        return 'reserved' as const;
      })
      .catch((error: { short?: unknown }) => {
        if (error.short) {
          return error.short;
        }
        throw error;
      });

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    listings = app.get(ListingsService);
    transactions = app.get(TransactionRunner);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    const seller = await signIn(app, identity, 'seller');
    const inStock = await seller
      .post('/listings')
      .send({
        mode: 'in_stock',
        condition: 'good',
        title: 'Loa và phụ kiện',
        categoryId: 4,
        acceptsPrepaidQr: false,
        acceptsPayOnDelivery: true,
        items: [
          { name: 'Loa', unit: 'cái', unitPrice: 500000, stockQuantity: '3' },
          {
            name: 'Dây sạc',
            unit: 'cái',
            unitPrice: 20000,
            stockQuantity: '5',
          },
        ],
      })
      .expect(201);
    const preorder = await seller
      .post('/listings')
      .send({
        mode: 'preorder',
        title: 'Hoa quả tuần này',
        categoryId: 2,
        acceptsPrepaidQr: false,
        acceptsPayOnDelivery: true,
        orderDeadline: new Date(Date.now() + 86_400_000).toISOString(),
        deliveryDate: new Date(Date.now() + 2 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        items: [{ name: 'Cam', unit: 'kg', unitPrice: 35000 }],
      })
      .expect(201);
    const items = (
      inStock.body as { items: Array<{ id: string; name: string }> }
    ).items;
    speaker = items.find((item) => item.name === 'Loa')!.id;
    cable = items.find((item) => item.name === 'Dây sạc')!.id;
    unlimited = (preorder.body as { items: Array<{ id: string }> }).items[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('takes the quantity out of stock', async () => {
    await expect(reserve([{ itemId: speaker, quantity: '2' }])).resolves.toBe(
      'reserved',
    );

    expect(await stockOf(speaker)).toBe('1.000');
  });

  it('refuses more than is available and reports what is left', async () => {
    await expect(
      reserve([{ itemId: speaker, quantity: '4' }]),
    ).resolves.toEqual([{ itemId: speaker, available: '3.000' }]);

    expect(await stockOf(speaker)).toBe('3.000');
  });

  it('undoes the whole order when one line cannot be reserved', async () => {
    const result = await reserve([
      { itemId: cable, quantity: '5' },
      { itemId: speaker, quantity: '9' },
    ]);

    expect(result).toEqual([{ itemId: speaker, available: '3.000' }]);
    expect(await stockOf(cable)).toBe('5.000');
    expect(await stockOf(speaker)).toBe('3.000');
  });

  it('never limits an item without stock tracking', async () => {
    await expect(
      reserve([{ itemId: unlimited, quantity: '9999' }]),
    ).resolves.toBe('reserved');

    expect(await stockOf(unlimited)).toBeNull();
  });

  it('lets exactly as many concurrent buyers succeed as there are units', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserve([{ itemId: speaker, quantity: '1' }]),
      ),
    );

    expect(results.filter((result) => result === 'reserved')).toHaveLength(3);
    expect(await stockOf(speaker)).toBe('0.000');
  });

  it('does not deadlock when two orders list the same items in opposite order', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        reserve(
          index % 2 === 0
            ? [
                { itemId: speaker, quantity: '1' },
                { itemId: cable, quantity: '1' },
              ]
            : [
                { itemId: cable, quantity: '1' },
                { itemId: speaker, quantity: '1' },
              ],
        ),
      ),
    );

    expect(results.filter((result) => result === 'reserved')).toHaveLength(3);
    expect(await stockOf(speaker)).toBe('0.000');
    expect(await stockOf(cable)).toBe('2.000');
  });

  it('puts stock back on release and leaves unlimited items alone', async () => {
    await reserve([{ itemId: speaker, quantity: '2' }]);

    await transactions.run((tx) =>
      listings.releaseStock(tx, [
        { itemId: speaker, quantity: '2' },
        { itemId: unlimited, quantity: '5' },
      ]),
    );

    expect(await stockOf(speaker)).toBe('3.000');
    expect(await stockOf(unlimited)).toBeNull();
  });
});
