import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { User, UserRole } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { GoogleIdentity } from './auth.types.js';
import type { RefreshTokenStore } from './refresh-token.store.js';

const user = Object.assign(new User(), {
  id: 'user-1',
  email: 'an@example.com',
  name: 'An',
  avatarUrl: null,
  googleId: 'google-1',
  role: UserRole.User,
});

const identity: GoogleIdentity = {
  googleId: 'google-1',
  email: 'An@Example.com',
  emailVerified: true,
  hostedDomain: 'example.com',
  name: 'An',
  avatarUrl: null,
};

describe('AuthService', () => {
  const users = {
    upsertFromGoogle: vi.fn(),
    findById: vi.fn(),
    syncRole: vi.fn(),
  };
  const jwt = { signAsync: vi.fn() };
  const refreshTokens = { issue: vi.fn(), consume: vi.fn(), revoke: vi.fn() };
  let service: AuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    users.upsertFromGoogle.mockResolvedValue(user);
    users.findById.mockResolvedValue(user);
    users.syncRole.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );
    jwt.signAsync.mockResolvedValue('access-jwt');
    refreshTokens.issue.mockResolvedValue('refresh-token');
    const config = { get: () => 'Example.com' };

    service = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      refreshTokens as unknown as RefreshTokenStore,
      config as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  describe('toAllowedProfile', () => {
    it('accepts a verified email on the allowed domain, ignoring case', () => {
      expect(service.toAllowedProfile(identity)).toEqual({
        googleId: 'google-1',
        email: 'an@example.com',
        name: 'An',
        avatarUrl: null,
      });
    });

    it.each<[string, Partial<GoogleIdentity>]>([
      ['an unverified email', { emailVerified: false }],
      ['a different hosted domain', { hostedDomain: 'other.com' }],
      ['a personal account without a hosted domain', { hostedDomain: null }],
      ['an email on another domain', { email: 'an@other.com' }],
      ['a lookalike domain', { email: 'an@example.com.evil.com' }],
    ])('rejects %s', (_label, overrides) => {
      expect(
        service.toAllowedProfile({ ...identity, ...overrides }),
      ).toBeNull();
    });
  });

  it('login upserts the user and issues both tokens', async () => {
    const profile = {
      googleId: 'google-1',
      email: 'an@example.com',
      name: 'An',
      avatarUrl: null,
    };

    const tokens = await service.login(profile);

    expect(users.upsertFromGoogle).toHaveBeenCalledWith(profile);
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'an@example.com',
      role: UserRole.User,
    });
    expect(refreshTokens.issue).toHaveBeenCalledWith('user-1');
    expect(tokens).toEqual({
      accessToken: 'access-jwt',
      refreshToken: 'refresh-token',
    });
  });

  describe('refresh', () => {
    it('rejects a missing token', async () => {
      await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.consume).not.toHaveBeenCalled();
    });

    it('rejects an unknown or already used token', async () => {
      refreshTokens.consume.mockResolvedValue(null);

      await expect(service.refresh('used')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token whose user no longer exists', async () => {
      refreshTokens.consume.mockResolvedValue('user-1');
      users.findById.mockResolvedValue(null);

      await expect(service.refresh('token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('consumes the old token and issues a new pair', async () => {
      refreshTokens.consume.mockResolvedValue('user-1');

      const tokens = await service.refresh('old-token');

      expect(refreshTokens.consume).toHaveBeenCalledWith('old-token');
      expect(tokens).toEqual({
        accessToken: 'access-jwt',
        refreshToken: 'refresh-token',
      });
    });

    it('signs the refreshed token with the role from syncRole', async () => {
      refreshTokens.consume.mockResolvedValue('user-1');
      users.syncRole.mockResolvedValue(
        Object.assign(new User(), user, { role: UserRole.Admin }),
      );

      await service.refresh('old-token');

      expect(users.syncRole).toHaveBeenCalledWith(user);
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, role: UserRole.Admin }),
      );
    });
  });

  describe('logout', () => {
    it('revokes the refresh token', async () => {
      await service.logout('token');

      expect(refreshTokens.revoke).toHaveBeenCalledWith('token');
    });

    it('does nothing without a token', async () => {
      await service.logout(undefined);

      expect(refreshTokens.revoke).not.toHaveBeenCalled();
    });
  });
});
