import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { isChatEvent, type EventEnvelope } from '../../events/domain-events.js';
import { ChatChannelRepository } from './chat-channel.repository.js';
import { chatVariables, sellerOf } from './chat-format.js';
import { ChatOutcome } from './chat-delivery.entity.js';
import { ChatRateLimiter } from './chat-rate-limiter.js';
import { GoogleChatClient } from './google-chat.client.js';
import { renderTemplate } from './template-renderer.js';

@Injectable()
export class ChatDeliveryService {
  private readonly webUrl: string;

  constructor(
    private readonly repository: ChatChannelRepository,
    private readonly limiter: ChatRateLimiter,
    private readonly client: GoogleChatClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webUrl = config.get('WEB_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Google Chat queue handler (spec §7.1). Idempotent by event id. */
  async handleEvent(event: EventEnvelope, now = new Date()): Promise<void> {
    if (!isChatEvent(event) || (await this.repository.hasDelivery(event.id))) {
      return;
    }
    const settings = await this.repository.getSettings();
    const template = await this.repository.getTemplate(event.type);
    if (!settings.enabled || !settings.webhookUrl || !template?.enabled) return;

    const message = renderTemplate(
      template.template,
      chatVariables(event, this.webUrl),
    );
    const sellerId = sellerOf(event);
    const record = (outcome: ChatOutcome, error: string | null = null) =>
      this.repository.recordDelivery({
        eventId: event.id,
        eventType: event.type,
        sellerId,
        outcome,
        message,
        error,
      });

    if (
      settings.sellerCooldownMinutes > 0 &&
      !(await this.limiter.claimSellerSlot(
        sellerId,
        event.type,
        settings.sellerCooldownMinutes,
      ))
    ) {
      return record(ChatOutcome.RateLimitedSeller);
    }
    if (
      settings.maxPerHour !== null &&
      !(await this.limiter.claimHourSlot(now, settings.maxPerHour))
    ) {
      return record(ChatOutcome.RateLimitedGlobal);
    }
    const result = await this.client.send(settings.webhookUrl, message);
    return result.ok
      ? record(ChatOutcome.Sent)
      : record(ChatOutcome.Failed, result.error);
  }
}
