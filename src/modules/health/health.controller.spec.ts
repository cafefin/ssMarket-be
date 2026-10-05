import { ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseHealth } from '../../database/database.health.js';
import type { RedisHealth } from '../../redis/redis.health.js';
import { HealthController } from './health.controller.js';

function controllerWith(database: boolean, redis: boolean): HealthController {
  return new HealthController(
    { isUp: () => Promise.resolve(database) } as DatabaseHealth,
    { isUp: () => Promise.resolve(redis) } as RedisHealth,
  );
}

describe('HealthController', () => {
  it('reports ok when both dependencies are up', async () => {
    await expect(controllerWith(true, true).check()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('throws 503 naming the dependency that is down', async () => {
    const check = controllerWith(true, false).check();

    await expect(check).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(check).rejects.toThrow('database: up; redis: down');
  });

  it('reports the database as down', async () => {
    await expect(controllerWith(false, true).check()).rejects.toThrow(
      'database: down; redis: up',
    );
  });
});
