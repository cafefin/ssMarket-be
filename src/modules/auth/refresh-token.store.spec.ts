import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { RefreshTokenStore } from './refresh-token.store.js';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('RefreshTokenStore', () => {
  const redis = { set: vi.fn(), getdel: vi.fn(), del: vi.fn() };
  let store: RefreshTokenStore;

  beforeEach(() => {
    vi.resetAllMocks();
    redis.set.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);
    store = new RefreshTokenStore(redis as unknown as Redis);
  });

  it('issues a 256-bit token and stores only its hash with a 7-day TTL', async () => {
    const token = await store.issue('user-1');

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(redis.set).toHaveBeenCalledWith(
      `refresh:${sha256(token)}`,
      'user-1',
      'EX',
      604800,
    );
  });

  it('issues a different token on every call', async () => {
    const first = await store.issue('user-1');
    const second = await store.issue('user-1');

    expect(first).not.toBe(second);
  });

  it('consume returns the user id and deletes the token in one command', async () => {
    redis.getdel.mockResolvedValue('user-1');

    await expect(store.consume('token')).resolves.toBe('user-1');
    expect(redis.getdel).toHaveBeenCalledWith(`refresh:${sha256('token')}`);
  });

  it('consume returns null for an unknown token', async () => {
    redis.getdel.mockResolvedValue(null);

    await expect(store.consume('unknown')).resolves.toBeNull();
  });

  it('revoke deletes the hashed key', async () => {
    await store.revoke('token');

    expect(redis.del).toHaveBeenCalledWith(`refresh:${sha256('token')}`);
  });
});
