import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DatabaseHealth } from '../../database/database.health.js';
import { RedisHealth } from '../../redis/redis.health.js';

type Status = 'up' | 'down';

export interface HealthResponse {
  status: 'ok';
  checks: { database: Status; redis: Status };
}

const toStatus = (up: boolean): Status => (up ? 'up' : 'down');

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseHealth,
    private readonly redis: RedisHealth,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [databaseUp, redisUp] = await Promise.all([
      this.database.isUp(),
      this.redis.isUp(),
    ]);
    const checks = { database: toStatus(databaseUp), redis: toStatus(redisUp) };

    if (!databaseUp || !redisUp) {
      throw new ServiceUnavailableException(
        `database: ${checks.database}; redis: ${checks.redis}`,
      );
    }

    return { status: 'ok', checks };
  }
}
