import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Listing } from './listing.entity.js';

/** "N units for a set price" on a product, e.g. 100 pieces for 900,000 đ. */
@Entity('listing_combos')
export class ListingCombo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'listing_id', type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => Listing, (listing) => listing.combos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'listing_id' })
  listing!: Relation<Listing>;

  /** PostgreSQL numeric arrives as a string. */
  @Column({ type: 'numeric', precision: 10, scale: 3 })
  quantity!: string;

  /** The price of the whole combo, integer VND. */
  @Column({ type: 'integer' })
  price!: number;
}
