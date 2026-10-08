import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Listing } from '../listings/listing.entity.js';

/**
 * One product in a person's cart. No price is stored: the cart always shows
 * the listing's current price, and checkout fixes it on the order.
 */
@Entity('cart_lines')
export class CartLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'listing_id', type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => Listing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing!: Relation<Listing>;

  /** Decimal string with up to 3 fraction digits. */
  @Column({ type: 'numeric', precision: 10, scale: 3 })
  quantity!: string;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt!: Date;
}
