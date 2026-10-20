import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UserRole } from '../users/user.entity.js';
import { ChatChannelService } from './chat-channel.service.js';
import {
  ChatChannelDto,
  ChatDeliveryPageDto,
  ChatPreviewDto,
  ChatTemplateBodyDto,
  ChatTemplateDto,
  ChatTestBodyDto,
  UpdateChatSettingsDto,
  UpdateChatTemplateDto,
} from './dto/chat-channel.dto.js';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('admin')
@Controller('admin/chat-channel')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
@ApiCookieAuth()
@ApiForbiddenResponse({ description: 'The caller is not an admin' })
export class AdminChatChannelController {
  constructor(private readonly chat: ChatChannelService) {}

  @Get()
  @ApiOkResponse({ type: ChatChannelDto })
  get(): Promise<ChatChannelDto> {
    return this.chat.get();
  }

  @Put()
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiOkResponse({ type: ChatChannelDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CHAT_SETTINGS' })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateChatSettingsDto,
  ): Promise<ChatChannelDto> {
    return this.chat.updateSettings(user.id, body);
  }

  @Put('templates/:eventType')
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiOkResponse({ type: ChatTemplateDto })
  @ApiNotFoundResponse({ description: 'Unknown event type' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CHAT_TEMPLATE' })
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('eventType') eventType: string,
    @Body() body: UpdateChatTemplateDto,
  ): Promise<ChatTemplateDto> {
    return this.chat.updateTemplate(user.id, eventType, body);
  }

  @Post('templates/:eventType/preview')
  @HttpCode(200)
  @ApiOkResponse({ type: ChatPreviewDto })
  @ApiNotFoundResponse({ description: 'Unknown event type' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CHAT_TEMPLATE' })
  preview(
    @Param('eventType') eventType: string,
    @Body() body: ChatTemplateBodyDto,
  ): ChatPreviewDto {
    return this.chat.preview(eventType, body.template);
  }

  @Post('templates/:eventType/test')
  @HttpCode(200)
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiOkResponse({ type: ChatPreviewDto })
  @ApiNotFoundResponse({ description: 'Unknown event type' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_CHAT_TEMPLATE' })
  @ApiConflictResponse({ description: 'CHAT_WEBHOOK_NOT_SET' })
  @ApiBadGatewayResponse({ description: 'CHAT_SEND_FAILED' })
  test(
    @Param('eventType') eventType: string,
    @Body() body: ChatTestBodyDto,
  ): Promise<ChatPreviewDto> {
    return this.chat.sendTest(eventType, body.template);
  }

  @Get('deliveries')
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOkResponse({ type: ChatDeliveryPageDto })
  deliveries(@Query('cursor') cursor?: string): Promise<ChatDeliveryPageDto> {
    return this.chat.listDeliveries(cursor);
  }
}
