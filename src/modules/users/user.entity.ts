import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  User = 'user',
  Admin = 'admin',
}

/** The language of the interface and of files generated for this person. */
export enum UserLocale {
  Vi = 'vi',
  En = 'en',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ name: 'google_id', type: 'varchar', length: 255, unique: true })
  googleId!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'users_role_enum',
    default: UserRole.User,
  })
  role!: UserRole;

  @Column({ type: 'varchar', length: 2, default: UserLocale.Vi })
  locale!: UserLocale;

  @Column({
    name: 'delivery_location',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  deliveryLocation!: string | null;

  @Column({ name: 'bank_bin', type: 'varchar', length: 6, nullable: true })
  bankBin!: string | null;

  @Column({
    name: 'bank_account_number',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  bankAccountNumber!: string | null;

  @Column({
    name: 'bank_account_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  bankAccountName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
