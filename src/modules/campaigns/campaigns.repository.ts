import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ListingCombo } from '../listings/listing-combo.entity.js';
import { Listing } from '../listings/listing.entity.js';
import { ListingMode, ListingStatus } from '../listings/listings.constants.js';
import type { ComboFields } from '../listings/listings.repository.js';
import { buildSearchText } from '../listings/search-text.js';
import { Campaign, CampaignStatus } from './campaign.entity.js';

// The products of a round are rows of `listings`. This repository is the
// only writer of those rows (ListingsRepository writes in-stock listings
// only), so that a product can never drift from the terms of its round.

/** The scalar columns a service may write. */
export interface CampaignFields {
  sellerId: string;
  categoryId: number;
  title: string;
  description: string;
  orderDeadline: Date;
  /** YYYY-MM-DD. */
  deliveryDate: string;
  acceptsPrepaidQr: boolean;
  acceptsPayOnDelivery: boolean;
  status: CampaignStatus;
  searchText: string;
  publishedAt: Date | null;
  closedAt: Date | null;
  reopenedFromId?: string | null;
}

export interface ItemWrite {
  /** Null inserts a new item. */
  id: string | null;
  title: string;
  description: string;
  unit: string;
  unitPrice: number;
  combos: ComboFields[];
  status: ListingStatus;
  sortOrder: number;
  /**
   * Set on insert. On an existing item it only fills a missing value (an
   * item that was not on sale when its round was published), never replaces
   * one.
   */
  publishedAt: Date | null;
}

/** One row of the seller's list of rounds. */
export interface CampaignMineRow {
  id: string;
  title: string;
  status: CampaignStatus;
  order_deadline: Date;
  delivery_date: string;
  created_at: Date;
  item_count: number;
  /** Orders that are not cancelled. */
  order_count: number;
}

/** Thrown when items to delete are referenced by order lines. */
export class CampaignItemsInUseError extends Error {
  constructor(readonly items: { listingId: string; title: string }[]) {
    super('Campaign items in use');
  }
}

/**
 * Thrown when the round is no longer in the state a write was based on
 * (another request published, closed or deleted it first).
 */
export class CampaignStateChangedError extends Error {
  constructor(readonly missing: boolean) {
    super(missing ? 'Campaign not found' : 'Campaign state changed');
  }
}

const FOREIGN_KEY_VIOLATION = '23503';
const ORDER_LINE_LISTING_FK = 'FK_order_lines_listing';

@Injectable()
export class CampaignsRepository {
  constructor(
    @InjectRepository(Campaign)
    private readonly repository: Repository<Campaign>,
  ) {}

  /** A campaign with seller, category and items (with combos and images) in display order. */
  findById(id: string): Promise<Campaign | null> {
    return this.repository.findOne({
      where: { id },
      relations: {
        seller: true,
        category: true,
        items: { combos: true, images: true },
      },
      order: { items: { sortOrder: 'ASC', images: { sortOrder: 'ASC' } } },
    });
  }

  /** The seller's rounds in any state, newest first, with their counts. */
  findBySeller(sellerId: string): Promise<CampaignMineRow[]> {
    return this.repository.query(
      `
      SELECT c.id, c.title, c.status, c.order_deadline,
             to_char(c.delivery_date, 'YYYY-MM-DD') AS delivery_date,
             c.created_at,
             (SELECT COUNT(*)::int FROM listings l
               WHERE l.campaign_id = c.id) AS item_count,
             (SELECT COUNT(*)::int FROM orders o
               WHERE o.campaign_id = c.id
                 AND o.fulfillment_status <> 'cancelled') AS order_count
        FROM campaigns c
       WHERE c.seller_id = $1
       ORDER BY c.created_at DESC, c.id DESC
      `,
      [sellerId],
    );
  }

  /** Inserts the campaign and its items in one transaction; returns the id. */
  insert(fields: CampaignFields, items: ItemWrite[]): Promise<string> {
    return this.repository.manager.transaction(async (manager) => {
      const result = await manager.insert(Campaign, fields);
      const id = result.identifiers[0].id as string;
      await writeItems(manager, { id, ...fields }, items);
      return id;
    });
  }

  /**
   * One transaction: locks the campaign row, checks it is still in
   * `expectedStatus` (CampaignStateChangedError otherwise), refuses to
   * delete items that order lines reference (CampaignItemsInUseError),
   * updates the campaign, updates/inserts items (replacing combos), deletes
   * `deleteIds`.
   */
  async save(
    id: string,
    fields: Partial<CampaignFields>,
    items: ItemWrite[],
    deleteIds: string[],
    expectedStatus: CampaignStatus,
  ): Promise<void> {
    try {
      await this.repository.manager.transaction(async (manager) => {
        // FOR NO KEY UPDATE serialises saves but, unlike FOR UPDATE, does
        // not conflict with the FOR KEY SHARE that an order insert takes on
        // this row through its foreign key. Checkout locks item rows first
        // and the campaign row second; this save does the reverse, so a
        // stronger lock here could deadlock with it.
        const locked: Array<{ status: CampaignStatus }> = await manager.query(
          `SELECT status FROM campaigns WHERE id = $1 FOR NO KEY UPDATE`,
          [id],
        );
        if (locked.length === 0) {
          throw new CampaignStateChangedError(true);
        }
        if (locked[0].status !== expectedStatus) {
          throw new CampaignStateChangedError(false);
        }
        const inUse = await itemsInUse(manager, deleteIds);
        if (inUse.length > 0) {
          throw new CampaignItemsInUseError(inUse);
        }
        await manager.update(Campaign, { id }, fields);
        const campaign = await manager.findOneByOrFail(Campaign, { id });
        await writeItems(manager, campaign, items);
        if (deleteIds.length > 0) {
          await manager.query(
            `DELETE FROM listings
              WHERE campaign_id = $1 AND id = ANY($2::uuid[])`,
            [id, deleteIds],
          );
        }
      });
    } catch (error) {
      if (isOrderLineReference(error)) {
        // An order arrived between the check and the delete. The
        // transaction is gone; read again what is in use.
        throw new CampaignItemsInUseError(
          await itemsInUse(this.repository.manager, deleteIds),
        );
      }
      throw error;
    }
  }

