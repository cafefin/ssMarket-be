import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ListingInputDto } from './dto/listing-input.dto.js';
import { ListingQueryDto } from './dto/listing-query.dto.js';
import { ListingDetailDto } from './dto/listing-response.dto.js';
import { ListingPageDto } from './dto/listing-summary.dto.js';
import { ListingStatus } from './listings.constants.js';
import { ListingsService } from './listings.service.js';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('listings')
@Controller('listings')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiCreatedResponse({ type: ListingDetailDto })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: ListingInputDto,
  ): Promise<ListingDetailDto> {
    const listing = await this.listings.create(user.id, body.toInput());
    return ListingDetailDto.from(listing, new Date());
  }

  @Get()
  @ApiOkResponse({ type: ListingPageDto })
  search(@Query() query: ListingQueryDto): Promise<ListingPageDto> {
    return this.listings.search(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: ListingDetailDto })
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListingDetailDto> {
    return this.listings.getPublicDetail(user.id, id);
  }

  @Patch(':id')
  @UseGuards(UserThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  @ApiOkResponse({ type: ListingDetailDto })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ListingInputDto,
  ): Promise<ListingDetailDto> {
    const listing = await this.listings.update(user.id, id, body.toInput());
    return ListingDetailDto.from(listing, new Date());
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListingDetailDto })
  async publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListingDetailDto> {
    const listing = await this.listings.publish(user.id, id);
    return ListingDetailDto.from(listing, new Date());
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListingDetailDto })
  async close(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListingDetailDto> {
    const listing = await this.listings.close(user.id, id);
    return ListingDetailDto.from(listing, new Date());
  }
}

@ApiTags('listings')
@Controller('users/me/listings')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class MyListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiQuery({ name: 'status', enum: ListingStatus, required: false })
  @ApiOkResponse({ type: [ListingDetailDto] })
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status', new ParseEnumPipe(ListingStatus, { optional: true }))
    status?: ListingStatus,
  ): Promise<ListingDetailDto[]> {
    const now = new Date();
    const listings = await this.listings.listMine(user.id, status);
    return listings.map((listing) => ListingDetailDto.from(listing, now));
  }
}
