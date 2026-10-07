import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { ListingItemCombo } from './listing-item-combo.entity.js';
import { Listing } from './listing.entity.js';

@Entity('listing_items')
export class ListingItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'listing_id', type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => Listing, (listing) => listing.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing!: Relation<Listing>;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  /** Integer VND. */
  @Column({ name: 'unit_price', type: 'integer' })
  unitPrice!: number;

  /** PostgreSQL numeric arrives as a string; null means unlimited. */
  @Column({
    name: 'stock_quantity',
    type: 'numeric',
    precision: 10,
    scale: 3,
    nullable: true,
  })
  stockQuantity!: string | null;

  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder!: number;

  /**
   * False once the seller removes an item that people have already ordered.
   * It stays for those orders but is hidden and cannot be ordered again.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => ListingItemCombo, (combo) => combo.item)
  combos!: Relation<ListingItemCombo[]>;
}
