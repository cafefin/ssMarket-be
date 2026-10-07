import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Listing } from '../listings/listing.entity.js';
import { User } from '../users/user.entity.js';
import { OrderLine } from './order-line.entity.js';
import {
  FulfillmentStatus,
  OrderActor,
  PaymentMethod,
  PaymentStatus,
} from './orders.constants.js';

/** PostgreSQL bigint arrives as a string; totals fit safely in a JS number. */
const bigintAsNumber = {
  to: (value: number): number => value,
  from: (value: string): number => Number(value),
};

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Short reference such as "SSM7K2Q9X"; the bank transfer content. */
  @Column({ type: 'varchar', length: 9, unique: true })
  code!: string;

  /**
   * The pre-order round this order belongs to. Null for an in-stock order,
   * whose lines may come from several listings of the same seller.
   */
  @Column({ name: 'listing_id', type: 'uuid', nullable: true })
  listingId!: string | null;

  @ManyToOne(() => Listing, { nullable: true })
  @JoinColumn({ name: 'listing_id' })
  listing!: Relation<Listing> | null;

  @Column({ name: 'buyer_id', type: 'uuid' })
  buyerId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'buyer_id' })
  buyer!: Relation<User>;

  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'seller_id' })
  seller!: Relation<User>;

  @Column({ name: 'is_preorder', type: 'boolean' })
  isPreorder!: boolean;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
    enumName: 'orders_payment_method_enum',
  })
  paymentMethod!: PaymentMethod;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'orders_payment_status_enum',
    default: PaymentStatus.Unpaid,
  })
  paymentStatus!: PaymentStatus;

  @Column({
    name: 'fulfillment_status',
    type: 'enum',
    enum: FulfillmentStatus,
    enumName: 'orders_fulfillment_status_enum',
    default: FulfillmentStatus.Pending,
  })
  fulfillmentStatus!: FulfillmentStatus;

  /** Integer VND. */
  @Column({ name: 'total_amount', type: 'bigint', transformer: bigintAsNumber })
  totalAmount!: number;

  @Column({ name: 'delivery_location', type: 'varchar', length: 120 })
  deliveryLocation!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  // The seller's bank details as they were when the order was placed, so a
  // later profile change cannot redirect a payment that is already under way.
  @Column({
    name: 'seller_bank_bin',
    type: 'varchar',
    length: 6,
    nullable: true,
  })
  sellerBankBin!: string | null;

  @Column({
    name: 'seller_bank_account_number',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  sellerBankAccountNumber!: string | null;

  @Column({
    name: 'seller_bank_account_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  sellerBankAccountName!: string | null;

  @Column({
    name: 'cancelled_by',
    type: 'enum',
    enum: OrderActor,
    enumName: 'orders_cancelled_by_enum',
    nullable: true,
  })
  cancelledBy!: OrderActor | null;

  @Column({
    name: 'cancel_reason',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  cancelReason!: string | null;

  @Column({ name: 'refund_needed', type: 'boolean', default: false })
  refundNeeded!: boolean;

  @Column({ name: 'reported_at', type: 'timestamptz', nullable: true })
  reportedAt!: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => OrderLine, (line) => line.order)
  lines!: Relation<OrderLine[]>;
}
