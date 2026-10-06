import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { AuthService } from '../auth/auth.service.js';
import { DevLoginController } from './dev-login.controller.js';
import { isDevLoginEnabled } from './dev-login.enabled.js';

describe('isDevLoginEnabled', () => {
  it('is on only in development with the explicit flag', () => {
    expect(
      isDevLoginEnabled({ NODE_ENV: 'development', DEV_LOGIN_ENABLED: 'true' }),
    ).toBe(true);
  });

  it.each([
    [
      'production with the flag',
      { NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' },
    ],
    ['test with the flag', { NODE_ENV: 'test', DEV_LOGIN_ENABLED: 'true' }],
    ['development without the flag', { NODE_ENV: 'development' }],
    [
      'development with the flag off',
      { NODE_ENV: 'development', DEV_LOGIN_ENABLED: 'false' },
    ],
    [
      'a truthy-looking flag',
      { NODE_ENV: 'development', DEV_LOGIN_ENABLED: '1' },
    ],
    ['no NODE_ENV', { DEV_LOGIN_ENABLED: 'true' }],
    ['nothing set', {}],
  ])('is off for %s', (_label, env) => {
    expect(isDevLoginEnabled(env)).toBe(false);
  });
});

describe('DevLoginController', () => {
  const auth = { login: vi.fn() };
  const res = { cookie: vi.fn(), redirect: vi.fn() };
  let controller: DevLoginController;

  beforeEach(() => {
    vi.resetAllMocks();
    auth.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    controller = new DevLoginController(
      auth as unknown as AuthService,
      { get: () => 'http://localhost:3000' } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
    );
  });

  it('signs in as a clearly fake account and returns to the web app', async () => {
    await controller.signIn('buyer', res as unknown as Response);

    expect(auth.login).toHaveBeenCalledWith({
      googleId: 'dev-buyer',
      email: 'buyer@dev.invalid',
      name: 'Dev buyer',
      avatarUrl: null,
    });
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'a',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/');
  });

  it.each([
    undefined,
    '',
    'Has Space',
    'UPPER',
    'a@b.c',
    "x'; DROP",
    'a'.repeat(31),
  ])('rejects the name %j', async (name) => {
    await expect(
      controller.signIn(name, res as unknown as Response),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.login).not.toHaveBeenCalled();
  });
});
