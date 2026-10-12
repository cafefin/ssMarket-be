import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BanksModule } from '../banks/banks.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { ListingsModule } from '../listings/listings.module.js';
import { UsersModule } from '../users/users.module.js';
import { CampaignSummaryController } from './campaign-summary.controller.js';
import { CampaignSummaryService } from './campaign-summary.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { OrderLine } from './order-line.entity.js';
import { Order } from './order.entity.js';
import { OrdersController, SalesController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';
import { SalesSummaryService } from './sales-summary.service.js';
import { SummaryController } from './summary.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderLine]),
    ListingsModule,
    CampaignsModule,
    UsersModule,
    BanksModule,
  ],
  controllers: [
    OrdersController,
    SalesController,
    SummaryController,
    CampaignSummaryController,
  ],
  providers: [
    OrdersRepository,
    OrdersService,
    IdempotencyService,
    SalesSummaryService,
    CampaignSummaryService,
  ],
  exports: [OrdersService, IdempotencyService],
})
export class OrdersModule {}
