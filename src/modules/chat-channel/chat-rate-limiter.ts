import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';
import { vietnamHourKey } from './chat-format.js';

const HOUR_COUNTER_TTL_SECONDS = 7200;

/** Redis counters behind the chat channel's seller cooldown and hourly limit. */
@Injectable()
export class ChatRateLimiter {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** False when this seller already had a message of this type in the last `minutes`. Sets the key when it returns true. */
  async claimSellerSlot(
    sellerId: string,
    type: string,
    minutes: number,
  ): Promise<boolean> {
    const result = await this.redis.set(
      `chat:cooldown:${sellerId}:${type}`,
      '1',
      'PX',
      minutes * 60_000,
      'NX',
    );
    return result === 'OK';
  }

  /** False when `max` messages were already counted in the Vietnam clock hour of `now`. */
  async claimHourSlot(now: Date, max: number): Promise<boolean> {
    const key = `chat:hour:${vietnamHourKey(now)}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, HOUR_COUNTER_TTL_SECONDS);
    }
    return count <= max;
  }
}
