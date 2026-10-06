import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DomainException } from '../../common/errors/domain.exception.js';
import { IdempotencyService } from './idempotency.service.js';

describe('IdempotencyService', () => {
  const redis = { set: vi.fn(), get: vi.fn(), del: vi.fn() };
  const action = vi.fn();
  const load = vi.fn();
  let service: IdempotencyService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.set.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);
    action.mockResolvedValue({ id: 'order-1', value: 'created' });
    load.mockResolvedValue('loaded');
    service = new IdempotencyService(redis as unknown as Redis);
  });

  it('runs the action the first time and remembers its result for a day', async () => {
    await expect(service.run('order:u1', 'k1', action, load)).resolves.toEqual({
      value: 'created',
      replayed: false,
    });

    expect(redis.set).toHaveBeenNthCalledWith(
      1,
      'idem:order:u1:k1',
      'pending',
      'EX',
      86400,
      'NX',
    );
    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      'idem:order:u1:k1',
      'order-1',
      'EX',
      86400,
    );
  });

  it('replays a finished request without running the action again', async () => {
    redis.set.mockResolvedValue(null);
    redis.get.mockResolvedValue('order-1');

    await expect(service.run('order:u1', 'k1', action, load)).resolves.toEqual({
      value: 'loaded',
      replayed: true,
    });
    expect(action).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledWith('order-1');
  });

  it.each(['pending', null])(
    'reports a request that is still in progress (stored: %j)',
    async (stored) => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(stored);

      const error = await service
        .run('order:u1', 'k1', action, load)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).code).toBe('REQUEST_IN_PROGRESS');
      expect(action).not.toHaveBeenCalled();
    },
  );

  it('releases the key when the action fails, so a retry can run', async () => {
    action.mockRejectedValue(new Error('out of stock'));

    await expect(service.run('order:u1', 'k1', action, load)).rejects.toThrow(
      'out of stock',
    );
    expect(redis.del).toHaveBeenCalledWith('idem:order:u1:k1');
  });

  it('keeps the scopes of different users apart', async () => {
    await service.run('order:u1', 'k1', action, load);
    await service.run('order:u2', 'k1', action, load);

    expect(redis.set).toHaveBeenCalledWith(
      'idem:order:u2:k1',
      'pending',
      'EX',
      86400,
      'NX',
    );
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('still runs the action when Redis is unavailable', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));

    await expect(service.run('order:u1', 'k1', action, load)).resolves.toEqual({
      value: 'created',
      replayed: false,
    });
  });
});
