import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CartService } from './cart.service.js';
import {
  CartCountDto,
  CartDto,
  CheckoutPreviewDto,
  CheckoutPreviewRequestDto,
  CheckoutRequestDto,
  CheckoutResultDto,
  SetCartLineDto,
} from './dto/cart.dto.js';

@ApiTags('cart')
@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOkResponse({ type: CartDto })
  get(@CurrentUser() user: AuthUser): Promise<CartDto> {
    return this.cart.get(user.id);
  }

  @Get('count')
  @ApiOkResponse({ type: CartCountDto })
  async count(@CurrentUser() user: AuthUser): Promise<CartCountDto> {
    return { count: await this.cart.count(user.id) };
  }

  @Put('lines/:itemId')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOkResponse({ type: CartDto })
  setLine(
    @CurrentUser() user: AuthUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: SetCartLineDto,
  ): Promise<CartDto> {
    return this.cart.setLine(user.id, itemId, body.quantity);
  }

  @Delete('lines/:itemId')
  @ApiOkResponse({ type: CartDto })
  removeLine(
    @CurrentUser() user: AuthUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<CartDto> {
    return this.cart.removeLine(user.id, itemId);
  }
}

@ApiTags('cart')
@Controller('checkout')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class CheckoutController {
  constructor(private readonly cart: CartService) {}

  @Post('preview')
  @ApiOkResponse({ type: CheckoutPreviewDto })
  preview(
    @CurrentUser() user: AuthUser,
    @Body() body: CheckoutPreviewRequestDto,
  ): Promise<CheckoutPreviewDto> {
    return this.cart.preview(user.id, body.lines);
  }

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A UUID generated once per checkout page',
  })
  @ApiCreatedResponse({ type: CheckoutResultDto })
  @ApiOkResponse({
    type: CheckoutResultDto,
    description: 'The orders this key already created',
  })
  async checkout(
    @CurrentUser() user: AuthUser,
    @Body() body: CheckoutRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutResultDto> {
    const { orders, replayed } = await this.cart.checkout(
      user.id,
      body,
      idempotencyKey,
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return { orders };
  }
}
