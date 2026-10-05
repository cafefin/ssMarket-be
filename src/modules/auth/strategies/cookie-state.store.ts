import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { readCookie } from '../../../common/http/read-cookie.js';
import { OAUTH_STATE_COOKIE } from '../auth.constants.js';

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (err: Error | null, ok?: boolean) => void;

/**
 * Keeps the OAuth `state` value in a cookie so the app needs no server-side
 * session. passport-oauth2 picks the call signature from each method's arity:
 * `store` must take exactly 2 parameters and `verify` exactly 3.
 */
export class CookieStateStore {
  constructor(private readonly secure: boolean) {}

  store(req: Request, callback: StoreCallback): void {
    const state = randomBytes(16).toString('base64url');
    req.res?.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secure,
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    callback(null, state);
  }

  verify(req: Request, providedState: string, callback: VerifyCallback): void {
    const expected = readCookie(req, OAUTH_STATE_COOKIE);
    req.res?.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
    callback(null, Boolean(expected) && expected === providedState);
  }
}
