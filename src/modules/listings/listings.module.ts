import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module.js';
import { UsersModule } from '../users/users.module.js';
import { ListingImage } from './listing-image.entity.js';
import { ListingImagesController } from './listing-images.controller.js';
import { ListingImagesRepository } from './listing-images.repository.js';
import { ListingImagesService } from './listing-images.service.js';
import { ListingItem } from './listing-item.entity.js';
import { Listing } from './listing.entity.js';
import {
  ListingsController,
  MyListingsController,
} from './listings.controller.js';
import { ListingsRepository } from './listings.repository.js';
import { ListingsService } from './listings.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Listing, ListingItem, ListingImage]),
    UsersModule,
    CategoriesModule,
  ],
  controllers: [
    ListingsController,
    MyListingsController,
    ListingImagesController,
  ],
  providers: [
    ListingsRepository,
    ListingsService,
    ListingImagesRepository,
    ListingImagesService,
  ],
  exports: [ListingsService],
})
export class ListingsModule {}
