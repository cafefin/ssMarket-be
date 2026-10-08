import { ApiProperty } from '@nestjs/swagger';
import { ComboDto } from '../../listings/dto/listing-response.dto.js';
import type { User } from '../../users/user.entity.js';
import type { OrderLine } from '../order-line.entity.js';
import type { Order } from '../order.entity.js';
import {
  FulfillmentStatus,
  OrderActor,
  PaymentMethod,
  PaymentStatus,
} from '../orders.constants.js';

export class OrderPersonDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  static from(user: User): OrderPersonDto {
    const dto = new OrderPersonDto();
    dto.id = user.id;
    dto.name = user.name;
    return dto;
  }
}

export class OrderListingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  orderDeadline!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  deliveryDate!: string | null;
}

export class OrderLineDto {
  @ApiProperty({ format: 'uuid' })
  listingId!: string;

  @ApiProperty({ description: 'The product title when it was ordered' })
  title!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty({
    description: 'Integer VND, as it was when the order was placed',
  })
  unitPrice!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ description: 'Integer VND, after combos' })
  lineTotal!: number;

  @ApiProperty({
    description:
      'unit price × quantity before combos; equals lineTotal without them',
  })
  listTotal!: number;

  @ApiProperty({
    type: [ComboDto],
    description: 'The combos the line was priced with',
  })
  combos!: ComboDto[];

  static from(line: OrderLine): OrderLineDto {
    const dto = new OrderLineDto();
    dto.listingId = line.listingId;
    dto.title = line.title;
    dto.unit = line.unit;
    dto.unitPrice = line.unitPrice;
    dto.quantity = Number(line.quantity);
    dto.lineTotal = line.lineTotal;
    dto.listTotal = line.listTotal;
    dto.combos = line.combos;
    return dto;
  }
}

export class OrderQrDto {
  @ApiProperty({ description: 'The text to render as a QR code' })
  payload!: string;

  @ApiProperty()
  bankName!: string;

  @ApiProperty()
  accountNumber!: string;

  @ApiProperty()
  accountName!: string;

  @ApiProperty({ description: 'Integer VND' })
  amount!: number;

  @ApiProperty({ description: 'Transfer content: the order code' })
  content!: string;
}

export class OrderDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'SSM7K2Q9X' })
  code!: string;

  @ApiProperty({
    type: OrderListingDto,
    description:
      'The pre-order round, or for an in-stock order the listing of its first line',
  })
  listing!: OrderListingDto;

  @ApiProperty({ description: 'How many listings the lines come from' })
  listingCount!: number;

  @ApiProperty({ type: OrderPersonDto })
  buyer!: OrderPersonDto;

  @ApiProperty({ type: OrderPersonDto })
  seller!: OrderPersonDto;

  @ApiProperty({ enum: OrderActor, enumName: 'OrderActor' })
  viewerRole!: OrderActor;

  @ApiProperty()
  isPreorder!: boolean;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  paymentMethod!: PaymentMethod;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  paymentStatus!: PaymentStatus;

  @ApiProperty({ enum: FulfillmentStatus, enumName: 'FulfillmentStatus' })
  fulfillmentStatus!: FulfillmentStatus;

  @ApiProperty({ description: 'Integer VND' })
  totalAmount!: number;

  @ApiProperty()
  deliveryLocation!: string;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: [OrderLineDto] })
  lines!: OrderLineDto[];

  @ApiProperty()
  refundNeeded!: boolean;

  @ApiProperty({ enum: OrderActor, enumName: 'OrderActor', nullable: true })
  cancelledBy!: OrderActor | null;

  @ApiProperty({ type: String, nullable: true })
  cancelReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: OrderQrDto,
    nullable: true,
    description: 'Present while a QR order is waiting for payment',
  })
  qr!: OrderQrDto | null;

  static from(
    order: Order,
    viewerRole: OrderActor,
    qr: OrderQrDto | null,
  ): OrderDetailDto {
    const dto = new OrderDetailDto();
    dto.id = order.id;
    dto.code = order.code;
    // A pre-order has its round; an in-stock order shows its first line's
    // listing here, and every line names its own.
    const listing = order.listing ?? order.lines[0].listing;
    dto.listing = {
      id: listing.id,
      title: listing.title,
      orderDeadline: listing.orderDeadline?.toISOString() ?? null,
      deliveryDate: listing.deliveryDate,
    };
    dto.listingCount = new Set(order.lines.map((line) => line.listingId)).size;
    dto.buyer = OrderPersonDto.from(order.buyer);
    dto.seller = OrderPersonDto.from(order.seller);
    dto.viewerRole = viewerRole;
    dto.isPreorder = order.isPreorder;
    dto.paymentMethod = order.paymentMethod;
    dto.paymentStatus = order.paymentStatus;
    dto.fulfillmentStatus = order.fulfillmentStatus;
    dto.totalAmount = order.totalAmount;
    dto.deliveryLocation = order.deliveryLocation;
    dto.note = order.note;
    dto.lines = order.lines.map((line) => OrderLineDto.from(line));
    dto.refundNeeded = order.refundNeeded;
    dto.cancelledBy = order.cancelledBy;
    dto.cancelReason = order.cancelReason;
    dto.createdAt = order.createdAt.toISOString();
    dto.qr = qr;
    return dto;
  }
}

export class OrderPageDto {
  @ApiProperty({ type: [OrderDetailDto] })
  items!: OrderDetailDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
