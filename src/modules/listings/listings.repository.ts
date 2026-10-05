import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
   * Updates scalar columns and, when `items` is given, replaces the whole
   * item list, in one transaction.
   */
  async update(
    id: string,
    fields: Partial<ListingFields>,
    items?: ListingItemFields[],
  ): Promise<void> {
    await this.repository.manager.transaction(async (manager) => {
      await manager.update(Listing, { id }, fields);
      if (items) {
        await manager.delete(ListingItem, { listingId: id });
        await manager.insert(
          ListingItem,
          items.map((item) => ({ ...item, listingId: id })),
        );
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
        cheapest.unit_price AS min_unit_price, cheapest.unit AS min_price_unit
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.seller_id
      LEFT JOIN LATERAL (
        SELECT storage_key FROM listing_images
        WHERE listing_id = l.id ORDER BY sort_order LIMIT 1
      ) image ON true
      JOIN LATERAL (
        SELECT unit_price, unit FROM listing_items
        WHERE listing_id = l.id ORDER BY unit_price, sort_order LIMIT 1
      ) cheapest ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy.join(', ')}
      LIMIT ${bind(search.limit)} ${offset}
      `,
      params,
    );
  }
}
