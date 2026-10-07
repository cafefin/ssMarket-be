import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListingsModule } from '../listings/listings.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { UsersModule } from '../users/users.module.js';
import { CartLine } from './cart-line.entity.js';
import { CartController, CheckoutController } from './cart.controller.js';
import { CartRepository } from './cart.repository.js';
import { CartService } from './cart.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([CartLine]),
    ListingsModule,
    OrdersModule,
    UsersModule,
  ],
  controllers: [CartController, CheckoutController],
  providers: [CartRepository, CartService],
})
export class CartModule {}
