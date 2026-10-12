import { Injectable, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import { CampaignStatus } from '../campaigns/campaign.entity.js';
import { CampaignsService } from '../campaigns/campaigns.service.js';
import { ListingCampaignDto } from '../listings/dto/listing-campaign.dto.js';
import { ListingStatus } from '../listings/listings.constants.js';
import { runBulk } from './bulk-orders.js';
import type {
  CampaignMyOrderDto,
  CampaignSummaryTableDto,
} from './dto/campaign-summary.dto.js';
import type { BulkAction, BulkResultDto } from './dto/summary.dto.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

const MAX_ROWS = 1000;

@Injectable()
export class CampaignSummaryService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly ordersService: OrdersService,
    private readonly campaigns: CampaignsService,
  ) {}

  /** Who ordered how many of each product of a round: one row per order. */
  async getSummary(
    sellerId: string,
    campaignId: string,
    includeCancelled: boolean,
  ): Promise<CampaignSummaryTableDto> {
    const campaign = await this.campaigns.findOwned(sellerId, campaignId);

    if ((await this.orders.countForCampaign(campaignId)) > MAX_ROWS) {
      throw new DomainException(
        422,
        'SUMMARY_TOO_LARGE',
        `The summary is limited to ${MAX_ROWS} orders`,
      );
    }
    const [orders, totals, itemTotals] = await Promise.all([
      this.orders.listForCampaign(campaignId, includeCancelled),
      this.orders.totalsForCampaign(campaignId),
      this.orders.itemTotalsForCampaign(campaignId),
    ]);

    // A column for every product on sale or that anyone holds: a product
    // stopped after it was ordered keeps its column, one nobody ordered goes.
    const ordered = new Set(itemTotals.keys());
    for (const order of orders) {
      for (const line of order.lines) {
        ordered.add(line.listingId);
      }
    }
    const items = [...campaign.items]
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .filter(
        (item) => item.status !== ListingStatus.Closed || ordered.has(item.id),
      );
    const index = new Map(items.map((item, i) => [item.id, i]));

    return {
      campaign: ListingCampaignDto.from(campaign),
      items: items.map((item) => ({
        listingId: item.id,
        title: item.title,
        unit: item.unit,
      })),
      rows: orders.map((order) => {
        const quantities = items.map(() => 0);
        for (const line of order.lines) {
          const at = index.get(line.listingId);
          if (at !== undefined) {
            quantities[at] += Number(line.quantity);
          }
        }
        return {
          orderId: order.id,
          code: order.code,
          buyer: { name: order.buyer.name, email: order.buyer.email },
          deliveryLocation: order.deliveryLocation,
          quantities,
          totalAmount: order.totalAmount,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          note: order.note,
          createdAt: order.createdAt.toISOString(),
        };
      }),
      itemTotals: items.map((item) => itemTotals.get(item.id) ?? 0),
      totals: {
        ...totals,
        outstandingAmount: totals.totalAmount - totals.paidAmount,
      },
    };
  }

  /** Applies one action to many orders of a round; see `runBulk`. */
  async bulk(
    sellerId: string,
    campaignId: string,
    action: BulkAction,
    orderIds: string[],
  ): Promise<BulkResultDto[]> {
    await this.campaigns.findOwned(sellerId, campaignId);
    const unique = [...new Set(orderIds)];
    const ofCampaign = await this.orders.ordersOfCampaign(unique, campaignId);
    return runBulk(
      this.ordersService,
      sellerId,
      action,
      unique,
      ofCampaign,
      'NOT_IN_CAMPAIGN',
    );
  }

  /** The buyer's live order in the round, so the page can offer to edit it. */
  async myOrder(
    buyerId: string,
    campaignId: string,
  ): Promise<CampaignMyOrderDto> {
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign || campaign.status === CampaignStatus.Draft) {
      throw new NotFoundException('Round not found');
    }
    const order = await this.orders.findActivePreorder(campaignId, buyerId);
    return { orderId: order?.id ?? null };
  }
}
