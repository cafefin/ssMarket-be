import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants.js';

@Injectable()
export class RefreshTokenStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.key(token),
      userId,
      'EX',
      REFRESH_TOKEN_TTL_SECONDS,
    );
    return token;
  }

  // GETDEL makes read-and-invalidate atomic, so a token can be used only once
  // even when two refresh requests race.
  consume(token: string): Promise<string | null> {
    return this.redis.getdel(this.key(token));
  }

  async revoke(token: string): Promise<void> {
    await this.redis.del(this.key(token));
  }

  private key(token: string): string {
    const hash = createHash('sha256').update(token).digest('hex');
    return `refresh:${hash}`;
  }
}
