import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception.js';
import { ChatDelivery, ChatOutcome } from './chat-delivery.entity.js';
import { ChatChannelService } from './chat-channel.service.js';
import type { ChatChannelRepository } from './chat-channel.repository.js';
import {
  CHAT_TEMPLATE_TYPES,
  DEFAULT_TEMPLATES,
} from './chat-templates.js';
import type { GoogleChatClient } from './google-chat.client.js';

const WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=abcd';
const now = new Date('2026-01-02T03:04:05.000Z');

const settings = (over: Record<string, unknown> = {}) => ({
  id: 1,
  enabled: false,
  webhookUrl: null,
  maxPerHour: 10,
  sellerCooldownMinutes: 30,
  updatedAt: now,
  updatedBy: null,
  ...over,
});
const templates = () =>
  CHAT_TEMPLATE_TYPES.map((type) => ({
    eventType: type,
    enabled: true,
    template: DEFAULT_TEMPLATES[type],
    updatedAt: now,
    updatedBy: null,
  }));

describe('ChatChannelService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let client: { send: ReturnType<typeof vi.fn> };
  let service: ChatChannelService;

  beforeEach(() => {
    repo = {
      getSettings: vi.fn().mockResolvedValue(settings()),
      saveSettings: vi.fn().mockImplementation(async (fields) =>
        settings(fields),
      ),
      listTemplates: vi.fn().mockResolvedValue(templates()),
      getTemplate: vi.fn().mockImplementation(async (type: string) =>
        templates().find((t) => t.eventType === type) ?? null,
      ),
      saveTemplate: vi.fn().mockImplementation(async (type, fields) => ({
        eventType: type,
        ...fields,
        updatedAt: now,
        updatedBy: 'a',
      })),
      recordDelivery: vi.fn(),
      listDeliveries: vi.fn().mockResolvedValue([]),
    };
    client = { send: vi.fn().mockResolvedValue({ ok: true }) };
    service = new ChatChannelService(
      repo as unknown as ChatChannelRepository,
      client as unknown as GoogleChatClient,
      { get: () => 'http://localhost:3000/' } as unknown as ConfigService<never, true>,
    );
  });

  describe('get', () => {
    it('never returns the webhook url', async () => {
      repo.getSettings.mockResolvedValue(settings({ webhookUrl: WEBHOOK }));
      const dto = await service.get();
      expect(dto.hasWebhook).toBe(true);
      expect(dto.webhookHint).toBe('abcd');
      expect(JSON.stringify(dto)).not.toContain('chat.googleapis');
      expect(dto.templates.map((t) => t.eventType)).toEqual([
        ...CHAT_TEMPLATE_TYPES,
      ]);
      expect(dto.templates[0].variables).toContain('sellerName');
      expect(dto.templates[0].defaultTemplate).toBe(
        DEFAULT_TEMPLATES['campaign.opened'],
      );
    });

    it('reports no webhook', async () => {
      const dto = await service.get();
      expect(dto.hasWebhook).toBe(false);
      expect(dto.webhookHint).toBeNull();
    });
  });

  describe('updateSettings', () => {
    const input = { enabled: false, maxPerHour: 5, sellerCooldownMinutes: 10 };

    it('rejects problems with 422 INVALID_CHAT_SETTINGS', async () => {
      const error = await service
        .updateSettings('a', { ...input, enabled: true })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainException);
      const domain = error as DomainException;
      expect(domain.getStatus()).toBe(422);
      expect(domain.code).toBe('INVALID_CHAT_SETTINGS');
      expect(domain.details?.problems).toHaveLength(1);
      expect(repo.saveSettings).not.toHaveBeenCalled();
    });

    it('keeps the stored url when webhookUrl is absent', async () => {
      await service.updateSettings('a', input);
      const [fields, by] = repo.saveSettings.mock.calls[0] as [object, string];
      expect(fields).not.toHaveProperty('webhookUrl');
      expect(fields).toMatchObject({ maxPerHour: 5, sellerCooldownMinutes: 10 });
      expect(by).toBe('a');
    });

    it('removes the url on null and stores a new one', async () => {
      await service.updateSettings('a', { ...input, webhookUrl: null });
      expect(repo.saveSettings.mock.calls[0][0]).toMatchObject({
        webhookUrl: null,
      });
      await service.updateSettings('a', { ...input, webhookUrl: WEBHOOK });
      expect(repo.saveSettings.mock.calls[1][0]).toMatchObject({
        webhookUrl: WEBHOOK,
      });
    });
  });

  describe('updateTemplate', () => {
    it('404s on an unknown type', async () => {
      await expect(
        service.updateTemplate('a', 'nope', { enabled: true, template: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('422s on an unknown variable', async () => {
      const error = (await service
        .updateTemplate('a', 'campaign.opened', {
          enabled: true,
          template: 'hi {{foo}}',
        })
        .catch((e: unknown) => e)) as DomainException;
      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('INVALID_CHAT_TEMPLATE');
      expect(error.details?.unknownVariables).toEqual(['foo']);
    });

    it('saves a valid template', async () => {
      const dto = await service.updateTemplate('a', 'campaign.opened', {
        enabled: false,
        template: 'hi {{sellerName}}',
      });
      expect(repo.saveTemplate).toHaveBeenCalledWith(
        'campaign.opened',
        { enabled: false, template: 'hi {{sellerName}}' },
        'a',
      );
      expect(dto.template).toBe('hi {{sellerName}}');
      expect(dto.defaultTemplate).toBe(DEFAULT_TEMPLATES['campaign.opened']);
    });
  });

  describe('preview', () => {
    it('renders sample values', () => {
      const { message } = service.preview(
        'campaign.opened',
        '{{sellerName}} - {{url}}',
      );
      expect(message).toBe('Nguyễn Văn An - http://localhost:3000/');
    });

    it('keeps digest items unsanitized', () => {
      const { message } = service.preview('chat.digest', '{{items}}');
      expect(message).toContain('*');
    });

    it('404s and 422s', () => {
      expect(() => service.preview('nope', 'x')).toThrow(NotFoundException);
      expect(() => service.preview('campaign.opened', '{{foo}}')).toThrow(
        DomainException,
      );
    });
  });

  describe('sendTest', () => {
    it('409s without a webhook', async () => {
      const error = (await service
        .sendTest('campaign.opened')
        .catch((e: unknown) => e)) as DomainException;
      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('CHAT_WEBHOOK_NOT_SET');
      expect(client.send).not.toHaveBeenCalled();
    });

    it('sends with the prefix and records a test row, even when disabled', async () => {
      repo.getSettings.mockResolvedValue(settings({ webhookUrl: WEBHOOK }));
      const dto = await service.sendTest('campaign.opened', '{{sellerName}}');
      expect(client.send).toHaveBeenCalledWith(WEBHOOK, '[Thử] Nguyễn Văn An');
      expect(dto.message).toBe('[Thử] Nguyễn Văn An');
      expect(repo.recordDelivery).toHaveBeenCalledWith({
        eventId: null,
        eventType: 'campaign.opened',
        sellerId: null,
        outcome: ChatOutcome.Test,
        message: '[Thử] Nguyễn Văn An',
        error: null,
      });
    });

    it('uses the saved template when none is given', async () => {
      repo.getSettings.mockResolvedValue(settings({ webhookUrl: WEBHOOK }));
      await service.sendTest('listing.published');
      const text = client.send.mock.calls[0][1] as string;
      expect(text.startsWith('[Thử] 🆕')).toBe(true);
    });

    it('records a failed row and answers 502', async () => {
      repo.getSettings.mockResolvedValue(settings({ webhookUrl: WEBHOOK }));
      client.send.mockResolvedValue({ ok: false, error: 'HTTP 400: bad' });
      const error = (await service
        .sendTest('campaign.opened', 'x')
        .catch((e: unknown) => e)) as DomainException;
      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe('CHAT_SEND_FAILED');
      expect(error.details).toEqual({ error: 'HTTP 400: bad' });
      expect(repo.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: ChatOutcome.Failed,
          error: 'HTTP 400: bad',
          eventId: null,
        }),
      );
    });

    it('validates the template', async () => {
      repo.getSettings.mockResolvedValue(settings({ webhookUrl: WEBHOOK }));
      await expect(
        service.sendTest('campaign.opened', '{{foo}}'),
      ).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('listDeliveries', () => {
    const row = (over: Partial<ChatDelivery> & { sellerName?: string | null }) =>
      ({
        id: '11111111-1111-4111-8111-111111111111',
        eventId: null,
        eventType: 'campaign.opened',
        sellerId: null,
        outcome: ChatOutcome.Sent,
        message: 'm',
        error: null,
        digestedAt: null,
        createdAt: now,
        sellerName: 'An',
        ...over,
      }) as ChatDelivery & { sellerName: string | null };

    it('maps the digest state', async () => {
      repo.listDeliveries.mockResolvedValue([
        row({ outcome: ChatOutcome.RateLimitedSeller, digestedAt: now }),
        row({ outcome: ChatOutcome.RateLimitedGlobal }),
        row({}),
      ]);
      const page = await service.listDeliveries();
      expect(page.items.map((i) => i.digest)).toEqual([
        'included',
        'pending',
        null,
      ]);
      expect(page.items[0].sellerName).toBe('An');
      expect(page.nextCursor).toBeNull();
      expect(repo.listDeliveries).toHaveBeenCalledWith(null, 51);
    });

    it('returns a cursor when there is a next page', async () => {
      repo.listDeliveries.mockResolvedValue(
        Array.from({ length: 51 }, (_, i) =>
          row({ id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }),
        ),
      );
      const page = await service.listDeliveries();
      expect(page.items).toHaveLength(50);
      expect(page.nextCursor).not.toBeNull();
    });
  });
});
