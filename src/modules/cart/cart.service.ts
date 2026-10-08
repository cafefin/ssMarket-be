import { BadRequestException, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import {
  combosOf,
  ListingSellerDto,
} from '../listings/dto/listing-response.dto.js';
import { isListingOpen } from '../listings/listing-rules.js';
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

/** A line being bought, resolved to its listing. */
interface ResolvedLine {
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
    const listings = new Map(
      (await this.listings.findByIds(lines.map((line) => line.listingId))).map(
        (listing) => [listing.id, listing],
      ),
    );
    const now = new Date();
    const groups = new Map<string, CartGroupDto>();
    for (const line of lines) {
      const listing = listings.get(line.listingId);
      if (!listing) {
        continue;
      }
      const group = groups.get(listing.sellerId) ?? {
        seller: ListingSellerDto.from(listing.seller),
        lines: [],
      };
      group.lines.push(this.toLine(listing, line.quantity, now));
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

  /**
   * Puts a product in the cart with this quantity, or changes it. More than
   * the stock that is left is refused, so the cart never promises what
   * cannot be bought; checkout still reserves the stock for real.
   */
  async setLine(
    userId: string,
    listingId: string,
    quantity: string,
  ): Promise<CartDto> {
    const [listing] = await this.listings.findByIds([listingId]);
    if (!listing || !isListingOpen(listing, new Date())) {
      throw new DomainException(
        409,
        'LISTING_NOT_OPEN',
        'This listing is not open for orders',
      );
    }
    if (listing.sellerId === userId) {
      throw new DomainException(
        422,
        'OWN_LISTING',
        'You cannot buy from your own listing',
      );
    }
    const problem = quantityProblem(quantity, listing.unit);
    if (problem) {
      throw new DomainException(422, 'INVALID_QUANTITY', problem, {
        problems: [problem],
      });
    }
    if (exceedsStock(listing, quantity)) {
      throw new DomainException(
        409,
        'OUT_OF_STOCK',
        'Not enough stock for this quantity',
        {
          items: [
            {
              listingId,
              title: listing.title,
              available: Number(listing.stockQuantity),
            },
          ],
        },
      );
    }
    if (
      !(await this.cart.findLine(userId, listingId)) &&
      (await this.cart.countForUser(userId)) >= CART_MAX_LINES
    ) {
      throw new DomainException(
        409,
        'CART_FULL',
        `A cart holds at most ${CART_MAX_LINES} products`,
      );
    }
    await this.cart.upsert(userId, listingId, quantity);
    return this.get(userId);
  }

  async removeLine(userId: string, listingId: string): Promise<CartDto> {
    await this.cart.remove(userId, listingId);
    return this.get(userId);
  }

  /** The orders a checkout of these lines would create, priced. */
  async preview(
    userId: string,
    lines: CheckoutLineDto[],
  ): Promise<CheckoutPreviewDto> {
    const resolved = await this.resolve(userId, lines);
    const byListing = new Map(resolved.map((line) => [line.listing.id, line]));
    return {
      orders: this.split(resolved).map((planned) => {
        const orderLines = planned.listingIds.map(
          (id) => byListing.get(id) as ResolvedLine,
        );
        const first = orderLines[0].listing;
        const priced = orderLines.map(({ listing, quantity }) => {
          const combos = combosOf(listing.combos);
          return {
            listingId: listing.id,
            title: listing.title,
            unit: listing.unit,
            unitPrice: listing.unitPrice,
            quantity: Number(quantity),
            combos,
            lineTotal: lineTotalWithCombos(listing.unitPrice, combos, quantity),
            listTotal: lineTotal(listing.unitPrice, quantity),
          };
        });
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
    const quantityOf = new Map(
      resolved.map((line) => [line.listing.id, line.quantity]),
    );
    const listingIds = resolved.map((line) => line.listing.id);

    return this.orders.createMany(
      userId,
      planned.map((order) => {
        const choice = choices.get(order.key) as CheckoutOrderChoiceDto;
        return {
          lines: order.listingIds.map((listingId) => ({
            listingId,
            quantity: quantityOf.get(listingId) as string,
          })),
          paymentMethod: choice.paymentMethod,
          deliveryLocation: choice.deliveryLocation,
          note: choice.note,
        };
      }),
      input.fromCart
        ? (tx) => this.cart.removeInTx(tx, userId, listingIds)
        : undefined,
    );
  }

  /** Looks up every line; refuses what cannot be bought at all. */
  private async resolve(
    userId: string,
    lines: CheckoutLineDto[],
  ): Promise<ResolvedLine[]> {
    const ids = lines.map((line) => line.listingId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A product appears twice');
    }
    const listings = new Map(
      (await this.listings.findByIds(ids)).map((listing) => [
        listing.id,
        listing,
      ]),
    );
    const now = new Date();
    return lines.map((line) => {
      const listing = listings.get(line.listingId);
      if (!listing || !isListingOpen(listing, now)) {
        throw new DomainException(
          409,
          'LISTING_NOT_OPEN',
          'This listing is not open for orders',
          { listingId: line.listingId },
        );
      }
      if (listing.sellerId === userId) {
        throw new DomainException(
          422,
          'OWN_LISTING',
          'You cannot buy from your own listing',
        );
      }
      const problem = quantityProblem(line.quantity, listing.unit);
      if (problem) {
        throw new DomainException(422, 'INVALID_QUANTITY', problem, {
          problems: [problem],
          listingId: line.listingId,
        });
      }
      return { listing, quantity: line.quantity };
    });
  }

  private split(lines: ResolvedLine[]): PlannedOrder[] {
    return splitIntoOrders(
      lines.map(({ listing }) => ({
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

  private toLine(listing: Listing, quantity: string, now: Date): CartLineDto {
    let problem: CartProblem | null = null;
    if (!isListingOpen(listing, now)) {
      problem = CartProblem.ListingNotOpen;
    } else if (exceedsStock(listing, normalize(quantity))) {
      problem = CartProblem.OutOfStock;
    }
    const image = listing.images[0];
    const combos = combosOf(listing.combos);
    return {
      listingId: listing.id,
      title: listing.title,
      mode: listing.mode,
      unit: listing.unit,
      unitPrice: listing.unitPrice,
      combos,
      quantity: Number(quantity),
      stockQuantity:
        listing.stockQuantity === null ? null : Number(listing.stockQuantity),
      thumbnailUrl: image ? mediaUrl(thumbnailKey(image.storageKey)) : null,
      orderDeadline: listing.orderDeadline?.toISOString() ?? null,
      lineTotal: lineTotalWithCombos(
        listing.unitPrice,
        combos,
        normalize(quantity),
      ),
      listTotal: lineTotal(listing.unitPrice, normalize(quantity)),
      problem,
    };
  }
}

/** "2.500" from PostgreSQL numeric -> "2.5". */
function normalize(quantity: string): string {
  return String(Number(quantity));
}

/** True when an in-stock product has less left than `quantity`. */
function exceedsStock(listing: Listing, quantity: string): boolean {
  return (
    listing.stockQuantity !== null &&
    (toThousandths(normalize(listing.stockQuantity)) ?? 0) <
      (toThousandths(quantity) ?? 0)
  );
}
