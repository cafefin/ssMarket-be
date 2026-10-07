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
import {
  type Combo,
  lineTotal,
  lineTotalWithCombos,
  quantityProblem,
} from './order-math.js';
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

export type EditOrderInput = Omit<PlaceOrderInput, 'listingId'>;

/** Price and labels of a line as they were when the order was placed. */
interface LineSnapshot {
  itemName: string;
  unit: string;
  unitPrice: number;
  combos: Combo[];
}

export interface PlaceOrderInput {
  listingId: string;
  lines: { itemId: string; quantity: string }[];
  paymentMethod: PaymentMethod;
  deliveryLocation: string;
  note?: string | null;
}

/**
 * One order to create: lines from a single pre-order listing, or from one or
 * more in-stock listings of the same seller.
 */
export interface OrderRequest {
  lines: { listingId: string; itemId: string; quantity: string }[];
  paymentMethod: PaymentMethod;
  deliveryLocation: string;
  note?: string | null;
}

/** A validated, priced order that is ready to be inserted. */
interface OrderPlan {
  seller: Listing['seller'];
  /** Set for a pre-order: the round the order belongs to. */
  preorderListingId: string | null;
  lines: NewOrderLine[];
  /** Option id -> name, to explain a shortage. */
  itemNames: Map<string, string>;
  paymentMethod: PaymentMethod;
  deliveryLocation: string;
  note: string | null;
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
        const [id] = await this.createMany(buyerId, [
          {
            ...input,
            lines: input.lines.map((line) => ({
              ...line,
              listingId: input.listingId,
            })),
          },
        ]);
        return { id, value: id };
      },
      (id) => Promise.resolve(id),
    );
    return { order: await this.getForParticipant(buyerId, value), replayed };
  }

  /**
   * Creates several orders at once, for a checkout: all of them or none.
   * Stock for every line is reserved in one transaction, so a shortage on
   * any line leaves stock and orders untouched. `withinTransaction` runs in
   * the same transaction after the inserts (the cart removes what was
   * bought). Returns the new order ids in request order.
   */
  async createMany(
    buyerId: string,
    requests: OrderRequest[],
    withinTransaction?: (tx: Tx) => Promise<void>,
  ): Promise<string[]> {
    if (requests.length === 0) {
      throw new BadRequestException('Nothing to order');
    }
    const plans: OrderPlan[] = [];
    for (const request of requests) {
      plans.push(await this.plan(buyerId, request));
    }

    const ids = await this.insertWithUniqueCodes(
      buyerId,
      plans,
      withinTransaction,
    );

    const buyer = await this.users.getById(buyerId);
    if (!buyer.deliveryLocation) {
      await this.users.updateProfile(buyerId, {
        deliveryLocation: plans[0].deliveryLocation,
      });
    }
    await this.listings.invalidateCache();
    return ids;
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

  /**
   * Lets a buyer change a pre-order until its deadline, like editing their
   * row in the spreadsheet this replaces. Items already in the order keep
   * the price they were ordered at; items added now use the current price.
   */
  async edit(
    buyerId: string,
    id: string,
    input: EditOrderInput,
  ): Promise<OrderDetailDto> {
    await this.transactions.run(async (tx) => {
      const order = await this.orders.findForUpdate(tx, id);
      const actor = order ? actorOf(order, buyerId) : null;
      if (!order || !actor) {
        throw new NotFoundException('Order not found');
      }
      if (actor !== OrderActor.Buyer) {
        throw new ForbiddenException('Only the buyer can edit an order');
      }
      const reason = editBlocker(order, new Date());
      if (reason) {
        throw new DomainException(
          409,
          'ORDER_NOT_EDITABLE',
          `This order can no longer be edited (${reason})`,
          { reason },
        );
      }

      // Only pre-orders can be edited, and they always have their listing.
      const listing = order.listingId
        ? await this.listings.findById(order.listingId)
        : null;
      if (!listing) {
        throw new NotFoundException('Listing not found');
      }
      this.assertPaymentMethod(listing, input.paymentMethod);
      const deliveryLocation = this.cleanDeliveryLocation(
        input.deliveryLocation,
      );
      const lines = this.buildLines(
        listing,
        input.lines,
        new Map(
          order.lines.map((line) => [
            line.listingItemId,
            {
              itemName: line.itemName,
              unit: line.unit,
              unitPrice: line.unitPrice,
              combos: line.combos,
            },
          ]),
        ),
      );

      const qr = input.paymentMethod === PaymentMethod.PrepaidQr;
      await this.orders.replaceLines(tx, id, lines, {
        totalAmount: lines.reduce((sum, line) => sum + line.lineTotal, 0),
        paymentMethod: input.paymentMethod,
        deliveryLocation,
        note: input.note?.trim() || null,
        sellerBankBin: qr ? listing.seller.bankBin : null,
        sellerBankAccountNumber: qr ? listing.seller.bankAccountNumber : null,
        sellerBankAccountName: qr ? listing.seller.bankAccountName : null,
      });
    });
    await this.listings.invalidateCache();
    return this.getForParticipant(buyerId, id);
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
          orderDeadline: order.listing?.orderDeadline ?? null,
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

  /** Checks one order request against its listings and prices it. */
  private async plan(
    buyerId: string,
    request: OrderRequest,
  ): Promise<OrderPlan> {
    const listingIds = [
      ...new Set(request.lines.map((line) => line.listingId)),
    ];
    const now = new Date();
    const listings: Listing[] = [];
    for (const id of listingIds) {
      const listing = await this.listings.findById(id);
      if (!listing || !isListingOpen(listing, now)) {
        throw new DomainException(
          409,
          'LISTING_NOT_OPEN',
          'This listing is not open for orders',
          { listingId: id },
        );
      }
      if (listing.sellerId === buyerId) {
        throw new DomainException(
          422,
          'OWN_LISTING',
          'You cannot order from your own listing',
        );
      }
      listings.push(listing);
    }
    if (listings.length === 0) {
      throw new BadRequestException('An order needs at least one line');
    }
    if (new Set(listings.map((listing) => listing.sellerId)).size > 1) {
      throw new BadRequestException('One order holds one seller’s goods');
    }
    const preorder = listings.find(
      (listing) => listing.mode === ListingMode.Preorder,
    );
    if (preorder && listings.length > 1) {
      throw new BadRequestException(
        'A pre-order is ordered on its own, one order per round',
      );
    }
    for (const listing of listings) {
      this.assertPaymentMethod(listing, request.paymentMethod);
    }

    if (
      request.lines.length < 1 ||
      request.lines.length > ORDER_LIMITS.linesMax
    ) {
      throw new DomainException(
        422,
        'INVALID_QUANTITY',
        `an order needs 1-${ORDER_LIMITS.linesMax} lines`,
        { problems: [`an order needs 1-${ORDER_LIMITS.linesMax} lines`] },
      );
    }
    const lines: NewOrderLine[] = [];
    for (const listing of listings) {
      lines.push(
        ...this.buildLines(
          listing,
          request.lines.filter((line) => line.listingId === listing.id),
        ),
      );
    }
    lines.forEach((line, index) => {
      line.sortOrder = index;
    });

    if (preorder) {
      const existing = await this.orders.findActivePreorder(
        preorder.id,
        buyerId,
      );
      if (existing) {
        throw alreadyOrdered(existing.id);
      }
    }

    return {
      seller: listings[0].seller,
      preorderListingId: preorder?.id ?? null,
      lines,
      itemNames: new Map(
        listings.flatMap((listing) =>
          listing.items.map((item) => [item.id, item.name] as const),
        ),
      ),
      paymentMethod: request.paymentMethod,
      deliveryLocation: this.cleanDeliveryLocation(request.deliveryLocation),
      note: request.note?.trim() || null,
    };
  }

  private cleanDeliveryLocation(value: string): string {
    const deliveryLocation = value.trim();
    if (
      deliveryLocation.length === 0 ||
      deliveryLocation.length > ORDER_LIMITS.deliveryLocationMax
    ) {
      throw new BadRequestException(
        `deliveryLocation must be 1-${ORDER_LIMITS.deliveryLocationMax} characters`,
      );
    }
    return deliveryLocation;
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

  /**
   * Validates the requested lines and prices them from the listing's data.
   * When editing, `snapshots` holds the lines the order already has: those
   * items stay orderable at their original price even if the seller has
   * since changed or removed them.
   */
  private buildLines(
    listing: Listing,
    requested: PlaceOrderInput['lines'],
    snapshots: Map<string, LineSnapshot> = new Map(),
  ): NewOrderLine[] {
    const items = new Map<string, LineSnapshot & { id: string }>();
    for (const item of listing.items) {
      const snapshot = snapshots.get(item.id);
      if (snapshot) {
        items.set(item.id, { id: item.id, ...snapshot });
      } else if (item.isActive) {
        items.set(item.id, {
          id: item.id,
          itemName: item.name,
          unit: item.unit,
          unitPrice: item.unitPrice,
          combos: (item.combos ?? []).map((combo) => ({
            quantity: String(Number(combo.quantity)),
            price: combo.price,
          })),
        });
      }
    }
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
        problems.push(`line ${index + 1}: ${item.itemName} appears twice`);
        return;
      }
      seen.add(item.id);

      const problem = quantityProblem(line.quantity, item.unit);
      if (problem) {
        problems.push(`line ${index + 1}: ${problem}`);
        return;
      }
      lines.push({
        listingId: listing.id,
        listingItemId: item.id,
        itemName: item.itemName,
        unit: item.unit,
        unitPrice: item.unitPrice,
        quantity: line.quantity,
        lineTotal: lineTotalWithCombos(
          item.unitPrice,
          item.combos,
          line.quantity,
        ),
        listTotal: lineTotal(item.unitPrice, line.quantity),
        combos: item.combos,
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

  private async insertWithUniqueCodes(
    buyerId: string,
    plans: OrderPlan[],
    withinTransaction?: (tx: Tx) => Promise<void>,
  ): Promise<string[]> {
    const names = new Map(plans.flatMap((plan) => [...plan.itemNames]));

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.transactions.run(async (tx) => {
          const short = await this.listings.reserveStock(
            tx,
            plans.flatMap((plan) =>
              plan.lines.map((line) => ({
                itemId: line.listingItemId,
                quantity: line.quantity,
              })),
            ),
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
          const ids: string[] = [];
          for (const plan of plans) {
            const qr = plan.paymentMethod === PaymentMethod.PrepaidQr;
            ids.push(
              await this.orders.insert(
                tx,
                {
                  code: generateOrderCode(),
                  listingId: plan.preorderListingId,
                  buyerId,
                  sellerId: plan.seller.id,
                  isPreorder: plan.preorderListingId !== null,
                  paymentMethod: plan.paymentMethod,
                  deliveryLocation: plan.deliveryLocation,
                  note: plan.note,
                  sellerBankBin: qr ? plan.seller.bankBin : null,
                  sellerBankAccountNumber: qr
                    ? plan.seller.bankAccountNumber
                    : null,
                  sellerBankAccountName: qr
                    ? plan.seller.bankAccountName
                    : null,
                  totalAmount: plan.lines.reduce(
                    (sum, line) => sum + line.lineTotal,
                    0,
                  ),
                  // Set here, in milliseconds, so list cursors compare exactly.
                  createdAt: new Date(),
                },
                plan.lines,
              ),
            );
          }
          await withinTransaction?.(tx);
          return ids;
        });
      } catch (error) {
        if (!(error instanceof OrderConflictError)) {
          throw error;
        }
        if (error.kind === 'active-preorder') {
          for (const plan of plans) {
            if (plan.preorderListingId) {
              const existing = await this.orders.findActivePreorder(
                plan.preorderListingId,
                buyerId,
              );
              if (existing) {
                throw alreadyOrdered(existing.id);
              }
            }
          }
          throw alreadyOrdered(undefined);
        }
        // A code collision: the transaction rolled back, try new codes.
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

/** Why an order cannot be edited any more, or null when it still can. */
function editBlocker(order: Order, now: Date): string | null {
  if (!order.isPreorder) {
    return 'not_preorder';
  }
  if (order.fulfillmentStatus === FulfillmentStatus.Cancelled) {
    return 'cancelled';
  }
  if (order.fulfillmentStatus === FulfillmentStatus.Delivered) {
    return 'delivered';
  }
  if (order.paymentStatus !== PaymentStatus.Unpaid) {
    return 'payment_reported';
  }
  return order.listing && isListingOpen(order.listing, now)
    ? null
    : 'deadline_passed';
}

function alreadyOrdered(orderId: string | undefined): DomainException {
  return new DomainException(
    409,
    'ALREADY_ORDERED',
    'You already have an order on this pre-order listing',
    { orderId },
  );
}
