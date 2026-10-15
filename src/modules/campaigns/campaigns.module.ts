import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module.js';
import { ListingCombo } from '../listings/listing-combo.entity.js';
import { ListingsModule } from '../listings/listings.module.js';
import { Listing } from '../listings/listing.entity.js';
import { UsersModule } from '../users/users.module.js';
import { Campaign } from './campaign.entity.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsRepository } from './campaigns.repository.js';
import { CampaignsService } from './campaigns.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, Listing, ListingCombo]),
    UsersModule,
    CategoriesModule,
    ListingsModule,
  ],
  controllers: [CampaignsController],
  providers: [CampaignsRepository, CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
