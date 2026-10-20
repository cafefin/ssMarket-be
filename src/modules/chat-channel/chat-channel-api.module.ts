import { Module } from '@nestjs/common';
import { AdminChatChannelController } from './admin-chat-channel.controller.js';
import { ChatChannelModule } from './chat-channel.module.js';

/** The HTTP side; the worker imports ChatChannelModule alone. */
@Module({
  imports: [ChatChannelModule],
  controllers: [AdminChatChannelController],
})
export class ChatChannelApiModule {}
