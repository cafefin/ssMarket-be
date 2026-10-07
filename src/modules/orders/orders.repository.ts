import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, QueryFailedError, Repository } from 'typeorm';
import type { Tx } from '../../database/transaction.js';
import type { OrderCursor } from './order-cursor.js';
import { OrderLine } from './order-line.entity.js';
import { Order } from './order.entity.js';
import {
  FulfillmentStatus,
  type OrderActor,
  type PaymentMethod,
  type PaymentStatus,
} from './orders.constants.js';

export interface NewOrder {
  code: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  isPreorder: boolean;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  deliveryLocation: string;
  note: string | null;
  sellerBankBin: string | null;
  sellerBankAccountNumber: string | null;
  sellerBankAccountName: string | null;
  createdAt: Date;
}

export interface NewOrderLine {
  listingItemId: string;
  itemName: string;
  unit: string;
  unitPrice: number;
  quantity: string;
  lineTotal: number;
  listTotal: number;
  combos: { quantity: string; price: number }[];
  sortOrder: number;
}

/** The columns that change after an order has been placed. */
export interface OrderChanges {
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  reportedAt?: Date | null;
  paidAt?: Date | null;
  deliveredAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledBy?: OrderActor | null;
  cancelReason?: string | null;
  refundNeeded?: boolean;
}

/** What an edit may change on the order itself, besides its lines. */
export interface OrderEdit {
  totalAmount: number;
  paymentMethod: PaymentMethod;
  deliveryLocation: string;
  note: string | null;
  sellerBankBin: string | null;
  sellerBankAccountNumber: string | null;
  sellerBankAccountName: string | null;
}

export interface SalesFilters {
  listingId?: string;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
}

/**
 * Thrown when an insert hits one of the two unique rules on orders, so the
 * service can react without knowing about database error codes.
 */
export class OrderConflictError extends Error {
  constructor(readonly kind: 'code' | 'active-preorder') {
    super(`Order conflict: ${kind}`);
  }
}

const RELATIONS = { lines: true, buyer: true, seller: true, listing: true };
const LINE_ORDER = { lines: { sortOrder: 'ASC' as const } };

@Injectable()
export class OrdersRepository {
  constructor(
    @InjectRepository(Order) private readonly repository: Repository<Order>,
  ) {}

  findByIdWithRelations(id: string): Promise<Order | null> {
    return this.repository.findOne({
      where: { id },
      relations: RELATIONS,
      order: LINE_ORDER,
    });
  }

  /** The buyer's live order on a pre-order listing, if any. */
  findActivePreorder(
    listingId: string,
    buyerId: string,
  ): Promise<Order | null> {
    return this.repository.findOne({
      where: {
        listingId,
        buyerId,
        isPreorder: true,
        fulfillmentStatus: Not(FulfillmentStatus.Cancelled),
      },
    });
  }

