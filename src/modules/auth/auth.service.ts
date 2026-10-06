import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { User } from '../users/user.entity.js';
import { type GoogleProfile, UsersService } from '../users/users.service.js';
import type {
  AccessTokenPayload,
  GoogleIdentity,
  TokenPair,
} from './auth.types.js';
import { RefreshTokenStore } from './refresh-token.store.js';

@Injectable()
export class AuthService {
  private readonly allowedDomain: string;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenStore,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.allowedDomain = config
      .get('ALLOWED_EMAIL_DOMAIN', { infer: true })
      .toLowerCase();
  }

  /**
   * Returns the profile only for a verified company account. All three checks
   * are required: the `hd` request parameter sent to Google is a UI hint and
   * can be removed by the client.
   */
  toAllowedProfile(identity: GoogleIdentity): GoogleProfile | null {
    const email = identity.email.toLowerCase();
    const emailDomain = email.slice(email.lastIndexOf('@') + 1);

    const allowed =
      identity.emailVerified &&
      identity.hostedDomain?.toLowerCase() === this.allowedDomain &&
      emailDomain === this.allowedDomain;

    if (!allowed) {
      return null;
    }

    return {
      googleId: identity.googleId,
      email,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
    };
  }

  async login(profile: GoogleProfile): Promise<TokenPair> {
    const user = await this.users.upsertFromGoogle(profile);
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string | undefined): Promise<TokenPair> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const userId = await this.refreshTokens.consume(refreshToken);
    if (!userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A role taken away in ADMIN_EMAILS must not outlive the next refresh.
    return this.issueTokens(await this.users.syncRole(user));
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.refreshTokens.revoke(refreshToken);
    }
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload),
      this.refreshTokens.issue(user.id),
    ]);

    return { accessToken, refreshToken };
  }
}
