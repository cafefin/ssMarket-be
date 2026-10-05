import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CacheService } from './cache.service.js';

describe('CacheService', () => {
  const redis = { get: vi.fn(), set: vi.fn(), incr: vi.fn() };
  let cache: CacheService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.set.mockResolvedValue('OK');
    redis.incr.mockResolvedValue(1);
    cache = new CacheService(redis as unknown as Redis);
  });

  describe('getOrSet', () => {
    it('on a miss calls the loader once and stores the value with a TTL', async () => {
      redis.get.mockResolvedValue(null);
      const loader = vi.fn().mockResolvedValue({ a: 1 });

      await expect(cache.getOrSet('k', 60, loader)).resolves.toEqual({ a: 1 });

      expect(loader).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 60);
    });

    it('on a hit returns the cached value without calling the loader', async () => {
      redis.get.mockResolvedValue('{"a":2}');
      const loader = vi.fn();

      await expect(cache.getOrSet('k', 60, loader)).resolves.toEqual({ a: 2 });

      expect(loader).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('caches falsy values such as an empty list', async () => {
      redis.get.mockResolvedValue('[]');
      const loader = vi.fn();

      await expect(cache.getOrSet('k', 60, loader)).resolves.toEqual([]);
      expect(loader).not.toHaveBeenCalled();
    });

    it('falls back to the loader when reading from Redis fails', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));

      await expect(
        cache.getOrSet('k', 60, () => Promise.resolve('fresh')),
      ).resolves.toBe('fresh');
    });

    it('still returns the value when writing to Redis fails', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockRejectedValue(new Error('redis down'));

      await expect(
        cache.getOrSet('k', 60, () => Promise.resolve('fresh')),
      ).resolves.toBe('fresh');
    });

    it('treats corrupted cached JSON as a miss', async () => {
      redis.get.mockResolvedValue('{not json');

      await expect(
        cache.getOrSet('k', 60, () => Promise.resolve('fresh')),
      ).resolves.toBe('fresh');
    });

    it('propagates a loader failure and stores nothing', async () => {
      redis.get.mockResolvedValue(null);

      await expect(
        cache.getOrSet('k', 60, () => Promise.reject(new Error('db down'))),
      ).rejects.toThrow('db down');
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('versions', () => {
    it('reads the namespace version as a number', async () => {
      redis.get.mockResolvedValue('7');

      await expect(cache.getVersion('listings')).resolves.toBe(7);
      expect(redis.get).toHaveBeenCalledWith('listings:version');
    });

    it('is 0 when the version key is missing or Redis fails', async () => {
      redis.get.mockResolvedValue(null);
      await expect(cache.getVersion('listings')).resolves.toBe(0);

      redis.get.mockRejectedValue(new Error('redis down'));
      await expect(cache.getVersion('listings')).resolves.toBe(0);
    });

    it('bumps the namespace version', async () => {
      await cache.bumpVersion('listings');

      expect(redis.incr).toHaveBeenCalledWith('listings:version');
    });

    it('does not throw when bumping fails', async () => {
      redis.incr.mockRejectedValue(new Error('redis down'));

      await expect(cache.bumpVersion('listings')).resolves.toBeUndefined();
    });
  });
});
