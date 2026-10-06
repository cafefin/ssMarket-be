import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BanksModule } from '../banks/banks.module.js';
import { ListingsModule } from '../listings/listings.module.js';
import { UsersModule } from '../users/users.module.js';
import { IdempotencyService } from './idempotency.service.js';
import { OrderLine } from './order-line.entity.js';
import { Order } from './order.entity.js';
import { OrdersController, SalesController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderLine]),
    ListingsModule,
    UsersModule,
    BanksModule,
  ],
  controllers: [OrdersController, SalesController],
  providers: [OrdersRepository, OrdersService, IdempotencyService],
})
export class OrdersModule {}
