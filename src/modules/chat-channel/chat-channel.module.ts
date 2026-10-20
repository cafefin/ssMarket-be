import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatChannelRepository } from './chat-channel.repository.js';
import { ChatChannelService } from './chat-channel.service.js';
import { ChatDelivery } from './chat-delivery.entity.js';
import { ChatSettings } from './chat-settings.entity.js';
import { ChatTemplate } from './chat-template.entity.js';
import {
  CHAT_FETCH,
  CHAT_SLEEP,
  GoogleChatClient,
} from './google-chat.client.js';

/** No controller: the worker imports this module. The admin API is a separate module. */
@Module({
  imports: [TypeOrmModule.forFeature([ChatSettings, ChatTemplate, ChatDelivery])],
  providers: [
    ChatChannelRepository,
    GoogleChatClient,
    ChatChannelService,
    { provide: CHAT_FETCH, useValue: globalThis.fetch.bind(globalThis) },
    {
      provide: CHAT_SLEEP,
      useValue: (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
  ],
  exports: [ChatChannelService, ChatChannelRepository, GoogleChatClient],
})
export class ChatChannelModule {}
