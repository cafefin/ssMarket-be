import type { ConfigService } from '@nestjs/config';
import type { EventEnvelope } from '../../events/domain-events.js';
import { ChatDeliveryService } from './chat-delivery.service.js';
import { ChatOutcome } from './chat-delivery.entity.js';
import type { ChatChannelRepository } from './chat-channel.repository.js';
import type { ChatRateLimiter } from './chat-rate-limiter.js';
import type { GoogleChatClient } from './google-chat.client.js';

const WEBHOOK =
  'https://chat.googleapis.com/v1/spaces/A/messages?key=k&token=t';
const now = new Date('2026-10-15T02:30:00.000Z');

const opened: EventEnvelope = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  type: 'campaign.opened',
  occurredAt: now.toISOString(),
  payload: {
    campaignId: 'c1',
    sellerId: 's1',
    sellerName: 'An',
    campaignTitle: 'Bánh bao',
    categoryName: 'Đồ ăn',
    orderDeadline: '2026-10-20T10:00:00.000Z',
    deliveryDate: '2026-10-22',
    itemCount: 2,
  },
};
const placed: EventEnvelope = {
  id: '22222222-2222-4222-8222-222222222222',
  version: 1,
  type: 'order.placed',
  occurredAt: now.toISOString(),
  payload: {
    orderId: 'o',
    orderCode: 'C',
    buyerId: 'b',
    buyerName: 'B',
    sellerId: 's1',
    sellerName: 'An',
    title: 't',
    total: 1,
    actor: 'buyer',
    reason: null,
  },
};

describe('ChatDeliveryService.handleEvent', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let limiter: Record<string, ReturnType<typeof vi.fn>>;
  let client: { send: ReturnType<typeof vi.fn> };
  let settings: Record<string, unknown>;
  let template: Record<string, unknown> | null;
  let service: ChatDeliveryService;

  beforeEach(() => {
    settings = {
      enabled: true,
      webhookUrl: WEBHOOK,
      maxPerHour: 10,
      sellerCooldownMinutes: 30,
    };
    template = {
      enabled: true,
      template: '{{sellerName}} mở {{campaignTitle}} {{url}}',
    };
    repo = {
      hasDelivery: vi.fn().mockResolvedValue(false),
      getSettings: vi.fn().mockImplementation(async () => settings),
      getTemplate: vi.fn().mockImplementation(async () => template),
      recordDelivery: vi.fn().mockResolvedValue(undefined),
    };
    limiter = {
      claimSellerSlot: vi.fn().mockResolvedValue(true),
      claimHourSlot: vi.fn().mockResolvedValue(true),
    };
    client = { send: vi.fn().mockResolvedValue({ ok: true }) };
    service = new ChatDeliveryService(
      repo as unknown as ChatChannelRepository,
      limiter as unknown as ChatRateLimiter,
      client as unknown as GoogleChatClient,
      { get: () => 'http://localhost:3000/' } as unknown as ConfigService<
        never,
        true
      >,
    );
  });

  const MESSAGE = 'An mở Bánh bao http://localhost:3000/campaigns/c1';

  it('ignores a non-chat event', async () => {
    await service.handleEvent(placed, now);
    expect(repo.hasDelivery).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    expect(repo.recordDelivery).not.toHaveBeenCalled();
  });

  it('does nothing else when the event was already delivered', async () => {
    repo.hasDelivery.mockResolvedValue(true);
    await service.handleEvent(opened, now);
    expect(repo.getSettings).not.toHaveBeenCalled();
    expect(limiter.claimSellerSlot).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    expect(repo.recordDelivery).not.toHaveBeenCalled();
  });

  it.each([
    ['channel disabled', () => (settings.enabled = false)],
    ['no webhook', () => (settings.webhookUrl = null)],
    ['template disabled', () => (template = { ...template, enabled: false })],
    ['no template', () => (template = null)],
  ])('sends and records nothing when %s', async (_name, change) => {
    change();
    await service.handleEvent(opened, now);
    expect(client.send).not.toHaveBeenCalled();
    expect(repo.recordDelivery).not.toHaveBeenCalled();
    expect(limiter.claimSellerSlot).not.toHaveBeenCalled();
  });

  it('renders the saved template with the event variables', async () => {
    await service.handleEvent(opened, now);
    expect(client.send).toHaveBeenCalledWith(WEBHOOK, MESSAGE);
  });

  it('records a seller-held message when the seller slot is refused', async () => {
    limiter.claimSellerSlot.mockResolvedValue(false);
    await service.handleEvent(opened, now);
    expect(limiter.claimSellerSlot).toHaveBeenCalledWith(
      's1',
      'campaign.opened',
      30,
    );
    expect(repo.recordDelivery).toHaveBeenCalledWith({
      eventId: opened.id,
      eventType: 'campaign.opened',
      sellerId: 's1',
      outcome: ChatOutcome.RateLimitedSeller,
      message: MESSAGE,
      error: null,
    });
    expect(client.send).not.toHaveBeenCalled();
    expect(limiter.claimHourSlot).not.toHaveBeenCalled();
  });

  it('skips the seller cooldown when it is 0', async () => {
    settings.sellerCooldownMinutes = 0;
    await service.handleEvent(opened, now);
    expect(limiter.claimSellerSlot).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalled();
  });

  it('records a globally held message when the hour slot is refused', async () => {
    limiter.claimHourSlot.mockResolvedValue(false);
    await service.handleEvent(opened, now);
    expect(limiter.claimHourSlot).toHaveBeenCalledWith(now, 10);
    expect(repo.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: ChatOutcome.RateLimitedGlobal,
        message: MESSAGE,
      }),
    );
    expect(client.send).not.toHaveBeenCalled();
  });

  it('skips the hourly limit when maxPerHour is null', async () => {
    settings.maxPerHour = null;
    await service.handleEvent(opened, now);
    expect(limiter.claimHourSlot).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalled();
  });

  it('records sent when the client succeeds', async () => {
    await service.handleEvent(opened, now);
    expect(repo.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: ChatOutcome.Sent,
        error: null,
        message: MESSAGE,
      }),
    );
  });

  it('records failed with the error when the client fails', async () => {
    client.send.mockResolvedValue({ ok: false, error: 'HTTP 500' });
    await service.handleEvent(opened, now);
    expect(repo.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: ChatOutcome.Failed,
        error: 'HTTP 500',
      }),
    );
  });
});

