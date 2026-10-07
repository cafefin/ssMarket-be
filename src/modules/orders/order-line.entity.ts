import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Order } from './order.entity.js';

/**
 * One ordered item. Name, unit and price are copied from the listing when
 * the order is placed, so later edits to the listing never change an order.
 */
@Entity('order_lines')
export class OrderLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, (order) => order.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Relation<Order>;

  @Column({ name: 'listing_item_id', type: 'uuid' })
  listingItemId!: string;

  @Column({ name: 'item_name', type: 'varchar', length: 120 })
  itemName!: string;

  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  @Column({ name: 'unit_price', type: 'integer' })
  unitPrice!: number;

  /** Decimal string with up to 3 fraction digits. */
  @Column({ type: 'numeric', precision: 10, scale: 3 })
  quantity!: string;

  @Column({
    name: 'line_total',
    type: 'bigint',
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  lineTotal!: number;

  /** unit price × quantity, before combos; equals lineTotal without them. */
  @Column({
    name: 'list_total',
    type: 'bigint',
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  listTotal!: number;

  /** The combos the line was priced with, copied like the unit price. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  combos!: { quantity: string; price: number }[];

  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder!: number;
}
