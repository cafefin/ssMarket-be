import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListingImage } from './listing-image.entity.js';

@Injectable()
export class ListingImagesRepository {
  constructor(
    @InjectRepository(ListingImage)
    private readonly repository: Repository<ListingImage>,
  ) {}

  findByListing(listingId: string): Promise<ListingImage[]> {
    return this.repository.find({
      where: { listingId },
      order: { sortOrder: 'ASC' },
    });
  }

  findOne(listingId: string, id: string): Promise<ListingImage | null> {
    return this.repository.findOne({ where: { id, listingId } });
  }

  create(image: {
    listingId: string;
    storageKey: string;
    sortOrder: number;
  }): Promise<ListingImage> {
    return this.repository.save(this.repository.create(image));
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }
}
