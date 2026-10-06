import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Tx } from '../../database/transaction.js';
import { ListingItem } from './listing-item.entity.js';
import type { ListingCursor } from './listing-cursor.js';
import { Listing } from './listing.entity.js';
import type { ListingMode, ListingStatus } from './listings.constants.js';

/** The scalar columns a service may write. */
export interface ListingFields {
  sellerId: string;
  categoryId: number;
  title: string;
  description: string;
  mode: ListingMode;
  status: ListingStatus;
  acceptsPrepaidQr: boolean;
  acceptsPayOnDelivery: boolean;
  orderDeadline: Date | null;
  deliveryDate: string | null;
  searchText: string;
  publishedAt: Date | null;
  closedAt: Date | null;
}

export interface ListingItemFields {
  /** Present to update that item in place; absent to insert a new one. */
  id?: string;
  name: string;
  unit: string;
  unitPrice: number;
  stockQuantity: string | null;
  sortOrder: number;
}

export interface OpenListingSearch {
  /** A value produced by toTsQuery, or null to browse newest first. */
  tsQuery: string | null;
  categoryId: number | null;
  mode: ListingMode | null;
  cursor: ListingCursor | null;
  limit: number;
  now: Date;
}

/** One row of the browse/search result, before it becomes a DTO. */
export interface OpenListingRow {
  id: string;
  title: string;
  mode: ListingMode;
  order_deadline: Date | null;
  delivery_date: string | null;
  published_at: Date;
  category_id: number;
  category_slug: string;
  category_name: string;
  seller_id: string;
  seller_name: string;
  seller_avatar_url: string | null;
  image_key: string | null;
  min_unit_price: number;
  min_price_unit: string;
  order_count: number;
}

@Injectable()
export class ListingsRepository {
  constructor(
    @InjectRepository(Listing)
    private readonly repository: Repository<Listing>,
  ) {}

  findByIdWithRelations(id: string): Promise<Listing | null> {
    return this.repository.findOne({
      where: { id },
      relations: { seller: true, category: true, items: true, images: true },
      order: { items: { sortOrder: 'ASC' }, images: { sortOrder: 'ASC' } },
    });
  }

  findBySeller(sellerId: string, status?: ListingStatus): Promise<Listing[]> {
    return this.repository.find({
      where: { sellerId, ...(status ? { status } : {}) },
      relations: { seller: true, category: true, items: true, images: true },
      order: {
        createdAt: 'DESC',
        items: { sortOrder: 'ASC' },
        images: { sortOrder: 'ASC' },
      },
    });
  }

  /** Inserts the listing and its items in one transaction; returns the id. */
  insert(fields: ListingFields, items: ListingItemFields[]): Promise<string> {
    return this.repository.manager.transaction(async (manager) => {
      const result = await manager.insert(Listing, fields);
      const id = result.identifiers[0].id as string;
      await manager.insert(
        ListingItem,
        items.map((item) => ({ ...item, listingId: id })),
      );
      return id;
    });
  }

  /**
   * Updates scalar columns and, when `items` is given, makes the item list
   * match it, in one transaction: items with an id are updated in place (so
   * orders that reference them stay valid), items without an id are
   * inserted, and items left out are deleted, or only deactivated when
   * someone has already ordered them.
   */
  async update(
    id: string,
    fields: Partial<ListingFields>,
    items?: ListingItemFields[],
  ): Promise<void> {
    await this.repository.manager.transaction(async (manager) => {
      await manager.update(Listing, { id }, fields);
      if (!items) {
        return;
      }

      const kept = new Set(items.flatMap((item) => (item.id ? [item.id] : [])));
      const existing = await manager.find(ListingItem, {
        where: { listingId: id },
      });
      for (const item of existing.filter(
        (candidate) => !kept.has(candidate.id),
      )) {
        const ordered: unknown[] = await manager.query(
          `SELECT 1 FROM order_lines WHERE listing_item_id = $1 LIMIT 1`,
          [item.id],
        );
        if (ordered.length > 0) {
          await manager.update(
            ListingItem,
            { id: item.id },
            { isActive: false },
          );
        } else {
          await manager.delete(ListingItem, { id: item.id });
        }
      }

      for (const item of items) {
        if (item.id) {
          const { id: itemId, ...values } = item;
          await manager.update(
            ListingItem,
            { id: itemId, listingId: id },
            { ...values, isActive: true },
          );
        } else {
          await manager.insert(ListingItem, { ...item, listingId: id });
        }
      }
    });
  }

