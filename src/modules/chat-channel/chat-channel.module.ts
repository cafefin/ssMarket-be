import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatChannelRepository } from './chat-channel.repository.js';
import { ChatChannelService } from './chat-channel.service.js';
import { ChatDeliveryService } from './chat-delivery.service.js';
import { ChatDelivery } from './chat-delivery.entity.js';
import { ChatRateLimiter } from './chat-rate-limiter.js';
import { ChatSettings } from './chat-settings.entity.js';
import { ChatTemplate } from './chat-template.entity.js';
import {
  CHAT_FETCH,
  CHAT_SLEEP,
  GoogleChatClient,
} from './google-chat.client.js';

/** No controller: the worker imports this module. The admin API is a separate module. */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSettings, ChatTemplate, ChatDelivery]),
  ],
  providers: [
    ChatChannelRepository,
    GoogleChatClient,
    ChatChannelService,
    ChatRateLimiter,
    ChatDeliveryService,
    { provide: CHAT_FETCH, useValue: globalThis.fetch.bind(globalThis) },
    {
      provide: CHAT_SLEEP,
      useValue: (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
  ],
  exports: [
    ChatChannelService,
    ChatChannelRepository,
    ChatDeliveryService,
    GoogleChatClient,
  ],
})
export class ChatChannelModule {}
