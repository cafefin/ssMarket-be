import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Reference data, created and changed only through migrations. */
@Entity('categories')
export class Category {
  @PrimaryColumn({ type: 'smallint' })
  id!: number;

  @Column({ type: 'varchar', length: 40, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder!: number;
}
