import type { Redis } from 'ioredis';
import { RedisHealth } from './redis.health.js';

describe('RedisHealth', () => {
  it('is up when Redis answers PONG', async () => {
    const redis = { ping: vi.fn().mockResolvedValue('PONG') };

    await expect(
      new RedisHealth(redis as unknown as Redis).isUp(),
    ).resolves.toBe(true);
  });

  it('is down when the ping fails', async () => {
    const redis = { ping: vi.fn().mockRejectedValue(new Error('down')) };

    await expect(
      new RedisHealth(redis as unknown as Redis).isUp(),
    ).resolves.toBe(false);
  });
});
