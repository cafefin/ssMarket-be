import type { Request, Response } from 'express';
import { readCookie } from '../../common/http/read-cookie.js';
import { clearAuthCookies, setAuthCookies } from './auth-cookies.js';

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

describe('auth cookies', () => {
  it('sets both cookies as httpOnly, lax, path / with the right lifetimes', () => {
    const res = fakeResponse();

    setAuthCookies(
      res as unknown as Response,
      { accessToken: 'a', refreshToken: 'r' },
      false,
    );

    const base = { httpOnly: true, sameSite: 'lax', path: '/', secure: false };
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'a', {
      ...base,
      maxAge: 900_000,
    });
    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'r', {
      ...base,
      maxAge: 604_800_000,
    });
  });

  it('marks cookies secure when asked', () => {
    const res = fakeResponse();

    setAuthCookies(
      res as unknown as Response,
      { accessToken: 'a', refreshToken: 'r' },
      true,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'a',
      expect.objectContaining({ secure: true }),
    );
  });

  it('clears both cookies with matching options', () => {
    const res = fakeResponse();

    clearAuthCookies(res as unknown as Response, false);

    const base = { httpOnly: true, sameSite: 'lax', path: '/', secure: false };
    expect(res.clearCookie).toHaveBeenCalledWith('access_token', base);
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', base);
  });
});

describe('readCookie', () => {
  it('returns the named cookie', () => {
    const req = { cookies: { a: '1' } } as unknown as Request;

    expect(readCookie(req, 'a')).toBe('1');
  });

  it('returns undefined when cookies were not parsed or the name is absent', () => {
    expect(readCookie({} as Request, 'a')).toBeUndefined();
    expect(
      readCookie({ cookies: {} } as unknown as Request, 'a'),
    ).toBeUndefined();
  });
});
