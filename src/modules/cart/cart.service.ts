import { BadRequestException, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import { ListingSellerDto } from '../listings/dto/listing-response.dto.js';
import { isListingOpen } from '../listings/listing-rules.js';
import type { ListingItem } from '../listings/listing-item.entity.js';
import type { Listing } from '../listings/listing.entity.js';
import { ListingMode } from '../listings/listings.constants.js';
import { ListingsService } from '../listings/listings.service.js';
import { mediaUrl, thumbnailKey } from '../listings/media-url.js';
import {
  lineTotal,
  lineTotalWithCombos,
  toThousandths,
} from '../listings/pricing.js';
import type { OrderDetailDto } from '../orders/dto/order-response.dto.js';
import { IdempotencyService } from '../orders/idempotency.service.js';
import { quantityProblem } from '../orders/order-math.js';
import { PaymentMethod } from '../orders/orders.constants.js';
import { OrdersService } from '../orders/orders.service.js';
import { UsersService } from '../users/users.service.js';
import { CartRepository } from './cart.repository.js';
import { type PlannedOrder, splitIntoOrders } from './checkout-split.js';
import {
  type CartDto,
  type CartGroupDto,
  type CartLineDto,
  CartProblem,
  type CheckoutLineDto,
  type CheckoutOrderChoiceDto,
  type CheckoutPreviewDto,
} from './dto/cart.dto.js';

export const CART_MAX_LINES = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A line being bought, resolved to its option and listing. */
interface ResolvedLine {
  item: ListingItem;
  listing: Listing;
  quantity: string;
}

@Injectable()
export class CartService {
  constructor(
    private readonly cart: CartRepository,
    private readonly listings: ListingsService,
    private readonly users: UsersService,
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** The cart grouped by seller, with current prices and what is wrong. */
  async get(userId: string): Promise<CartDto> {
    const lines = await this.cart.findForUser(userId);
    const items = new Map(
      (
        await this.listings.findItems(lines.map((line) => line.listingItemId))
      ).map((item) => [item.id, item]),
    );
    const now = new Date();
    const groups = new Map<string, CartGroupDto>();
    for (const line of lines) {
      const item = items.get(line.listingItemId);
      if (!item) {
        continue;
      }
      const listing = item.listing;
      const group = groups.get(listing.sellerId) ?? {
        seller: ListingSellerDto.from(listing.seller),
        lines: [],
      };
      group.lines.push(this.toLine(item, line.quantity, now));
      groups.set(listing.sellerId, group);
    }
    return {
      groups: [...groups.values()],
      lineCount: lines.length,
    };
  }

  count(userId: string): Promise<number> {
    return this.cart.countForUser(userId);
  }

  /** Puts an option in the cart with this quantity, or changes it. */
  async setLine(
    userId: string,
    itemId: string,
    quantity: string,
  ): Promise<CartDto> {
    const [item] = await this.listings.findItems([itemId]);
    if (!item || !item.isActive || !isListingOpen(item.listing, new Date())) {
      throw new DomainException(
        409,
        'LISTING_NOT_OPEN',
        'This listing is not open for orders',
      );
    }
    if (item.listing.sellerId === userId) {
      throw new DomainException(
        422,
        'OWN_LISTING',
        'You cannot buy from your own listing',
      );
    }
    const problem = quantityProblem(quantity, item.unit);
    if (problem) {
      throw new DomainException(422, 'INVALID_QUANTITY', problem, {
        problems: [problem],
      });
    }
    if (
      !(await this.cart.findLine(userId, itemId)) &&
      (await this.cart.countForUser(userId)) >= CART_MAX_LINES
    ) {
      throw new DomainException(
        409,
        'CART_FULL',
        `A cart holds at most ${CART_MAX_LINES} options`,
      );
    }
    await this.cart.upsert(userId, itemId, quantity);
    return this.get(userId);
  }

  async removeLine(userId: string, itemId: string): Promise<CartDto> {
    await this.cart.remove(userId, itemId);
    return this.get(userId);
  }

  /** The orders a checkout of these lines would create, priced. */
  async preview(
    userId: string,
    lines: CheckoutLineDto[],
  ): Promise<CheckoutPreviewDto> {
    const resolved = await this.resolve(userId, lines);
    const byItem = new Map(resolved.map((line) => [line.item.id, line]));
    return {
      orders: this.split(resolved).map((planned) => {
        const orderLines = planned.itemIds.map(
          (id) => byItem.get(id) as ResolvedLine,
        );
        const first = orderLines[0].listing;
        const priced = orderLines.map(({ item, listing, quantity }) => ({
          itemId: item.id,
          listingId: listing.id,
          listingTitle: listing.title,
          itemName: item.name,
          unit: item.unit,
          unitPrice: item.unitPrice,
          quantity: Number(quantity),
          combos: combosOf(item),
          lineTotal: lineTotalWithCombos(
            item.unitPrice,
            combosOf(item),
            quantity,
          ),
          listTotal: lineTotal(item.unitPrice, quantity),
        }));
        const isPreorder = first.mode === ListingMode.Preorder;
        return {
          key: planned.key,
          seller: ListingSellerDto.from(first.seller),
          isPreorder,
          orderDeadline: isPreorder
            ? (first.orderDeadline?.toISOString() ?? null)
            : null,
          deliveryDate: isPreorder ? first.deliveryDate : null,
          lines: priced,
          totalAmount: priced.reduce((sum, line) => sum + line.lineTotal, 0),
          listTotal: priced.reduce((sum, line) => sum + line.listTotal, 0),
          paymentMethods: planned.paymentMethods,
        };
      }),
    };
  }

  /**
   * Creates every order of the selection at once, or none. The choices must
   * name the same orders the preview showed; if the listings changed in
   * between (a payment method was switched off), the person reviews again.
   */
  async checkout(
    userId: string,
    input: {
      lines: CheckoutLineDto[];
      orders: CheckoutOrderChoiceDto[];
      fromCart: boolean;
    },
    idempotencyKey: string | undefined,
  ): Promise<{ orders: OrderDetailDto[]; replayed: boolean }> {
    if (!idempotencyKey || !UUID.test(idempotencyKey)) {
      throw new DomainException(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send a UUID in the Idempotency-Key header',
      );
    }

    const { value, replayed } = await this.idempotency.run(
      `checkout:${userId}`,
      idempotencyKey,
      async () => {
        const ids = await this.placeOrders(userId, input);
        return { id: ids.join(','), value: ids };
      },
      (stored) => Promise.resolve(stored.split(',')),
    );
    const orders: OrderDetailDto[] = [];
    for (const id of value) {
      orders.push(await this.orders.getForParticipant(userId, id));
    }
    return { orders, replayed };
  }

  private async placeOrders(
    userId: string,
    input: {
      lines: CheckoutLineDto[];
      orders: CheckoutOrderChoiceDto[];
      fromCart: boolean;
    },
  ): Promise<string[]> {
    const resolved = await this.resolve(userId, input.lines);
    const planned = this.split(resolved);
    const choices = new Map(input.orders.map((choice) => [choice.key, choice]));
    if (
      planned.length !== choices.size ||
      planned.some((order) => !choices.has(order.key))
    ) {
      throw new DomainException(
        409,
        'CHECKOUT_CHANGED',
        'The orders to create have changed; review them again',
      );
    }
    const listingOf = new Map(
      resolved.map((line) => [line.item.id, line.listing.id]),
    );
    const quantityOf = new Map(
      resolved.map((line) => [line.item.id, line.quantity]),
    );
    const itemIds = resolved.map((line) => line.item.id);

    return this.orders.createMany(
      userId,
      planned.map((order) => {
        const choice = choices.get(order.key) as CheckoutOrderChoiceDto;
        return {
          lines: order.itemIds.map((itemId) => ({
            listingId: listingOf.get(itemId) as string,
            itemId,
            quantity: quantityOf.get(itemId) as string,
          })),
          paymentMethod: choice.paymentMethod,
          deliveryLocation: choice.deliveryLocation,
          note: choice.note,
        };
      }),
      input.fromCart
        ? (tx) => this.cart.removeInTx(tx, userId, itemIds)
        : undefined,
    );
  }

  /** Looks up every line; refuses what cannot be bought at all. */
  private async resolve(
    userId: string,
    lines: CheckoutLineDto[],
  ): Promise<ResolvedLine[]> {
    const ids = lines.map((line) => line.itemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('An option appears twice');
    }
    const items = new Map(
      (await this.listings.findItems(ids)).map((item) => [item.id, item]),
    );
    const now = new Date();
    return lines.map((line) => {
      const item = items.get(line.itemId);
      if (!item || !item.isActive || !isListingOpen(item.listing, now)) {
        throw new DomainException(
          409,
          'LISTING_NOT_OPEN',
          'This listing is not open for orders',
          { itemId: line.itemId },
        );
      }
      if (item.listing.sellerId === userId) {
        throw new DomainException(
          422,
          'OWN_LISTING',
          'You cannot buy from your own listing',
        );
      }
      const problem = quantityProblem(line.quantity, item.unit);
      if (problem) {
        throw new DomainException(422, 'INVALID_QUANTITY', problem, {
          problems: [problem],
          itemId: line.itemId,
        });
      }
      return { item, listing: item.listing, quantity: line.quantity };
    });
  }

  private split(lines: ResolvedLine[]): PlannedOrder[] {
    return splitIntoOrders(
      lines.map(({ item, listing }) => ({
        itemId: item.id,
        listingId: listing.id,
        sellerId: listing.sellerId,
        mode: listing.mode,
        paymentMethods: this.methodsOf(listing),
      })),
    );
  }

  private methodsOf(listing: Listing): PaymentMethod[] {
    const methods: PaymentMethod[] = [];
    if (listing.acceptsPrepaidQr && this.users.hasBankProfile(listing.seller)) {
      methods.push(PaymentMethod.PrepaidQr);
    }
    if (listing.acceptsPayOnDelivery) {
      methods.push(PaymentMethod.PayOnDelivery);
    }
    return methods;
  }

  private toLine(item: ListingItem, quantity: string, now: Date): CartLineDto {
    const listing = item.listing;
    const stock =
      item.stockQuantity === null ? null : Number(item.stockQuantity);
    let problem: CartProblem | null = null;
    if (!isListingOpen(listing, now)) {
      problem = CartProblem.ListingNotOpen;
    } else if (!item.isActive) {
      problem = CartProblem.ItemRemoved;
    } else if (
      stock !== null &&
      (toThousandths(item.stockQuantity as string) ?? 0) <
        (toThousandths(normalize(quantity)) ?? 0)
    ) {
      problem = CartProblem.OutOfStock;
    }
    const image = listing.images[0];
    return {
      itemId: item.id,
      listingId: listing.id,
      listingTitle: listing.title,
      mode: listing.mode,
      itemCount: listing.items.filter((candidate) => candidate.isActive).length,
      itemName: item.name,
      unit: item.unit,
      unitPrice: item.unitPrice,
      combos: combosOf(item),
      quantity: Number(quantity),
      stockQuantity: stock,
      thumbnailUrl: image ? mediaUrl(thumbnailKey(image.storageKey)) : null,
      orderDeadline: listing.orderDeadline?.toISOString() ?? null,
      lineTotal: lineTotalWithCombos(
        item.unitPrice,
        combosOf(item),
        normalize(quantity),
      ),
      listTotal: lineTotal(item.unitPrice, normalize(quantity)),
      problem,
    };
  }
}

/** "2.500" from PostgreSQL numeric -> "2.5". */
function normalize(quantity: string): string {
  return String(Number(quantity));
}

function combosOf(item: ListingItem): { quantity: string; price: number }[] {
  return (item.combos ?? [])
    .map((combo) => ({
      quantity: normalize(combo.quantity),
      price: combo.price,
    }))
    .sort((a, b) => Number(a.quantity) - Number(b.quantity));
}
