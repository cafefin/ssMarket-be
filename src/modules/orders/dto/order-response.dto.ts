import { ApiProperty } from '@nestjs/swagger';
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
  itemId!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty({
    description: 'Integer VND, as it was when the order was placed',
  })
  unitPrice!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ description: 'Integer VND' })
  lineTotal!: number;

  static from(line: OrderLine): OrderLineDto {
    const dto = new OrderLineDto();
    dto.itemId = line.listingItemId;
    dto.itemName = line.itemName;
    dto.unit = line.unit;
    dto.unitPrice = line.unitPrice;
    dto.quantity = Number(line.quantity);
    dto.lineTotal = line.lineTotal;
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

  @ApiProperty({ type: OrderListingDto })
  listing!: OrderListingDto;

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
    dto.listing = {
      id: order.listing.id,
      title: order.listing.title,
      orderDeadline: order.listing.orderDeadline?.toISOString() ?? null,
      deliveryDate: order.listing.deliveryDate,
    };
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