  /**
   * Open listings for the browse page. Returns up to `limit` rows; ask for
   * one more than a page to learn whether another page exists. The first
   * image and the cheapest item come from lateral subqueries, so the list
   * costs one query regardless of its length. Every value is a bound
   * parameter.
   */
  searchOpen(search: OpenListingSearch): Promise<OpenListingRow[]> {
    const params: unknown[] = [search.now];
    const bind = (value: unknown): string => `$${params.push(value)}`;

    const where = [
      `l.status = 'open'`,
      `(l.order_deadline IS NULL OR l.order_deadline > $1)`,
    ];
    if (search.categoryId !== null) {
      where.push(`l.category_id = ${bind(search.categoryId)}`);
    }
    if (search.mode !== null) {
      where.push(`l.mode = ${bind(search.mode)}::listings_mode_enum`);
    }

    const orderBy = ['l.published_at DESC', 'l.id DESC'];
    let offset = '';
    if (search.tsQuery !== null) {
      const tsQuery = `to_tsquery('simple', ${bind(search.tsQuery)})`;
      where.push(`l.search_vector @@ ${tsQuery}`);
      orderBy.unshift(`ts_rank(l.search_vector, ${tsQuery}) DESC`);
      if (search.cursor?.kind === 'ranked') {
        offset = `OFFSET ${bind(search.cursor.offset)}`;
      }
    } else if (search.cursor?.kind === 'recent') {
      where.push(
        `(l.published_at, l.id) < (${bind(search.cursor.publishedAt)}::timestamptz, ${bind(search.cursor.id)}::uuid)`,
      );
    }

    return this.repository.query(
      `
      SELECT
        l.id, l.title, l.mode, l.order_deadline,
        to_char(l.delivery_date, 'YYYY-MM-DD') AS delivery_date,
        l.published_at,
        c.id AS category_id, c.slug AS category_slug, c.name AS category_name,
        u.id AS seller_id, u.name AS seller_name, u.avatar_url AS seller_avatar_url,
        image.storage_key AS image_key,
        cheapest.unit_price AS min_unit_price, cheapest.unit AS min_price_unit,
        (SELECT COUNT(*)::int FROM orders o
          WHERE o.listing_id = l.id AND o.fulfillment_status <> 'cancelled') AS order_count
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.seller_id
      LEFT JOIN LATERAL (
        SELECT storage_key FROM listing_images
        WHERE listing_id = l.id ORDER BY sort_order LIMIT 1
      ) image ON true
      JOIN LATERAL (
        SELECT unit_price, unit FROM listing_items
        WHERE listing_id = l.id AND is_active ORDER BY unit_price, sort_order LIMIT 1
      ) cheapest ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy.join(', ')}
      LIMIT ${bind(search.limit)} ${offset}
      `,
      params,
    );
  }

  /**
   * Takes the quantities out of stock inside the caller's transaction.
   * Returns the items that did not have enough (empty when all succeeded);
   * the caller must then roll back.
   *
   * Each UPDATE checks and decrements in one statement, so two buyers can
   * never both get the last unit. Rows are locked in id order so that two
   * orders containing the same items cannot deadlock. For unlimited items
   * the stock is NULL and stays NULL.
   */
  async reserveStock(
    tx: Tx,
    lines: ReadonlyArray<StockLine>,
  ): Promise<StockShortage[]> {
    const short: StockShortage[] = [];
    for (const line of sortedByItem(lines)) {
      const updated: unknown[] = await tx.query(
        `UPDATE listing_items
            SET stock_quantity = stock_quantity - $2::numeric
          WHERE id = $1
            AND is_active
            AND (stock_quantity IS NULL OR stock_quantity >= $2::numeric)
          RETURNING id`,
        [line.itemId, line.quantity],
      );
      // node-postgres returns [rows, rowCount] for UPDATE ... RETURNING.
      const rows = Array.isArray(updated[0]) ? updated[0] : updated;
      if (rows.length === 0) {
        const current: Array<{ stock_quantity: string | null }> =
          await tx.query(
            `SELECT stock_quantity FROM listing_items WHERE id = $1`,
            [line.itemId],
          );
        short.push({
          itemId: line.itemId,
          available: current[0]?.stock_quantity ?? '0',
        });
      }
    }
    return short;
  }

  /** Puts quantities back, for a cancelled order. Unlimited items stay NULL. */
  async releaseStock(tx: Tx, lines: ReadonlyArray<StockLine>): Promise<void> {
    for (const line of sortedByItem(lines)) {
      await tx.query(
        `UPDATE listing_items
            SET stock_quantity = stock_quantity + $2::numeric
          WHERE id = $1`,
        [line.itemId, line.quantity],
      );
    }
  }
}

export interface StockLine {
  itemId: string;
  /** Decimal string with up to 3 fraction digits. */
  quantity: string;
}

export interface StockShortage {
  itemId: string;
  /** What is left, as a decimal string. */
  available: string;
}

function sortedByItem(lines: ReadonlyArray<StockLine>): StockLine[] {
  return [...lines].sort((a, b) => a.itemId.localeCompare(b.itemId));
}
