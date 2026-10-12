import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { normalizeForSearch } from '../../common/text/normalize.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { businessDate } from '../listings/listing-rules.js';
import { UsersService } from '../users/users.service.js';
import { buildCampaignSummaryCsv } from './campaign-summary-csv.js';
import { CampaignSummaryService } from './campaign-summary.service.js';
import {
  CampaignMyOrderDto,
  CampaignSummaryTableDto,
} from './dto/campaign-summary.dto.js';
import { BulkOrdersDto, BulkResponseDto } from './dto/summary.dto.js';

const includeCancelledPipe = new ParseBoolPipe({ optional: true });

@ApiTags('orders')
@Controller('campaigns/:campaignId')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class CampaignSummaryController {
  constructor(
    private readonly summary: CampaignSummaryService,
    private readonly users: UsersService,
  ) {}

  @Get('summary')
  @ApiQuery({ name: 'includeCancelled', type: Boolean, required: false })
  @ApiOkResponse({ type: CampaignSummaryTableDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query('includeCancelled', includeCancelledPipe) includeCancelled?: boolean,
  ): Promise<CampaignSummaryTableDto> {
    return this.summary.getSummary(
      user.id,
      campaignId,
      includeCancelled ?? false,
    );
  }

  @Get('summary.csv')
  @ApiQuery({ name: 'includeCancelled', type: Boolean, required: false })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      "The round summary as a CSV file for Excel, in the caller's language",
  })
  async csv(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Res() res: Response,
    @Query('includeCancelled', includeCancelledPipe) includeCancelled?: boolean,
  ): Promise<void> {
    const [summary, me] = await Promise.all([
      this.summary.getSummary(user.id, campaignId, includeCancelled ?? false),
      this.users.getById(user.id),
    ]);
    const slug =
      normalizeForSearch(summary.campaign.title)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'dot-dat-truoc';

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ssmarket-${slug}-${businessDate(new Date())}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(buildCampaignSummaryCsv(summary, me.locale));
  }

  @Post('orders/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkResponseDto })
  async bulk(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() body: BulkOrdersDto,
  ): Promise<BulkResponseDto> {
    return {
      results: await this.summary.bulk(
        user.id,
        campaignId,
        body.action,
        body.orderIds,
      ),
    };
  }

  @Get('my-order')
  @ApiOkResponse({ type: CampaignMyOrderDto })
  myOrder(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<CampaignMyOrderDto> {
    return this.summary.myOrder(user.id, campaignId);
  }
}