describe('ChatDeliveryService.runDigest', () => {
  const at = new Date('2026-10-15T03:00:30.000Z');
  const hourStart = new Date('2026-10-15T03:00:00.000Z');
  const tx = { tx: true };
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let limiter: Record<string, ReturnType<typeof vi.fn>>;
  let client: { send: ReturnType<typeof vi.fn> };
  let settings: Record<string, unknown>;
  let template: Record<string, unknown>;
  let held: { id: string; message: string }[];
  let service: ChatDeliveryService;

  beforeEach(() => {
    settings = { enabled: true, webhookUrl: WEBHOOK };
    template = { enabled: true, template: 'N={{count}}\n{{items}}' };
    held = [
      { id: 'a', message: 'one' },
      { id: 'b', message: 'two' },
      { id: 'c', message: 'three' },
    ];
    repo = {
      getSettings: vi.fn().mockImplementation(async () => settings),
      getTemplate: vi.fn().mockImplementation(async () => template),
      pendingHeld: vi.fn().mockImplementation(async () => held),
      markDigested: vi.fn().mockResolvedValue(undefined),
      recordDelivery: vi.fn().mockResolvedValue(undefined),
      transaction: vi
        .fn()
        .mockImplementation(async (work: (t: unknown) => unknown) => work(tx)),
    };
    limiter = {
      claimSellerSlot: vi.fn(),
      claimHourSlot: vi.fn(),
    };
    client = { send: vi.fn().mockResolvedValue({ ok: true }) };
    service = new ChatDeliveryService(
      repo as unknown as ChatChannelRepository,
      limiter as unknown as ChatRateLimiter,
      client as unknown as GoogleChatClient,
      { get: () => 'http://localhost:3000' } as unknown as ConfigService<
        never,
        true
      >,
    );
  });

  it('asks for held rows of the last 24 hours before the current hour', async () => {
    await service.runDigest(at);
    expect(repo.pendingHeld).toHaveBeenCalledWith(
      new Date('2026-10-14T03:00:30.000Z'),
      hourStart,
    );
  });

  it('does nothing without held rows', async () => {
    held = [];
    await service.runDigest(at);
    expect(client.send).not.toHaveBeenCalled();
    expect(repo.recordDelivery).not.toHaveBeenCalled();
    expect(repo.markDigested).not.toHaveBeenCalled();
  });

  it.each([
    ['the channel is disabled', { enabled: false }],
    ['there is no webhook', { webhookUrl: null }],
  ])('marks rows digested without sending when %s', async (_name, patch) => {
    Object.assign(settings, patch);
    await service.runDigest(at);
    expect(repo.markDigested).toHaveBeenCalledWith(['a', 'b', 'c'], at);
    expect(client.send).not.toHaveBeenCalled();
    expect(repo.recordDelivery).not.toHaveBeenCalled();
  });

  it('marks rows digested without sending when chat.digest is disabled', async () => {
    template.enabled = false;
    await service.runDigest(at);
    expect(repo.markDigested).toHaveBeenCalledWith(['a', 'b', 'c'], at);
    expect(client.send).not.toHaveBeenCalled();
    expect(repo.recordDelivery).not.toHaveBeenCalled();
  });

  it('keeps the whole digest message within 4000 characters', async () => {
    template = { enabled: true, template: `${'h'.repeat(900)}\n{{items}}` };
    held = Array.from({ length: 20 }, (_, i) => ({
      id: `id${i}`,
      message: 'x'.repeat(190),
    }));
    await service.runDigest(at);
    const text = client.send.mock.calls[0][1] as string;
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text.length).toBeGreaterThan(3500);
    expect(text).toMatch(/… và \d+ tin khác$/);
  });

  it('shares the budget when the template repeats {{items}}', async () => {
    template = { enabled: true, template: '{{items}}\n---\n{{items}}' };
    held = Array.from({ length: 20 }, (_, i) => ({
      id: `id${i}`,
      message: 'x'.repeat(300),
    }));
    await service.runDigest(at);
    const text = client.send.mock.calls[0][1] as string;
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  it('sends the digest, then records it and marks every row in one transaction', async () => {
    held = Array.from({ length: 25 }, (_, i) => ({
      id: `id${i}`,
      message: `m${i}`,
    }));
    await service.runDigest(at);
    const text = client.send.mock.calls[0][1] as string;
    expect(client.send).toHaveBeenCalledWith(WEBHOOK, text);
    expect(text).toContain('N=25');
    expect(text).toContain('• m0');
    expect(text).toContain('… và 5 tin khác');
    expect(repo.transaction).toHaveBeenCalledTimes(1);
    expect(repo.recordDelivery).toHaveBeenCalledWith(
      {
        eventId: null,
        eventType: 'chat.digest',
        sellerId: null,
        outcome: ChatOutcome.Digest,
        message: text,
        error: null,
      },
      tx,
    );
    expect(repo.markDigested).toHaveBeenCalledWith(
      held.map((row) => row.id),
      at,
      tx,
    );
  });

  it('records failed and leaves the rows when sending fails', async () => {
    client.send.mockResolvedValue({ ok: false, error: 'HTTP 500' });
    await service.runDigest(at);
    expect(repo.recordDelivery).toHaveBeenCalledTimes(1);
    expect(repo.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'chat.digest',
        outcome: ChatOutcome.Failed,
        error: 'HTTP 500',
      }),
    );
    expect(repo.markDigested).not.toHaveBeenCalled();
  });

  it('never touches the hourly counter or the seller cooldown', async () => {
    await service.runDigest(at);
    expect(limiter.claimHourSlot).not.toHaveBeenCalled();
    expect(limiter.claimSellerSlot).not.toHaveBeenCalled();
  });
});
