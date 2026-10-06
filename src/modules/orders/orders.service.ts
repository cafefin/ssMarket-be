import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import { TransactionRunner, type Tx } from '../../database/transaction.js';
import { BanksService } from '../banks/banks.service.js';
import { isListingOpen } from '../listings/listing-rules.js';
import type { Listing } from '../listings/listing.entity.js';
import { ListingMode } from '../listings/listings.constants.js';
import { ListingsService } from '../listings/listings.service.js';
import { buildVietQrPayload } from '../payments/vietqr.js';
import { UsersService } from '../users/users.service.js';
import {
  OrderDetailDto,
  type OrderPageDto,
  type OrderQrDto,
} from './dto/order-response.dto.js';
import { IdempotencyService } from './idempotency.service.js';
import { generateOrderCode } from './order-code.js';
import { decodeOrderCursor, encodeOrderCursor } from './order-cursor.js';
import { lineTotal, quantityProblem } from './order-math.js';
import {
  assertCanCancel,
  assertCanDeliver,
  needsRefund,
  nextPaymentStatus,
} from './order-transitions.js';
import type { Order } from './order.entity.js';
import {
  FulfillmentStatus,
  ORDER_LIMITS,
  OrderActor,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';
import {
  type NewOrderLine,
  type OrderChanges,
  OrderConflictError,
  OrdersRepository,
  type SalesFilters,
} from './orders.repository.js';

export interface PlaceOrderInput {
  listingId: string;
  lines: { itemId: string; quantity: string }[];
  paymentMethod: PaymentMethod;
  deliveryLocation: string;
  note?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;
const CODE_ATTEMPTS = 5;

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly listings: ListingsService,
    private readonly users: UsersService,
    private readonly banks: BanksService,
    private readonly transactions: TransactionRunner,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Places an order. `replayed` is true when the same idempotency key had
   * already produced an order, which is returned instead of a second one.
   */
  async place(
    buyerId: string,
    input: PlaceOrderInput,
    idempotencyKey: string | undefined,
  ): Promise<{ order: OrderDetailDto; replayed: boolean }> {
    if (!idempotencyKey || !UUID.test(idempotencyKey)) {
      throw new DomainException(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send a UUID in the Idempotency-Key header',
      );
    }

    const { value, replayed } = await this.idempotency.run(
      `order:${buyerId}`,
      idempotencyKey,
      async () => {
        const id = await this.create(buyerId, input);
        return { id, value: id };
      },
      (id) => Promise.resolve(id),
    );
    return { order: await this.getForParticipant(buyerId, value), replayed };
  }

  /** Buyer and seller see the order; to anyone else it does not exist. */
  async getForParticipant(userId: string, id: string): Promise<OrderDetailDto> {
    const order = await this.orders.findByIdWithRelations(id);
    const role = order ? actorOf(order, userId) : null;
    if (!order || !role) {
      throw new NotFoundException('Order not found');
    }
    return this.toDetail(order, role);
  }

  async listForBuyer(buyerId: string, cursor?: string): Promise<OrderPageDto> {
    const decoded = cursor ? decodeOrderCursor(cursor) : null;
    const orders = await this.orders.listForBuyer(
      buyerId,
      decoded,
      PAGE_SIZE + 1,
    );
    return this.toPage(orders, OrderActor.Buyer);
  }

  async listForSeller(
    sellerId: string,
    filters: SalesFilters,
    cursor?: string,
  ): Promise<OrderPageDto> {
    const decoded = cursor ? decodeOrderCursor(cursor) : null;
    const orders = await this.orders.listForSeller(
      sellerId,
      filters,
      decoded,
      PAGE_SIZE + 1,
    );
    return this.toPage(orders, OrderActor.Seller);
  }

  reportPayment(buyerId: string, id: string): Promise<OrderDetailDto> {
    return this.change(buyerId, id, OrderActor.Buyer, (order) =>
      Promise.resolve({
        paymentStatus: nextPaymentStatus(order, 'report'),
        reportedAt: new Date(),
      }),
    );
  }

  confirmPayment(sellerId: string, id: string): Promise<OrderDetailDto> {
    return this.change(sellerId, id, OrderActor.Seller, (order) =>
      Promise.resolve({
        paymentStatus: nextPaymentStatus(order, 'confirm'),
        paidAt: new Date(),
      }),
    );
  }

  rejectPayment(sellerId: string, id: string): Promise<OrderDetailDto> {
    return this.change(sellerId, id, OrderActor.Seller, (order) =>
      Promise.resolve({
        paymentStatus: nextPaymentStatus(order, 'reject'),
        reportedAt: null,
      }),
    );
  }

  deliver(sellerId: string, id: string): Promise<OrderDetailDto> {
    return this.change(sellerId, id, OrderActor.Seller, (order) => {
      assertCanDeliver(order);
      return Promise.resolve({
        fulfillmentStatus: FulfillmentStatus.Delivered,
        deliveredAt: new Date(),
      });
    });
  }

  async cancel(
    userId: string,
    id: string,
    reason?: string | null,
  ): Promise<OrderDetailDto> {
    const trimmed = reason?.trim() || null;
    const result = await this.change(
      userId,
      id,
      null,
      async (order, actor, tx) => {
        if (actor === OrderActor.Seller && !trimmed) {
          throw new BadRequestException(
            'A seller must give a reason to cancel',
          );
        }
        const now = new Date();
        assertCanCancel(order, actor, {
          now,
          orderDeadline: order.listing.orderDeadline,
        });

        await this.listings.releaseStock(
          tx,
          order.lines.map((line) => ({
            itemId: line.listingItemId,
            quantity: line.quantity,
          })),
        );
        return {
          fulfillmentStatus: FulfillmentStatus.Cancelled,
          cancelledAt: now,
          cancelledBy: actor,
          cancelReason: trimmed,
          // A buyer can only cancel before paying, so only a seller's
          // cancellation can leave money to return.
          refundNeeded: actor === OrderActor.Seller && needsRefund(order),
        };
      },
    );
    await this.listings.invalidateCache();
    return result;
  }

  /**
   * Applies one state change with the order row locked, so two people acting
   * at once are handled one after the other and the rules see current state.
   */
  private async change(
    userId: string,
    id: string,
    allowed: OrderActor | null,
    decide: (order: Order, actor: OrderActor, tx: Tx) => Promise<OrderChanges>,
  ): Promise<OrderDetailDto> {
    await this.transactions.run(async (tx) => {
      const order = await this.orders.findForUpdate(tx, id);
      const actor = order ? actorOf(order, userId) : null;
      if (!order || !actor) {
        throw new NotFoundException('Order not found');
      }
      if (allowed && actor !== allowed) {
        throw new ForbiddenException(
          `Only the ${allowed} of this order can do that`,
        );
      }
      await this.orders.update(tx, id, await decide(order, actor, tx));
    });
    return this.getForParticipant(userId, id);
  }

  private async create(
    buyerId: string,
    input: PlaceOrderInput,
  ): Promise<string> {
    const listing = await this.listings.findById(input.listingId);
    if (!listing || !isListingOpen(listing, new Date())) {
      throw new DomainException(
        409,
        'LISTING_NOT_OPEN',
        'This listing is not open for orders',
      );
    }
    if (listing.sellerId === buyerId) {
      throw new DomainException(
        422,
        'OWN_LISTING',
        'You cannot order from your own listing',
      );
    }
    this.assertPaymentMethod(listing, input.paymentMethod);

    const deliveryLocation = input.deliveryLocation.trim();
    if (
      deliveryLocation.length === 0 ||
      deliveryLocation.length > ORDER_LIMITS.deliveryLocationMax
    ) {
      throw new BadRequestException(
        `deliveryLocation must be 1-${ORDER_LIMITS.deliveryLocationMax} characters`,
      );
    }
    const lines = this.buildLines(listing, input.lines);
    const isPreorder = listing.mode === ListingMode.Preorder;

    if (isPreorder) {
      const existing = await this.orders.findActivePreorder(
        listing.id,
        buyerId,
      );
      if (existing) {
        throw alreadyOrdered(existing.id);
      }
    }

    const qr = input.paymentMethod === PaymentMethod.PrepaidQr;
    const id = await this.insertWithUniqueCode(buyerId, listing, lines, {
      isPreorder,
      paymentMethod: input.paymentMethod,
      deliveryLocation,
      note: input.note?.trim() || null,
      sellerBankBin: qr ? listing.seller.bankBin : null,
      sellerBankAccountNumber: qr ? listing.seller.bankAccountNumber : null,
      sellerBankAccountName: qr ? listing.seller.bankAccountName : null,
    });

    const buyer = await this.users.getById(buyerId);
    if (!buyer.deliveryLocation) {
      await this.users.updateProfile(buyerId, { deliveryLocation });
    }
    await this.listings.invalidateCache();
    return id;
  }

  private assertPaymentMethod(listing: Listing, method: PaymentMethod): void {
    const accepted =
      method === PaymentMethod.PrepaidQr
        ? listing.acceptsPrepaidQr && this.users.hasBankProfile(listing.seller)
        : listing.acceptsPayOnDelivery;
    if (!accepted) {
      throw new DomainException(
        422,
        'PAYMENT_METHOD_NOT_ACCEPTED',
        'This listing does not accept that payment method',
      );
    }
  }

  /** Validates the requested lines and prices them from the listing's data. */
  private buildLines(
    listing: Listing,
    requested: PlaceOrderInput['lines'],
  ): NewOrderLine[] {
    const items = new Map(
      listing.items
        .filter((item) => item.isActive)
        .map((item) => [item.id, item]),
    );
    const problems: string[] = [];
    const seen = new Set<string>();
    const lines: NewOrderLine[] = [];

    if (requested.length < 1 || requested.length > ORDER_LIMITS.linesMax) {
      problems.push(`an order needs 1-${ORDER_LIMITS.linesMax} lines`);
    }
    requested.forEach((line, index) => {
      const item = items.get(line.itemId);
      if (!item) {
        problems.push(`line ${index + 1}: this item cannot be ordered`);
        return;
      }
      if (seen.has(item.id)) {
        problems.push(`line ${index + 1}: ${item.name} appears twice`);
        return;
      }
      seen.add(item.id);

      const problem = quantityProblem(line.quantity, item.unit);
      if (problem) {
        problems.push(`line ${index + 1}: ${problem}`);
        return;
      }
      lines.push({
        listingItemId: item.id,
        itemName: item.name,
        unit: item.unit,
        unitPrice: item.unitPrice,
        quantity: line.quantity,
        lineTotal: lineTotal(item.unitPrice, line.quantity),
        sortOrder: index,
      });
    });

    if (problems.length > 0) {
      throw new DomainException(422, 'INVALID_QUANTITY', problems.join('; '), {
        problems,
      });
    }
    return lines;
  }

  private async insertWithUniqueCode(
    buyerId: string,
    listing: Listing,
    lines: NewOrderLine[],
    fields: {
      isPreorder: boolean;
      paymentMethod: PaymentMethod;
      deliveryLocation: string;
      note: string | null;
      sellerBankBin: string | null;
      sellerBankAccountNumber: string | null;
      sellerBankAccountName: string | null;
    },
  ): Promise<string> {
    const totalAmount = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const names = new Map(listing.items.map((item) => [item.id, item.name]));

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.transactions.run(async (tx) => {
          const short = await this.listings.reserveStock(
            tx,
            lines.map((line) => ({
              itemId: line.listingItemId,
              quantity: line.quantity,
            })),
          );
          if (short.length > 0) {
            // Throwing rolls back every reservation made so far.
            throw new DomainException(
              409,
              'OUT_OF_STOCK',
              'Some items do not have enough stock',
              {
                items: short.map((item) => ({
                  itemId: item.itemId,
                  name: names.get(item.itemId),
                  available: Number(item.available),
                })),
              },
            );
          }
          return this.orders.insert(
            tx,
            {
              ...fields,
              code: generateOrderCode(),
              listingId: listing.id,
              buyerId,
              sellerId: listing.sellerId,
              totalAmount,
              // Set here, in milliseconds, so list cursors compare exactly.
              createdAt: new Date(),
            },
            lines,
          );
        });
      } catch (error) {
        if (!(error instanceof OrderConflictError)) {
          throw error;
        }
        if (error.kind === 'active-preorder') {
          const existing = await this.orders.findActivePreorder(
            listing.id,
            buyerId,
          );
          throw alreadyOrdered(existing?.id);
        }
        // A code collision: the transaction rolled back, try a new code.
        if (attempt >= CODE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  private toPage(orders: Order[], role: OrderActor): OrderPageDto {
    const page = orders.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map((order) => this.toDetail(order, role)),
      nextCursor:
        orders.length > PAGE_SIZE && last
          ? encodeOrderCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  private toDetail(order: Order, role: OrderActor): OrderDetailDto {
    return OrderDetailDto.from(order, role, this.qrFor(order));
  }

  /** The transfer details, while a QR order is still waiting to be paid. */
  private qrFor(order: Order): OrderQrDto | null {
    if (
      order.paymentMethod !== PaymentMethod.PrepaidQr ||
      order.paymentStatus === PaymentStatus.Paid ||
      order.fulfillmentStatus === FulfillmentStatus.Cancelled ||
      !order.sellerBankBin ||
      !order.sellerBankAccountNumber ||
      !order.sellerBankAccountName ||
      order.totalAmount <= 0
    ) {
      return null;
    }
    return {
      payload: buildVietQrPayload({
        bankBin: order.sellerBankBin,
        accountNumber: order.sellerBankAccountNumber,
        amount: order.totalAmount,
        content: order.code,
      }),
      bankName:
        this.banks.findByBin(order.sellerBankBin)?.shortName ??
        order.sellerBankBin,
      accountNumber: order.sellerBankAccountNumber,
      accountName: order.sellerBankAccountName,
      amount: order.totalAmount,
      content: order.code,
    };
  }
}

function actorOf(order: Order, userId: string): OrderActor | null {
  if (order.buyerId === userId) {
    return OrderActor.Buyer;
  }
  return order.sellerId === userId ? OrderActor.Seller : null;
}

function alreadyOrdered(orderId: string | undefined): DomainException {
  return new DomainException(
    409,
    'ALREADY_ORDERED',
    'You already have an order on this pre-order listing',
    { orderId },
  );
}
