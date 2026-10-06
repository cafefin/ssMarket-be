import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** A listing category. Admins add, rename and hide them; nothing deletes one. */
@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('identity', {
    type: 'smallint',
    generatedIdentity: 'BY DEFAULT',
  })
  id!: number;

  /** Made from the Vietnamese name when created; never changes afterwards. */
  @Column({ type: 'varchar', length: 40, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'name_en', type: 'varchar', length: 80 })
  nameEn!: string;

  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder!: number;

  /** A hidden category keeps its listings but takes no new ones. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}
