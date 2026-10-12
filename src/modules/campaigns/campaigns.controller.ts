import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CampaignsService } from './campaigns.service.js';
import { CampaignInputDto } from './dto/campaign-input.dto.js';
import {
  CampaignDetailDto,
  CampaignMineDto,
} from './dto/campaign-response.dto.js';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('campaigns')
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiCreatedResponse({
    type: CampaignDetailDto,
    description: 'A draft pre-order round with its products',
  })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CampaignInputDto,
  ): Promise<CampaignDetailDto> {
    const campaign = await this.campaigns.create(user.id, body.toInput());
    return this.campaigns.getDetail(user.id, campaign.id);
  }

  // Declared before ':id' so that "mine" is not read as an id.
  @Get('mine')
  @ApiOkResponse({ type: [CampaignMineDto] })
  listMine(@CurrentUser() user: AuthUser): Promise<CampaignMineDto[]> {
    return this.campaigns.listMine(user.id);
  }

  @Get(':id')
  @ApiOkResponse({ type: CampaignDetailDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDetailDto> {
    return this.campaigns.getDetail(user.id, id);
  }

  @Patch(':id')
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiOkResponse({ type: CampaignDetailDto })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CampaignInputDto,
  ): Promise<CampaignDetailDto> {
    await this.campaigns.update(user.id, id, body.toInput());
    return this.campaigns.getDetail(user.id, id);
  }

  @Post(':id/publish')
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CampaignDetailDto })
  async publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDetailDto> {
    await this.campaigns.publish(user.id, id);
    return this.campaigns.getDetail(user.id, id);
  }

  @Post(':id/close')
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CampaignDetailDto })
  async close(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDetailDto> {
    await this.campaigns.close(user.id, id);
    return this.campaigns.getDetail(user.id, id);
  }

  @Delete(':id')
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The draft was deleted' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.campaigns.remove(user.id, id);
  }
}
