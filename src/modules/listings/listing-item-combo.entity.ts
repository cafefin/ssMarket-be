import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { ListingItem } from './listing-item.entity.js';

/** "N units for a set price" on one option, e.g. 100 pieces for 900,000 đ. */
@Entity('listing_item_combos')
export class ListingItemCombo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'listing_item_id', type: 'uuid' })
  listingItemId!: string;

  @ManyToOne(() => ListingItem, (item) => item.combos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_item_id' })
  item!: Relation<ListingItem>;

  /** PostgreSQL numeric arrives as a string. */
  @Column({ type: 'numeric', precision: 10, scale: 3 })
  quantity!: string;

  /** The price of the whole combo, integer VND. */
  @Column({ type: 'integer' })
  price!: number;
}
