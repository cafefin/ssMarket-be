import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { TransactionRunner } from '../src/database/transaction.js';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { ListingsService } from '../src/modules/listings/listings.service.js';
import { signIn } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { inStockBody, preorderBody } from './utils/market.js';

describe('Stock reservation', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let listings: ListingsService;
  let transactions: TransactionRunner;
  let speaker: string;
  let cable: string;
  let unlimited: string;

  const stockOf = async (listingId: string): Promise<string | null> => {
    const rows: Array<{ stock_quantity: string | null }> =
      await dataSource.query(
        'SELECT stock_quantity FROM listings WHERE id = $1',
        [listingId],
      );
    return rows[0].stock_quantity;
  };

  /** Reserves in its own transaction; rolls back and reports on a shortage. */
  const reserve = (lines: Array<{ listingId: string; quantity: string }>) =>
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
    const create = async (body: object) =>
      (
        (await seller.post('/listings').send(body).expect(201)).body as {
          id: string;
        }
      ).id;
    speaker = await create(inStockBody({ acceptsPrepaidQr: false }));
    cable = await create(
      inStockBody({
        title: 'Dây sạc USB-C',
        acceptsPrepaidQr: false,
        unitPrice: 20000,
        stockQuantity: '5',
      }),
    );
    unlimited = await create(preorderBody({ acceptsPrepaidQr: false }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('takes the quantity out of stock', async () => {
    await expect(
      reserve([{ listingId: speaker, quantity: '2' }]),
    ).resolves.toBe('reserved');

    expect(await stockOf(speaker)).toBe('1.000');
  });

  it('refuses more than is available and reports what is left', async () => {
    await expect(
      reserve([{ listingId: speaker, quantity: '4' }]),
    ).resolves.toEqual([{ listingId: speaker, available: '3.000' }]);

    expect(await stockOf(speaker)).toBe('3.000');
  });

  it('undoes the whole order when one line cannot be reserved', async () => {
    const result = await reserve([
      { listingId: cable, quantity: '5' },
      { listingId: speaker, quantity: '9' },
    ]);

    expect(result).toEqual([{ listingId: speaker, available: '3.000' }]);
    expect(await stockOf(cable)).toBe('5.000');
    expect(await stockOf(speaker)).toBe('3.000');
  });

  it('never limits a pre-order', async () => {
    await expect(
      reserve([{ listingId: unlimited, quantity: '9999' }]),
    ).resolves.toBe('reserved');

    expect(await stockOf(unlimited)).toBeNull();
  });

  it('lets exactly as many concurrent buyers succeed as there are units', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserve([{ listingId: speaker, quantity: '1' }]),
      ),
    );

    expect(results.filter((result) => result === 'reserved')).toHaveLength(3);
    expect(await stockOf(speaker)).toBe('0.000');
  });

  it('does not deadlock when two orders list the same products in opposite order', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        reserve(
          index % 2 === 0
            ? [
                { listingId: speaker, quantity: '1' },
                { listingId: cable, quantity: '1' },
              ]
            : [
                { listingId: cable, quantity: '1' },
                { listingId: speaker, quantity: '1' },
              ],
        ),
      ),
    );

    expect(results.filter((result) => result === 'reserved')).toHaveLength(3);
    expect(await stockOf(speaker)).toBe('0.000');
    expect(await stockOf(cable)).toBe('2.000');
  });

  it('puts stock back on release and leaves pre-orders alone', async () => {
    await reserve([{ listingId: speaker, quantity: '2' }]);

    await transactions.run((tx) =>
      listings.releaseStock(tx, [
        { listingId: speaker, quantity: '2' },
        { listingId: unlimited, quantity: '5' },
      ]),
    );

    expect(await stockOf(speaker)).toBe('3.000');
    expect(await stockOf(unlimited)).toBeNull();
  });
});
