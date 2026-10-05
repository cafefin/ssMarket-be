import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Listing } from './listing.entity.js';

@Entity('listing_images')
export class ListingImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'listing_id', type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => Listing, (listing) => listing.images, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'listing_id' })
  listing!: Relation<Listing>;

  /** Key of the full-size file; the thumbnail key is derived from it. */
  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey!: string;

  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
