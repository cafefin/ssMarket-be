import type { Request } from 'express';
import { CookieStateStore } from './cookie-state.store.js';

function fakeRequest(cookies: Record<string, string> = {}) {
  const res = { cookie: vi.fn(), clearCookie: vi.fn() };
  return { req: { cookies, res } as unknown as Request, res };
}

describe('CookieStateStore', () => {
  const store = new CookieStateStore(false);

  it('keeps the method arities passport-oauth2 dispatches on', () => {
    const { store: storeMethod, verify: verifyMethod } =
      CookieStateStore.prototype as unknown as Record<string, () => void>;

    expect(storeMethod).toHaveLength(2);
    expect(verifyMethod).toHaveLength(3);
  });

  it('stores a random state in a short-lived httpOnly cookie', () => {
    const { req, res } = fakeRequest();
    const callback = vi.fn();

    store.store(req, callback);

    const [error, state] = callback.mock.calls[0] as [null, string];
    expect(error).toBeNull();
    expect(state.length).toBeGreaterThanOrEqual(20);
    expect(res.cookie).toHaveBeenCalledWith('oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 600_000,
    });
  });

  it('accepts a state that matches the cookie and clears the cookie', () => {
    const { req, res } = fakeRequest({ oauth_state: 'abc' });
    const callback = vi.fn();

    store.verify(req, 'abc', callback);

    expect(callback).toHaveBeenCalledWith(null, true);
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', { path: '/' });
  });

  it('rejects a mismatched state', () => {
    const { req } = fakeRequest({ oauth_state: 'abc' });
    const callback = vi.fn();

    store.verify(req, 'forged', callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('rejects when the cookie is missing', () => {
    const { req } = fakeRequest();
    const callback = vi.fn();

    store.verify(req, 'abc', callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });
});
