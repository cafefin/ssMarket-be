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
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OrderDetailDto, OrderPageDto } from './dto/order-response.dto.js';
import { CancelOrderDto, EditOrderDto } from './dto/order-input.dto.js';
import { FulfillmentStatus, PaymentStatus } from './orders.constants.js';
import { OrdersService } from './orders.service.js';

const optionalUuid = new ParseUUIDPipe({ optional: true });

@ApiTags('orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOkResponse({ type: OrderPageDto })
  listMine(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
  ): Promise<OrderPageDto> {
    return this.orders.listForBuyer(user.id, cursor);
  }

  @Get(':id')
  @ApiOkResponse({ type: OrderDetailDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailDto> {
    return this.orders.getForParticipant(user.id, id);
  }

  @Patch(':id')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ type: OrderDetailDto })
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EditOrderDto,
  ): Promise<OrderDetailDto> {
    return this.orders.edit(user.id, id, body);
  }

  @Post(':id/report-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailDto })
  reportPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailDto> {
    return this.orders.reportPayment(user.id, id);
  }

  @Post(':id/confirm-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailDto })
  confirmPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailDto> {
    return this.orders.confirmPayment(user.id, id);
  }

  @Post(':id/reject-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailDto })
  rejectPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailDto> {
    return this.orders.rejectPayment(user.id, id);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailDto })
  deliver(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailDto> {
    return this.orders.deliver(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelOrderDto,
  ): Promise<OrderDetailDto> {
    return this.orders.cancel(user.id, id, body.reason);
  }
}

@ApiTags('orders')
@Controller('users/me/sales')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class SalesController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiQuery({ name: 'listingId', required: false })
  @ApiQuery({ name: 'paymentStatus', enum: PaymentStatus, required: false })
  @ApiQuery({
    name: 'fulfillmentStatus',
    enum: FulfillmentStatus,
    required: false,
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOkResponse({ type: OrderPageDto })
  list(
    @CurrentUser() user: AuthUser,
    @Query('listingId', optionalUuid) listingId?: string,
    @Query(
      'paymentStatus',
      new ParseEnumPipe(PaymentStatus, { optional: true }),
    )
    paymentStatus?: PaymentStatus,
    @Query(
      'fulfillmentStatus',
      new ParseEnumPipe(FulfillmentStatus, { optional: true }),
    )
    fulfillmentStatus?: FulfillmentStatus,
    @Query('cursor') cursor?: string,
  ): Promise<OrderPageDto> {
    return this.orders.listForSeller(
      user.id,
      { listingId, paymentStatus, fulfillmentStatus },
      cursor,
    );
  }
}
