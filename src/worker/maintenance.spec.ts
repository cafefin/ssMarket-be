import { Logger } from '@nestjs/common';
import type { OutboxRepository } from '../events/outbox.repository.js';
import type { ChatChannelRepository } from '../modules/chat-channel/chat-channel.repository.js';
import type { ChatDeliveryService } from '../modules/chat-channel/chat-delivery.service.js';
import type { NotificationsService } from '../modules/notifications/notifications.service.js';
import { Maintenance } from './maintenance.js';

const DAY = 86_400_000;
// 10:00:30 in Vietnam
const now = new Date('2026-10-15T03:00:30.000Z');

describe('Maintenance', () => {
  let redis: { set: ReturnType<typeof vi.fn> };
  let chat: { runDigest: ReturnType<typeof vi.fn> };
  let outbox: { deletePublishedBefore: ReturnType<typeof vi.fn> };
  let notifications: { deleteOlderThan: ReturnType<typeof vi.fn> };
  let deliveries: { deleteCreatedBefore: ReturnType<typeof vi.fn> };
  let maintenance: Maintenance;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    redis = { set: vi.fn().mockResolvedValue('OK') };
    chat = { runDigest: vi.fn().mockResolvedValue(undefined) };
    outbox = { deletePublishedBefore: vi.fn().mockResolvedValue(1) };
    notifications = { deleteOlderThan: vi.fn().mockResolvedValue(2) };
    deliveries = { deleteCreatedBefore: vi.fn().mockResolvedValue(3) };
    maintenance = new Maintenance(
      redis as never,
      chat as unknown as ChatDeliveryService,
      outbox as unknown as OutboxRepository,
      notifications as unknown as NotificationsService,
      deliveries as unknown as ChatChannelRepository,
    );
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs the digest when it takes the hourly lock', async () => {
    await maintenance.tick(now);
    expect(redis.set).toHaveBeenCalledWith(
      'chat:digest:2026101510',
      '1',
      'EX',
      7200,
      'NX',
    );
    expect(chat.runDigest).toHaveBeenCalledWith(now);
  });

  it('skips the digest when another worker holds the lock', async () => {
    redis.set.mockResolvedValue(null);
    await maintenance.tick(now);
    expect(chat.runDigest).not.toHaveBeenCalled();
    expect(outbox.deletePublishedBefore).not.toHaveBeenCalled();
  });

  it('cleans up old data once it takes the cleanup lock', async () => {
    await maintenance.tick(now);
    expect(redis.set).toHaveBeenCalledWith(
      'chat:cleanup:2026101510',
      '1',
      'EX',
      7200,
      'NX',
    );
    expect(outbox.deletePublishedBefore).toHaveBeenCalledWith(
      new Date(now.getTime() - 7 * DAY),
    );
    expect(notifications.deleteOlderThan).toHaveBeenCalledWith(
      new Date(now.getTime() - 90 * DAY),
    );
    expect(deliveries.deleteCreatedBefore).toHaveBeenCalledWith(
      new Date(now.getTime() - 30 * DAY),
    );
  });

  it('skips cleanup without the cleanup lock', async () => {
    redis.set.mockImplementation(async (key: string) =>
      key.startsWith('chat:cleanup') ? null : 'OK',
    );
    await maintenance.tick(now);
    expect(chat.runDigest).toHaveBeenCalled();
    expect(outbox.deletePublishedBefore).not.toHaveBeenCalled();
  });

  it('still cleans up when the digest fails', async () => {
    chat.runDigest.mockRejectedValue(new Error('boom'));
    await maintenance.tick(now);
    expect(error).toHaveBeenCalled();
    expect(outbox.deletePublishedBefore).toHaveBeenCalled();
    expect(deliveries.deleteCreatedBefore).toHaveBeenCalled();
  });

  it('ticks right away, then every interval, and survives a failing tick', async () => {
    vi.useFakeTimers();
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    maintenance.start(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(redis.set).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(redis.set.mock.calls.length).toBeGreaterThan(1);
    expect(chat.runDigest).toHaveBeenCalled();
    await maintenance.stop();
  });

  it('never overlaps ticks, and stop waits for the running one', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    chat.runDigest.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    maintenance.start(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chat.runDigest).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = maintenance.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });
});
