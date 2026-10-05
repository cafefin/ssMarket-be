import type { ConfigService } from '@nestjs/config';
import type { Profile } from 'passport-google-oauth20';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { GoogleStrategy } from './google.strategy.js';

const values: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  WEB_URL: 'http://localhost:3000',
  ALLOWED_EMAIL_DOMAIN: 'example.com',
  NODE_ENV: 'test',
};
const config = {
  get: (key: string) => values[key],
} as unknown as ConfigService<EnvironmentVariables, true>;

function profileWith(json: Record<string, unknown>): Profile {
  return {
    id: 'google-1',
    displayName: 'Display Name',
    _json: json,
  } as unknown as Profile;
}

describe('GoogleStrategy', () => {
  const strategy = new GoogleStrategy(config);

  it('asks Google to show only accounts on the company domain', () => {
    expect(strategy.authorizationParams()).toEqual({ hd: 'example.com' });
  });

  it('maps the Google profile to a GoogleIdentity', () => {
    const identity = strategy.validate(
      'access',
      'refresh',
      profileWith({
        email: 'an@example.com',
        email_verified: true,
        hd: 'example.com',
        name: 'An Nguyen',
        picture: 'https://img.example.com/a.png',
      }),
    );

    expect(identity).toEqual({
      googleId: 'google-1',
      email: 'an@example.com',
      emailVerified: true,
      hostedDomain: 'example.com',
      name: 'An Nguyen',
      avatarUrl: 'https://img.example.com/a.png',
    });
  });

  it('falls back safely when optional claims are absent', () => {
    const identity = strategy.validate('access', 'refresh', profileWith({}));

    expect(identity).toEqual({
      googleId: 'google-1',
      email: '',
      emailVerified: false,
      hostedDomain: null,
      name: 'Display Name',
      avatarUrl: null,
    });
  });
});
