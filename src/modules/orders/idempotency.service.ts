import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DomainException } from '../../common/errors/domain.exception.js';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';

const TTL_SECONDS = 24 * 60 * 60;
const PENDING = 'pending';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Runs `action` at most once per (scope, key). A repeat of a finished
   * request returns the stored result through `load` instead of acting
   * again, so a double click or a retried request creates one order.
   *
   * When Redis is unavailable the action still runs: losing duplicate
   * protection for a moment is better than refusing every order.
   */
  async run<T>(
    scope: string,
    key: string,
    action: () => Promise<{ id: string; value: T }>,
    load: (id: string) => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const redisKey = `idem:${scope}:${key}`;

    let claimed: string | null;
    try {
      claimed = await this.redis.set(
        redisKey,
        PENDING,
        'EX',
        TTL_SECONDS,
        'NX',
      );
    } catch (error) {
      this.logger.warn(`Idempotency check skipped: ${String(error)}`);
      return { value: (await action()).value, replayed: false };
    }

    if (claimed !== 'OK') {
      const stored = await this.redis.get(redisKey);
      if (!stored || stored === PENDING) {
        throw new DomainException(
          409,
          'REQUEST_IN_PROGRESS',
          'The same request is still being processed',
        );
      }
      return { value: await load(stored), replayed: true };
    }

    try {
      const { id, value } = await action();
      await this.redis.set(redisKey, id, 'EX', TTL_SECONDS);
      return { value, replayed: false };
    } catch (error) {
      // Release the key so the person can correct the problem and try again.
      await this.redis.del(redisKey).catch(() => undefined);
      throw error;
    }
  }
}
