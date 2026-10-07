import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Listing } from '../listings/listing.entity.js';
import { ListingsService } from '../listings/listings.service.js';
import type {
  BulkAction,
  BulkResultDto,
  SalesSummaryDto,
} from './dto/summary.dto.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

const MAX_ROWS = 1000;

@Injectable()
export class SalesSummaryService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly ordersService: OrdersService,
    private readonly listings: ListingsService,
  ) {}

  /** Who ordered what on one listing: the table that replaces the spreadsheet. */
  async getSummary(
    sellerId: string,
    listingId: string,
    includeCancelled: boolean,
  ): Promise<SalesSummaryDto> {
    const listing = await this.findOwned(sellerId, listingId);

    if ((await this.orders.countForListing(listingId)) > MAX_ROWS) {
      throw new DomainException(
        422,
        'SUMMARY_TOO_LARGE',
        `The summary is limited to ${MAX_ROWS} orders`,
      );
    }
    const [allOrders, totals] = await Promise.all([
      this.orders.listForListing(listingId, includeCancelled),
      this.orders.totalsForListing(listingId),
    ]);
    // An in-stock order from the cart may hold other listings too; the table
    // shows only this listing's part of it.
    const orders = allOrders.map((order) => {
      const lines = order.lines.filter((line) => line.listingId === listingId);
      return Object.assign(order, {
        lines,
        totalAmount: lines.reduce((sum, line) => sum + line.lineTotal, 0),
      });
    });

    // Removed items keep their column while any shown order still has them.
    const ordered = new Set(
      orders.flatMap((order) => order.lines.map((line) => line.listingItemId)),
    );
    const items = listing.items
      .filter((item) => item.isActive || ordered.has(item.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        isActive: item.isActive,
      }));

    return {
      listing: {
        id: listing.id,
        title: listing.title,
        orderDeadline: listing.orderDeadline?.toISOString() ?? null,
        deliveryDate: listing.deliveryDate,
      },
      items,
      rows: orders.map((order) => ({
        orderId: order.id,
        code: order.code,
        buyer: { name: order.buyer.name, email: order.buyer.email },
        deliveryLocation: order.deliveryLocation,
        quantities: Object.fromEntries(
          order.lines.map((line) => [
            line.listingItemId,
            Number(line.quantity),
          ]),
        ),
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        note: order.note,
        createdAt: order.createdAt.toISOString(),
      })),
      totals: {
        ...totals,
        outstandingAmount: totals.totalAmount - totals.paidAmount,
      },
    };
  }

  /**
   * Applies one action to many orders of a listing. Each order is handled on
   * its own under the normal rules; one that cannot be processed is reported
   * and does not stop the others.
   */
  async bulk(
    sellerId: string,
    listingId: string,
    action: BulkAction,
    orderIds: string[],
  ): Promise<BulkResultDto[]> {
    await this.findOwned(sellerId, listingId);
    const unique = [...new Set(orderIds)];
    const ofListing = await this.orders.ordersOfListing(unique, listingId);

    const results: BulkResultDto[] = [];
    for (const orderId of unique) {
      if (!ofListing.has(orderId)) {
        results.push({ orderId, ok: false, code: 'NOT_IN_LISTING' });
        continue;
      }
      try {
        await (action === 'deliver'
          ? this.ordersService.deliver(sellerId, orderId)
          : this.ordersService.confirmPayment(sellerId, orderId));
        results.push({ orderId, ok: true, code: null });
      } catch (error) {
        if (!(error instanceof HttpException)) {
          throw error;
        }
        results.push({
          orderId,
          ok: false,
          code:
            error instanceof DomainException
              ? error.code
              : (HttpStatus[error.getStatus()] ?? 'ERROR'),
        });
      }
    }
    return results;
  }

  private async findOwned(
    sellerId: string,
    listingId: string,
  ): Promise<Listing> {
    const listing = await this.listings.findById(listingId);
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    if (listing.sellerId !== sellerId) {
      throw new ForbiddenException(
        'Only the seller can see a listing’s orders',
      );
    }
    return listing;
  }
}
