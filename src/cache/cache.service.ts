import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Cache-aside. A Redis failure degrades to calling the loader; the cache
   * never fails a request.
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.read<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await loader();
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed for ${key}: ${String(error)}`);
    }
    return value;
  }

  /**
   * Keys embed their namespace version, so bumping the version makes every
   * older entry unreachable without having to find and delete it.
   */
  async getVersion(namespace: string): Promise<number> {
    try {
      return Number((await this.redis.get(`${namespace}:version`)) ?? 0);
    } catch {
      return 0;
    }
  }

  async bumpVersion(namespace: string): Promise<void> {
    try {
      await this.redis.incr(`${namespace}:version`);
    } catch (error) {
      this.logger.warn(`Cache bump failed for ${namespace}: ${String(error)}`);
    }
  }

  private async read<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }
}
