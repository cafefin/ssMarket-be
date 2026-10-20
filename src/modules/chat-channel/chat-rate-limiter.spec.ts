import type { Redis } from 'ioredis';
import { ChatRateLimiter } from './chat-rate-limiter.js';
import { vietnamHourKey } from './chat-format.js';

describe('ChatRateLimiter', () => {
  const now = new Date('2026-10-15T02:30:00.000Z');
  let redis: {
    set: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  let limiter: ChatRateLimiter;

  beforeEach(() => {
    redis = { set: vi.fn(), incr: vi.fn(), expire: vi.fn() };
    limiter = new ChatRateLimiter(redis as unknown as Redis);
  });

  describe('claimSellerSlot', () => {
    it('sets the cooldown key with NX and returns true on OK', async () => {
      redis.set.mockResolvedValue('OK');
      await expect(
        limiter.claimSellerSlot('s', 'campaign.opened', 30),
      ).resolves.toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        'chat:cooldown:s:campaign.opened',
        '1',
        'PX',
        1_800_000,
        'NX',
      );
    });

    it('returns false when the key already exists', async () => {
      redis.set.mockResolvedValue(null);
      await expect(
        limiter.claimSellerSlot('s', 'campaign.opened', 30),
      ).resolves.toBe(false);
    });
  });

  describe('claimHourSlot', () => {
    const key = `chat:hour:${vietnamHourKey(now)}`;

    it('counts up to the maximum and sets the expiry on the first count', async () => {
      redis.incr.mockResolvedValue(1);
      await expect(limiter.claimHourSlot(now, 1)).resolves.toBe(true);
      expect(redis.incr).toHaveBeenCalledWith(key);
      expect(redis.expire).toHaveBeenCalledWith(key, 7200);
    });

    it('does not reset the expiry on later counts', async () => {
      redis.incr.mockResolvedValue(5);
      await expect(limiter.claimHourSlot(now, 5)).resolves.toBe(true);
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('refuses above the maximum', async () => {
      redis.incr.mockResolvedValue(6);
      await expect(limiter.claimHourSlot(now, 5)).resolves.toBe(false);
    });
  });
});
