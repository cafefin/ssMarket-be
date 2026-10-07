import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { ListingItem } from '../listings/listing-item.entity.js';

/**
 * One option in a person's cart. No price is stored: the cart always shows
 * the listing's current price, and checkout fixes it on the order.
 */
@Entity('cart_lines')
export class CartLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'listing_item_id', type: 'uuid' })
  listingItemId!: string;

  @ManyToOne(() => ListingItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_item_id' })
  item!: Relation<ListingItem>;

  /** Decimal string with up to 3 fraction digits. */
  @Column({ type: 'numeric', precision: 10, scale: 3 })
  quantity!: string;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt!: Date;
}
