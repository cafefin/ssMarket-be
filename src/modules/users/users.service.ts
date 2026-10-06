import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseAdminEmails } from '../../config/admin-emails.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { stripDiacritics } from '../../common/text/normalize.js';
import { BanksService } from '../banks/banks.service.js';
import { type User, type UserLocale, UserRole } from './user.entity.js';
import { UsersRepository } from './users.repository.js';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Absent fields are left unchanged; null clears a field. */
export interface UpdateProfileInput {
  deliveryLocation?: string | null;
  bankBin?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  locale?: UserLocale;
}

@Injectable()
export class UsersService {
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly users: UsersRepository,
    private readonly banks: BanksService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.adminEmails = parseAdminEmails(
      config.get('ADMIN_EMAILS', { infer: true }),
    );
  }

  /**
   * Creates or refreshes the account at sign-in. The role follows
   * ADMIN_EMAILS on every sign-in, so removing an email there takes the
   * role away the next time that person signs in.
   */
  async upsertFromGoogle(profile: GoogleProfile): Promise<User> {
    const existing = await this.users.findByGoogleId(profile.googleId);
    const email = profile.email.toLowerCase();

    return this.users.save({
      // Passing the existing id turns the save into an update.
      id: existing?.id,
      googleId: profile.googleId,
      email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      role: this.roleFor(email),
    });
  }

  /**
   * Re-applies ADMIN_EMAILS to an existing user, saving only when the role
   * changed. Called when tokens are refreshed.
   */
  async syncRole(user: User): Promise<User> {
    const role = this.roleFor(user.email);
    if (user.role === role) {
      return user;
    }
    user.role = role;
    return this.users.save(user);
  }

  private roleFor(email: string): UserRole {
    return this.adminEmails.has(email.toLowerCase())
      ? UserRole.Admin
      : UserRole.User;
  }

  findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  async getById(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<User> {
    const user = await this.getById(userId);

    if (input.deliveryLocation !== undefined) {
      user.deliveryLocation = input.deliveryLocation?.trim() || null;
    }
    // null is ignored: a person always has a language.
    if (input.locale) {
      user.locale = input.locale;
    }
    this.applyBankDetails(user, input);

    return this.users.save(user);
  }

  /** A seller needs this before a listing may accept QR payments. */
  hasBankProfile(user: User): boolean {
    return Boolean(
      user.bankBin && user.bankAccountNumber && user.bankAccountName,
    );
  }

  private applyBankDetails(user: User, input: UpdateProfileInput): void {
    const fields = [
      input.bankBin,
      input.bankAccountNumber,
      input.bankAccountName,
    ];
    if (fields.every((field) => field === undefined)) {
      return;
    }

    const allNull = fields.every((field) => field === null);
    const allSet = fields.every((field) => typeof field === 'string');
    if (!allNull && !allSet) {
      throw new BadRequestException(
        'bankBin, bankAccountNumber and bankAccountName must be sent together',
      );
    }

    if (allNull) {
      user.bankBin = null;
      user.bankAccountNumber = null;
      user.bankAccountName = null;
      return;
    }

    const [bankBin, bankAccountNumber, bankAccountName] = fields as string[];
    if (!this.banks.exists(bankBin)) {
      throw new BadRequestException('Unknown bank');
    }

    user.bankBin = bankBin;
    user.bankAccountNumber = bankAccountNumber;
    // Bank transfers carry the holder name in unaccented upper case.
    user.bankAccountName = stripDiacritics(bankAccountName)
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