  /**
   * Sets the campaign's status and, when given, every item with status
   * `from` to `to`. Only when the round is still in `expectedStatus`;
   * CampaignStateChangedError otherwise.
   */
  async setStatus(
    id: string,
    fields: Partial<CampaignFields>,
    expectedStatus: CampaignStatus,
    items?: { from: ListingStatus; to: ListingStatus; publishedAt?: Date },
  ): Promise<void> {
    await this.repository.manager.transaction(async (manager) => {
      const result = await manager.update(
        Campaign,
        { id, status: expectedStatus },
        fields,
      );
      if (!result.affected) {
        throw new CampaignStateChangedError(
          !(await manager.exists(Campaign, { where: { id } })),
        );
      }
      if (items) {
        await manager.update(
          Listing,
          { campaignId: id, status: items.from },
          {
            status: items.to,
            ...(items.publishedAt ? { publishedAt: items.publishedAt } : {}),
          },
        );
      }
    });
  }

  /**
   * Deletes the campaign if it is still in `expectedStatus`; its items,
   * their combos and images go with it. CampaignStateChangedError otherwise.
   */
  async delete(id: string, expectedStatus: CampaignStatus): Promise<void> {
    const result = await this.repository.delete({ id, status: expectedStatus });
    if (!result.affected) {
      throw new CampaignStateChangedError(
        !(await this.repository.exists({ where: { id } })),
      );
    }
  }

  /** Per item: live order count and whether any order line references it. */
  async itemUsage(
    campaignId: string,
  ): Promise<Map<string, { orderCount: number; referenced: boolean }>> {
    const rows: Array<{
      id: string;
      order_count: number;
      referenced: boolean;
    }> = await this.repository.query(
      `
      SELECT l.id,
             (SELECT COUNT(DISTINCT o.id)::int FROM order_lines ol
                JOIN orders o ON o.id = ol.order_id
               WHERE ol.listing_id = l.id
                 AND o.fulfillment_status <> 'cancelled') AS order_count,
             EXISTS (SELECT 1 FROM order_lines ol
                      WHERE ol.listing_id = l.id) AS referenced
        FROM listings l
       WHERE l.campaign_id = $1
      `,
      [campaignId],
    );
    return new Map(
      rows.map((row) => [
        row.id,
        { orderCount: row.order_count, referenced: row.referenced },
      ]),
    );
  }
}

/** True when a delete failed because an order line points at the listing. */
function isOrderLineReference(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driver = error.driverError as { code?: string; constraint?: string };
  return (
    driver.code === FOREIGN_KEY_VIOLATION &&
    driver.constraint === ORDER_LINE_LISTING_FK
  );
}

/** Which of the items are referenced by an order line, cancelled or not. */
async function itemsInUse(
  manager: EntityManager,
  ids: string[],
): Promise<{ listingId: string; title: string }[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows: Array<{ id: string; title: string }> = await manager.query(
    `SELECT l.id, l.title FROM listings l
      WHERE l.id = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.listing_id = l.id)
      ORDER BY l.sort_order`,
    [ids],
  );
  return rows.map((row) => ({ listingId: row.id, title: row.title }));
}

/**
 * Updates or inserts the items of a campaign and replaces their combos. An
 * item takes its seller and category from the campaign and has no terms of
 * its own.
 */
async function writeItems(
  manager: EntityManager,
  campaign: { id: string; sellerId: string; categoryId: number },
  items: ItemWrite[],
): Promise<void> {
  for (const item of items) {
    const columns = {
      sellerId: campaign.sellerId,
      categoryId: campaign.categoryId,
      campaignId: campaign.id,
      mode: ListingMode.Preorder,
      title: item.title,
      description: item.description,
      unit: item.unit,
      unitPrice: item.unitPrice,
      stockQuantity: null,
      acceptsPrepaidQr: null,
      acceptsPayOnDelivery: null,
      condition: null,
      conditionPercent: null,
      status: item.status,
      sortOrder: item.sortOrder,
      searchText: buildSearchText(item),
    };
    let listingId = item.id;
    if (listingId === null) {
      const result = await manager.insert(Listing, {
        ...columns,
        publishedAt: item.publishedAt,
        closedAt: null,
      });
      listingId = result.identifiers[0].id as string;
    } else {
      // An item that was not on sale at publish only gets its date now.
      await manager
        .createQueryBuilder()
        .update(Listing)
        .set({
          ...columns,
          ...(item.publishedAt
            ? { publishedAt: () => 'COALESCE(published_at, :publishedAt)' }
            : {}),
        })
        .where('id = :listingId AND campaign_id = :campaignId', {
          listingId,
          campaignId: campaign.id,
        })
        .setParameter('publishedAt', item.publishedAt)
        .execute();
      await manager.delete(ListingCombo, { listingId });
    }
    if (item.combos.length > 0) {
      await manager.insert(
        ListingCombo,
        item.combos.map((combo) => ({ ...combo, listingId })),
      );
    }
  }
}
