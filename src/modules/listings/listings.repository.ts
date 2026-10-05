import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListingItem } from './listing-item.entity.js';
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
}
