import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { Tx } from '../../database/transaction.js';
import { CartLine } from './cart-line.entity.js';

@Injectable()
export class CartRepository {
  constructor(
    @InjectRepository(CartLine)
    private readonly repository: Repository<CartLine>,
  ) {}

  /** The person's cart, most recently added first. */
  findForUser(userId: string): Promise<CartLine[]> {
    return this.repository.find({
      where: { userId },
      order: { addedAt: 'DESC', id: 'DESC' },
    });
  }

  countForUser(userId: string): Promise<number> {
    return this.repository.count({ where: { userId } });
  }

  findLine(userId: string, itemId: string): Promise<CartLine | null> {
    return this.repository.findOne({
      where: { userId, listingItemId: itemId },
    });
  }

  /** Adds the option or replaces its quantity. */
  async upsert(
    userId: string,
    itemId: string,
    quantity: string,
  ): Promise<void> {
    await this.repository.upsert(
      { userId, listingItemId: itemId, quantity },
      { conflictPaths: ['userId', 'listingItemId'] },
    );
  }

  async remove(userId: string, itemId: string): Promise<void> {
    await this.repository.delete({ userId, listingItemId: itemId });
  }

  /** Removes bought options inside the checkout's transaction. */
  async removeInTx(tx: Tx, userId: string, itemIds: string[]): Promise<void> {
    if (itemIds.length > 0) {
      await tx.delete(CartLine, { userId, listingItemId: In(itemIds) });
    }
  }
}