  /** Inserts the order and its lines inside the caller's transaction. */
  async insert(
    tx: Tx,
    order: NewOrder,
    lines: NewOrderLine[],
  ): Promise<string> {
    try {
      const result = await tx.insert(Order, order);
      const id = result.identifiers[0].id as string;
      await tx.insert(
        OrderLine,
        lines.map((line) => ({ ...line, orderId: id })),
      );
      return id;
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const driver = error.driverError as {
          code?: string;
          constraint?: string;
        };
        if (driver.code === '23505' && driver.constraint === 'UQ_orders_code') {
          throw new OrderConflictError('code');
        }
        if (
          driver.code === '23505' &&
          driver.constraint === 'UQ_orders_one_active_preorder'
        ) {
          throw new OrderConflictError('active-preorder');
        }
      }
      throw error;
    }
  }

  /**
   * Loads an order and locks its row until the transaction ends, so two
   * people acting on the same order are handled one after the other.
   */
  async findForUpdate(tx: Tx, id: string): Promise<Order | null> {
    const locked: unknown[] = await tx.query(
      `SELECT id FROM orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (locked.length === 0) {
      return null;
    }
    return tx.findOne(Order, {
      where: { id },
      relations: RELATIONS,
      order: LINE_ORDER,
    });
  }

  async update(tx: Tx, id: string, changes: OrderChanges): Promise<void> {
    await tx.update(Order, { id }, changes);
  }

  /** Replaces all lines of an order and updates its totals, in the caller's transaction. */
  async replaceLines(
    tx: Tx,
    id: string,
    lines: NewOrderLine[],
    edit: OrderEdit,
  ): Promise<void> {
    await tx.delete(OrderLine, { orderId: id });
    await tx.insert(
      OrderLine,
      lines.map((line) => ({ ...line, orderId: id })),
    );
    await tx.update(Order, { id }, edit);
  }

  listForBuyer(
    buyerId: string,
    cursor: OrderCursor | null,
    limit: number,
  ): Promise<Order[]> {
    return this.page('o.buyer_id = :userId', buyerId, {}, cursor, limit);
  }

  listForSeller(
    sellerId: string,
    filters: SalesFilters,
    cursor: OrderCursor | null,
    limit: number,
  ): Promise<Order[]> {
    return this.page('o.seller_id = :userId', sellerId, filters, cursor, limit);
  }

  private async page(
    owner: string,
    userId: string,
    filters: SalesFilters,
    cursor: OrderCursor | null,
    limit: number,
  ): Promise<Order[]> {
    // Page on ids first; joining the lines here would make LIMIT count lines.
    const query = this.repository
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where(owner, { userId })
      .orderBy('o.created_at', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .limit(limit);
    if (filters.listingId) {
      query.andWhere('o.listing_id = :listingId', filters);
    }
    if (filters.paymentStatus) {
      query.andWhere('o.payment_status = :paymentStatus', filters);
    }
    if (filters.fulfillmentStatus) {
      query.andWhere('o.fulfillment_status = :fulfillmentStatus', filters);
    }
    if (cursor) {
      query.andWhere(
        '(o.created_at, o.id) < (:createdAt::timestamptz, :cursorId::uuid)',
        { createdAt: cursor.createdAt, cursorId: cursor.id },
      );
    }

    const ids = (await query.getRawMany<{ id: string }>()).map((row) => row.id);
    if (ids.length === 0) {
      return [];
    }
    const orders = await this.repository.find({
      where: ids.map((id) => ({ id })),
      relations: RELATIONS,
      order: LINE_ORDER,
    });
    const byId = new Map(orders.map((order) => [order.id, order]));
    return ids.map((id) => byId.get(id) as Order);
  }

  countForListing(listingId: string): Promise<number> {
    return this.repository.count({ where: { listingId } });
  }

  /** Every order on a listing, oldest first, for the seller's summary. */
  listForListing(
    listingId: string,
    includeCancelled: boolean,
  ): Promise<Order[]> {
    return this.repository.find({
      where: {
        listingId,
        ...(includeCancelled
          ? {}
          : { fulfillmentStatus: Not(FulfillmentStatus.Cancelled) }),
      },
      relations: RELATIONS,
      order: { createdAt: 'ASC', id: 'ASC', ...LINE_ORDER },
    });
  }

  /**
   * Totals over the listing's live (not cancelled) orders, computed by the
   * database so they cannot drift from the rows.
   */
  async totalsForListing(listingId: string): Promise<ListingTotals> {
    const [money]: Array<{ order_count: number; total: string; paid: string }> =
      await this.repository.query(
        `SELECT COUNT(*)::int AS order_count,
                COALESCE(SUM(total_amount), 0) AS total,
                COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) AS paid
           FROM orders
          WHERE listing_id = $1 AND fulfillment_status <> 'cancelled'`,
        [listingId],
      );
    const quantities: Array<{ item_id: string; quantity: string }> =
      await this.repository.query(
        `SELECT ol.listing_item_id AS item_id, SUM(ol.quantity) AS quantity
           FROM order_lines ol
           JOIN orders o ON o.id = ol.order_id
          WHERE o.listing_id = $1 AND o.fulfillment_status <> 'cancelled'
          GROUP BY ol.listing_item_id`,
        [listingId],
      );
    return {
      orderCount: money.order_count,
      totalAmount: Number(money.total),
      paidAmount: Number(money.paid),
      quantities: Object.fromEntries(
        quantities.map((row) => [row.item_id, Number(row.quantity)]),
      ),
    };
  }

  /** Which listing each of the given orders belongs to. */
  async listingIdsOf(orderIds: string[]): Promise<Map<string, string>> {
    const orders = await this.repository.find({
      where: orderIds.map((id) => ({ id })),
      select: { id: true, listingId: true },
    });
    return new Map(orders.map((order) => [order.id, order.listingId]));
  }
}

export interface ListingTotals {
  orderCount: number;
  totalAmount: number;
  paidAmount: number;
  quantities: Record<string, number>;
}
