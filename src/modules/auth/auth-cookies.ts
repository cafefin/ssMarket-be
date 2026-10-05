import type { CookieOptions, Response } from 'express';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants.js';
import type { TokenPair } from './auth.types.js';

function baseOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure };
}

export function setAuthCookies(
  res: Response,
  tokens: TokenPair,
  secure: boolean,
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions(secure),
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(secure),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response, secure: boolean): void {
  res.clearCookie(ACCESS_COOKIE, baseOptions(secure));
  res.clearCookie(REFRESH_COOKIE, baseOptions(secure));
}
