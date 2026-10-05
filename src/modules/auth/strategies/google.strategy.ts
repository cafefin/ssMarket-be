import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  type Profile,
  Strategy,
  type StrategyOptions,
} from 'passport-google-oauth20';
import {
  type EnvironmentVariables,
  NodeEnv,
} from '../../../config/env.validation.js';
import type { GoogleIdentity } from '../auth.types.js';
import { CookieStateStore } from './cookie-state.store.js';

function buildOptions(
  config: ConfigService<EnvironmentVariables, true>,
): StrategyOptions {
  const secure = config.get('NODE_ENV', { infer: true }) === NodeEnv.Production;

  return {
    clientID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
    clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
    // The browser reaches this API through the frontend's /api proxy, so the
    // redirect URI registered with Google is on the frontend origin.
    callbackURL: `${config.get('WEB_URL', { infer: true })}/api/auth/google/callback`,
    scope: ['openid', 'email', 'profile'],
    // The published StateStore type declares overloads that a 2-argument
    // implementation cannot satisfy, although the library supports it.
    store: new CookieStateStore(secure) as unknown as StrategyOptions['store'],
  };
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly allowedDomain: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super(buildOptions(config));
    this.allowedDomain = config.get('ALLOWED_EMAIL_DOMAIN', { infer: true });
  }

  // A hint for Google's account chooser only. AuthService.toAllowedProfile
  // does the real enforcement.
  override authorizationParams(): Record<string, string> {
    return { hd: this.allowedDomain };
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): GoogleIdentity {
    const json = profile._json;

    return {
      googleId: profile.id,
      email: json.email ?? '',
      emailVerified: json.email_verified === true,
      hostedDomain: json.hd ?? null,
      name: json.name ?? profile.displayName,
      avatarUrl: json.picture ?? null,
    };
  }
}
