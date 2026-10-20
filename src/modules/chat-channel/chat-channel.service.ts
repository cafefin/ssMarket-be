import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception.js';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { ChatChannelRepository } from './chat-channel.repository.js';
import { ChatOutcome } from './chat-delivery.entity.js';
import type { ChatDelivery } from './chat-delivery.entity.js';
import type { ChatTemplate } from './chat-template.entity.js';
import {
  CHAT_TEMPLATE_TYPES,
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  TEST_PREFIX,
  isChatTemplateType,
  sampleVariables,
  type ChatTemplateType,
} from './chat-templates.js';
import {
  settingsProblems,
  webhookHint,
  type ChatSettingsInput,
} from './chat-settings-rules.js';
import { checkTemplate, renderTemplate } from './template-renderer.js';
import {
  ChatDigestState,
  type ChatChannelDto,
  type ChatDeliveryDto,
  type ChatDeliveryPageDto,
  type ChatPreviewDto,
  type ChatTemplateDto,
} from './dto/chat-channel.dto.js';
import { GoogleChatClient } from './google-chat.client.js';

const PAGE_SIZE = 50;
const TRUSTED = new Set(['items']);

@Injectable()
export class ChatChannelService {
  private readonly webUrl: string;

  constructor(
    private readonly repository: ChatChannelRepository,
    private readonly client: GoogleChatClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webUrl = config.get('WEB_URL', { infer: true }).replace(/\/$/, '');
  }

  async get(): Promise<ChatChannelDto> {
    const [settings, templates] = await Promise.all([
      this.repository.getSettings(),
      this.repository.listTemplates(),
    ]);
    const order = (type: string) =>
      CHAT_TEMPLATE_TYPES.indexOf(type as ChatTemplateType);
    return {
      enabled: settings.enabled,
      hasWebhook: settings.webhookUrl !== null,
      webhookHint: webhookHint(settings.webhookUrl),
      maxPerHour: settings.maxPerHour,
      sellerCooldownMinutes: settings.sellerCooldownMinutes,
      updatedAt: settings.updatedAt.toISOString(),
      templates: templates
        .filter((t) => order(t.eventType) >= 0)
        .sort((a, b) => order(a.eventType) - order(b.eventType))
        .map((t) => this.toTemplateDto(t)),
    };
  }

  async updateSettings(
    adminId: string,
    input: ChatSettingsInput,
  ): Promise<ChatChannelDto> {
    const current = await this.repository.getSettings();
    const problems = settingsProblems(input, current.webhookUrl !== null);
    if (problems.length > 0) {
      throw new DomainException(
        422,
        'INVALID_CHAT_SETTINGS',
        'Invalid chat channel settings',
        { problems },
      );
    }
    await this.repository.saveSettings(
      {
        enabled: input.enabled,
        maxPerHour: input.maxPerHour,
        sellerCooldownMinutes: input.sellerCooldownMinutes,
        ...(input.webhookUrl === undefined
          ? {}
          : { webhookUrl: input.webhookUrl }),
      },
      adminId,
    );
    return this.get();
  }

  async updateTemplate(
    adminId: string,
    type: string,
    input: { enabled: boolean; template: string },
  ): Promise<ChatTemplateDto> {
    const known = this.knownType(type);
    this.assertValid(known, input.template);
    const saved = await this.repository.saveTemplate(known, input, adminId);
    return this.toTemplateDto(saved);
  }

  preview(type: string, template: string): ChatPreviewDto {
    const known = this.knownType(type);
    this.assertValid(known, template);
    return { message: this.render(known, template) };
  }

  async sendTest(type: string, template?: string): Promise<ChatPreviewDto> {
    const known = this.knownType(type);
    let text = template;
    if (text === undefined) {
      const stored = await this.repository.getTemplate(known);
      text = stored?.template ?? DEFAULT_TEMPLATES[known];
    }
    this.assertValid(known, text);
    const settings = await this.repository.getSettings();
    if (settings.webhookUrl === null) {
      throw new DomainException(
        409,
        'CHAT_WEBHOOK_NOT_SET',
        'Set a webhook before sending a test message',
      );
    }
    const message = TEST_PREFIX + this.render(known, text);
    const result = await this.client.send(settings.webhookUrl, message);
    await this.repository.recordDelivery({
      eventId: null,
      eventType: known,
      sellerId: null,
      outcome: result.ok ? ChatOutcome.Test : ChatOutcome.Failed,
      message,
      error: result.ok ? null : result.error,
    });
    if (!result.ok) {
      throw new DomainException(
        502,
        'CHAT_SEND_FAILED',
        'Google Chat did not accept the message',
        { error: result.error },
      );
    }
    return { message };
  }

  async listDeliveries(cursor?: string): Promise<ChatDeliveryPageDto> {
    const decoded = cursor ? decodeCreatedAtCursor(cursor) : null;
    const rows = await this.repository.listDeliveries(decoded, PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toDeliveryDto(row)),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeCreatedAtCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  private knownType(type: string): ChatTemplateType {
    if (!isChatTemplateType(type)) {
      throw new NotFoundException('Unknown template');
    }
    return type;
  }

  private assertValid(type: ChatTemplateType, template: string): void {
    const { problems, unknownVariables } = checkTemplate(type, template);
    if (problems.length > 0) {
      throw new DomainException(
        422,
        'INVALID_CHAT_TEMPLATE',
        'Invalid message template',
        { problems, unknownVariables },
      );
    }
  }

  private render(type: ChatTemplateType, template: string): string {
    return renderTemplate(
      template,
      sampleVariables(type, this.webUrl),
      TRUSTED,
    );
  }

  private toTemplateDto(row: ChatTemplate): ChatTemplateDto {
    const type = row.eventType as ChatTemplateType;
    return {
      eventType: type,
      enabled: row.enabled,
      template: row.template,
      variables: [...TEMPLATE_VARIABLES[type]],
      defaultTemplate: DEFAULT_TEMPLATES[type],
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDeliveryDto(
    row: ChatDelivery & { sellerName: string | null },
  ): ChatDeliveryDto {
    const held =
      row.outcome === ChatOutcome.RateLimitedGlobal ||
      row.outcome === ChatOutcome.RateLimitedSeller;
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      // Written only by the delivery service and the test send, always a known type.
      eventType: row.eventType as ChatTemplateType,
      sellerName: row.sellerName,
      outcome: row.outcome,
      message: row.message,
      error: row.error,
      digest: held
        ? row.digestedAt
          ? ChatDigestState.Included
          : ChatDigestState.Pending
        : null,
    };
  }
}
