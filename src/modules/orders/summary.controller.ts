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
import {
  BulkOrdersDto,
  BulkResponseDto,
  SalesSummaryDto,
} from './dto/summary.dto.js';
import { SalesSummaryService } from './sales-summary.service.js';
import { buildSummaryCsv } from './summary-csv.js';

const includeCancelledPipe = new ParseBoolPipe({ optional: true });

@ApiTags('orders')
@Controller('listings/:listingId')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class SummaryController {
  constructor(private readonly summary: SalesSummaryService) {}

  @Get('summary')
  @ApiQuery({ name: 'includeCancelled', type: Boolean, required: false })
  @ApiOkResponse({ type: SalesSummaryDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Query('includeCancelled', includeCancelledPipe) includeCancelled?: boolean,
  ): Promise<SalesSummaryDto> {
    return this.summary.getSummary(
      user.id,
      listingId,
      includeCancelled ?? false,
    );
  }

  @Get('summary.csv')
  @ApiQuery({ name: 'includeCancelled', type: Boolean, required: false })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'The summary as a CSV file for Excel' })
  async csv(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Res() res: Response,
    @Query('includeCancelled', includeCancelledPipe) includeCancelled?: boolean,
  ): Promise<void> {
    const summary = await this.summary.getSummary(
      user.id,
      listingId,
      includeCancelled ?? false,
    );
    const slug =
      normalizeForSearch(summary.listing.title)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'bai-dang';

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ssmarket-${slug}-${businessDate(new Date())}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(buildSummaryCsv(summary));
  }

  @Post('orders/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkResponseDto })
  async bulk(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() body: BulkOrdersDto,
  ): Promise<BulkResponseDto> {
    return {
      results: await this.summary.bulk(
        user.id,
        listingId,
        body.action,
        body.orderIds,
      ),
    };
  }
}
