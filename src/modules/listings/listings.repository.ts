import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';
import type { Tx } from '../../database/transaction.js';
import { ListingCombo } from './listing-combo.entity.js';
import type { ListingCursor } from './listing-cursor.js';
import { Listing } from './listing.entity.js';
import {
  ListingSort,
  type ListingCondition,
  type ListingMode,
  type ListingStatus,
} from './listings.constants.js';

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
  condition: ListingCondition | null;
  conditionPercent: number | null;
  unit: string;
  unitPrice: number;
  stockQuantity: string | null;
  publishedAt: Date | null;
  closedAt: Date | null;
  /** The listing this one was reopened from, if any. */
  reopenedFromId?: string | null;
}

export interface ComboFields {
  quantity: string;
  price: number;
}

export interface OpenListingSearch {
  /** A value produced by toTsQuery, or null to browse newest first. */
  tsQuery: string | null;
  categoryId: number | null;
  mode: ListingMode | null;
  sort: ListingSort;
  sellerId: string | null;
  /** Bounds on the unit price, integer VND. */
  minPrice: number | null;
  maxPrice: number | null;
  /** Keep only listings whose condition is at least this percentage. */
  minConditionPercent: number | null;
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
  category_name_en: string;
  category_is_perishable: boolean;
  condition: ListingCondition | null;
  condition_percent: number | null;
  unit: string;
  unit_price: number;
  /** Null for a pre-order. */
  stock_quantity: string | null;
  has_combos: boolean;
  seller_id: string;
  seller_name: string;
  seller_email: string;
  seller_avatar_url: string | null;
  image_key: string | null;
  order_count: number;
}

const RELATIONS = {
  seller: true,
  category: true,
  combos: true,
  images: true,
};

@Injectable()
export class ListingsRepository {
  constructor(
    @InjectRepository(Listing)
    private readonly repository: Repository<Listing>,
  ) {}

  findByIdWithRelations(id: string): Promise<Listing | null> {
    return this.repository.findOne({
      where: { id },
      relations: RELATIONS,
      order: { images: { sortOrder: 'ASC' } },
    });
  }

  /** Listings by id with seller, combos and photos, for the cart. */
  findByIds(ids: string[]): Promise<Listing[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.repository.find({
      where: ids.map((id) => ({ id })),
      relations: RELATIONS,
      order: { images: { sortOrder: 'ASC' } },
    });
  }

  findBySeller(sellerId: string, status?: ListingStatus): Promise<Listing[]> {
    return this.repository.find({
      where: { sellerId, ...(status ? { status } : {}) },
      relations: RELATIONS,
      order: { createdAt: 'DESC', images: { sortOrder: 'ASC' } },
    });
  }

  /** Inserts the listing and its combos in one transaction; returns the id. */
  insert(fields: ListingFields, combos: ComboFields[]): Promise<string> {
    return this.repository.manager.transaction(async (manager) => {
      const result = await manager.insert(Listing, fields);
      const id = result.identifiers[0].id as string;
      await insertCombos(manager, id, combos);
      return id;
    });
  }

  /**
   * Updates scalar columns and, when `combos` is given, replaces the
   * combos, in one transaction.
   */
  async update(
    id: string,
    fields: Partial<ListingFields>,
    combos?: ComboFields[],
  ): Promise<void> {
    await this.repository.manager.transaction(async (manager) => {
      await manager.update(Listing, { id }, fields);
      if (combos) {
        await manager.delete(ListingCombo, { listingId: id });
        await insertCombos(manager, id, combos);
      }
    });
  }

  /**
   * Open listings for the browse page. Returns up to `limit` rows; ask for
   * one more than a page to learn whether another page exists. The first
   * image comes from a lateral subquery, so the list costs one query
   * regardless of its length. Every value is a bound parameter.
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
    if (search.mode === 'in_stock') {
      // "In stock" means something can still be bought.
      where.push('l.stock_quantity > 0');
    }

    if (search.sellerId !== null) {
      where.push(`l.seller_id = ${bind(search.sellerId)}::uuid`);
    }
    if (search.minPrice !== null) {
      where.push(`l.unit_price >= ${bind(search.minPrice)}`);
    }
    if (search.maxPrice !== null) {
      where.push(`l.unit_price <= ${bind(search.maxPrice)}`);
    }
    if (search.minConditionPercent !== null) {
      where.push(`l.condition_percent >= ${bind(search.minConditionPercent)}`);
    }

    let orderBy = ['l.published_at DESC', 'l.id DESC'];
    let offset = '';
    if (search.sort === ListingSort.Deadline) {
      // The open condition above already requires a future deadline for
      // these rows; the predicate is repeated so the planner can use the
      // partial index IDX_listings_open_deadline.
      where.push('l.order_deadline > $1');
      where.push(`l.mode = 'preorder'`);
      orderBy = ['l.order_deadline ASC', 'l.id ASC'];
      if (search.cursor?.kind === 'deadline') {
        where.push(
          `(l.order_deadline, l.id) > (${bind(search.cursor.orderDeadline)}::timestamptz, ${bind(search.cursor.id)}::uuid)`,
        );
      }
    } else if (search.tsQuery !== null) {
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
        c.name_en AS category_name_en, c.is_perishable AS category_is_perishable,
        l.condition, l.condition_percent,
        l.unit, l.unit_price, l.stock_quantity,
        EXISTS (SELECT 1 FROM listing_combos lc WHERE lc.listing_id = l.id) AS has_combos,
        u.id AS seller_id, u.name AS seller_name, u.email AS seller_email,
        u.avatar_url AS seller_avatar_url,
        image.storage_key AS image_key,
        (SELECT COUNT(DISTINCT o.id)::int FROM order_lines ol
           JOIN orders o ON o.id = ol.order_id
          WHERE ol.listing_id = l.id AND o.fulfillment_status <> 'cancelled') AS order_count
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.seller_id
      LEFT JOIN LATERAL (
        SELECT storage_key FROM listing_images
        WHERE listing_id = l.id ORDER BY sort_order LIMIT 1
      ) image ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy.join(', ')}
      LIMIT ${bind(search.limit)} ${offset}
      `,
      params,
    );
  }

  /**
   * Takes the quantities out of stock inside the caller's transaction.
   * Returns the products that did not have enough (empty when all
   * succeeded); the caller must then roll back.
   *
   * Each UPDATE checks and decrements in one statement, so two buyers can
   * never both get the last unit. Rows are locked in id order so that two
   * orders containing the same products cannot deadlock. Pre-orders have no
   * stock (NULL) and stay NULL.
   */
  async reserveStock(
    tx: Tx,
    lines: ReadonlyArray<StockLine>,
  ): Promise<StockShortage[]> {
    const short: StockShortage[] = [];
    for (const line of sortedByListing(lines)) {
      const updated: unknown[] = await tx.query(
        `UPDATE listings
            SET stock_quantity = stock_quantity - $2::numeric
          WHERE id = $1
            AND (stock_quantity IS NULL OR stock_quantity >= $2::numeric)
          RETURNING id`,
        [line.listingId, line.quantity],
      );
      // node-postgres returns [rows, rowCount] for UPDATE ... RETURNING.
      const rows = Array.isArray(updated[0]) ? updated[0] : updated;
      if (rows.length === 0) {
        const current: Array<{ stock_quantity: string | null }> =
          await tx.query(`SELECT stock_quantity FROM listings WHERE id = $1`, [
            line.listingId,
          ]);
        short.push({
          listingId: line.listingId,
          available: current[0]?.stock_quantity ?? '0',
        });
      }
    }
    return short;
  }

  /** Puts quantities back, for a cancelled order. Pre-orders stay NULL. */
  async releaseStock(tx: Tx, lines: ReadonlyArray<StockLine>): Promise<void> {
    for (const line of sortedByListing(lines)) {
      await tx.query(
        `UPDATE listings
            SET stock_quantity = stock_quantity + $2::numeric
          WHERE id = $1`,
        [line.listingId, line.quantity],
      );
    }
  }
}

export interface StockLine {
  listingId: string;
  /** Decimal string with up to 3 fraction digits. */
  quantity: string;
}

export interface StockShortage {
  listingId: string;
  /** What is left, as a decimal string. */
  available: string;
}

async function insertCombos(
  manager: EntityManager,
  listingId: string,
  combos: ComboFields[],
): Promise<void> {
  if (combos.length > 0) {
    await manager.insert(
      ListingCombo,
      combos.map((combo) => ({ ...combo, listingId })),
    );
  }
}

function sortedByListing(lines: ReadonlyArray<StockLine>): StockLine[] {
  return [...lines].sort((a, b) => a.listingId.localeCompare(b.listingId));
}
