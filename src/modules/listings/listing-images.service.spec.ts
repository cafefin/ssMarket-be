import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import type { CacheService } from '../../cache/cache.service.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { StorageService } from '../storage/storage.service.js';
import type { ListingImage } from './listing-image.entity.js';
import type { ListingImagesRepository } from './listing-images.repository.js';
import { ListingImagesService } from './listing-images.service.js';
import { ListingStatus } from './listings.constants.js';
import type { ListingsRepository } from './listings.repository.js';

const SELLER = 'seller-1';
const LISTING = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DomainException);
  return (error as DomainException).code;
}

describe('ListingImagesService', () => {
  const listings = { findByIdWithRelations: vi.fn() };
  const images = {
    findByListing: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
  const cache = { bumpVersion: vi.fn() };
  let service: ListingImagesService;
  let photo: Buffer;

  beforeAll(async () => {
    photo = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    listings.findByIdWithRelations.mockResolvedValue({
      id: LISTING,
      sellerId: SELLER,
      status: ListingStatus.Draft,
    });
    images.findByListing.mockResolvedValue([]);
    images.create.mockImplementation((image: object) =>
      Promise.resolve({ id: 'image-1', ...image }),
    );
    service = new ListingImagesService(
      listings as unknown as ListingsRepository,
      images as unknown as ListingImagesRepository,
      storage as unknown as StorageService,
      cache as unknown as CacheService,
    );
  });

  describe('add', () => {
    it('stores the image and its thumbnail, then records it', async () => {
      images.findByListing.mockResolvedValue([
        { sortOrder: 0 },
        { sortOrder: 3 },
      ]);

      const image = await service.add(SELLER, LISTING, photo);

      const [fullKey] = storage.put.mock.calls[0] as [string, Buffer];
      const [thumbKey] = storage.put.mock.calls[1] as [string, Buffer];
      expect(fullKey).toMatch(
        new RegExp(`^listings/${LISTING}/[0-9a-f-]{36}\\.webp$`),
      );
      expect(thumbKey).toBe(fullKey.replace('.webp', '_thumb.webp'));
      expect(image).toMatchObject({
        listingId: LISTING,
        storageKey: fullKey,
        sortOrder: 4,
      });
      expect(cache.bumpVersion).toHaveBeenCalledWith('listings');
    });

    it('is 404 for a missing listing and 403 for someone else’s', async () => {
      await expect(
        service.add('someone-else', LISTING, photo),
      ).rejects.toBeInstanceOf(ForbiddenException);

      listings.findByIdWithRelations.mockResolvedValue(null);
      await expect(service.add(SELLER, LISTING, photo)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a closed listing', async () => {
      listings.findByIdWithRelations.mockResolvedValue({
        id: LISTING,
        sellerId: SELLER,
        status: ListingStatus.Closed,
      });

      await expect(codeOf(service.add(SELLER, LISTING, photo))).resolves.toBe(
        'INVALID_LISTING_STATE',
      );
    });

    it('takes an image for a product of a round, even one not on sale', async () => {
      listings.findByIdWithRelations.mockResolvedValue({
        id: LISTING,
        sellerId: SELLER,
        status: ListingStatus.Closed,
        campaign: { status: 'open' },
      });

      await expect(service.add(SELLER, LISTING, photo)).resolves.toMatchObject({
        id: 'image-1',
      });
    });

    it('refuses a product of a closed round', async () => {
      listings.findByIdWithRelations.mockResolvedValue({
        id: LISTING,
        sellerId: SELLER,
        status: ListingStatus.Open,
        campaign: { status: 'closed' },
      });

      await expect(codeOf(service.add(SELLER, LISTING, photo))).resolves.toBe(
        'INVALID_LISTING_STATE',
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a sixth image', async () => {
      images.findByListing.mockResolvedValue(
        Array.from({ length: 5 }, (_, sortOrder) => ({ sortOrder })),
      );

      await expect(codeOf(service.add(SELLER, LISTING, photo))).resolves.toBe(
        'TOO_MANY_IMAGES',
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a file that is not an image', async () => {
      await expect(
        codeOf(service.add(SELLER, LISTING, Buffer.from('not an image'))),
      ).resolves.toBe('INVALID_IMAGE');
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('removes the full-size file when the thumbnail cannot be stored', async () => {
      storage.put
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(service.add(SELLER, LISTING, photo)).rejects.toThrow(
        'disk full',
      );

      const [fullKey] = storage.put.mock.calls[0] as [string, Buffer];
      expect(storage.delete).toHaveBeenCalledWith(fullKey);
      expect(images.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the row and both files', async () => {
      images.findOne.mockResolvedValue({
        id: 'image-1',
        storageKey: 'listings/x/y.webp',
      });

      await service.remove(SELLER, LISTING, 'image-1');

      expect(images.delete).toHaveBeenCalledWith('image-1');
      expect(storage.delete).toHaveBeenCalledWith('listings/x/y.webp');
      expect(storage.delete).toHaveBeenCalledWith('listings/x/y_thumb.webp');
      expect(cache.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it('is 404 when the image does not belong to the listing', async () => {
      images.findOne.mockResolvedValue(null);

      await expect(
        service.remove(SELLER, LISTING, 'image-of-another-listing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('is 403 for someone else’s listing', async () => {
      await expect(
        service.remove('someone-else', LISTING, 'image-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('removeFiles', () => {
    it('deletes each file and its thumbnail', async () => {
      await service.removeFiles(['listings/a/1.webp', 'listings/b/2.webp']);

      expect(storage.delete.mock.calls.map(([key]) => key as string)).toEqual([
        'listings/a/1.webp',
        'listings/a/1_thumb.webp',
        'listings/b/2.webp',
        'listings/b/2_thumb.webp',
      ]);
    });

    it('logs a file it cannot delete and goes on with the rest', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      storage.delete.mockRejectedValueOnce(new Error('disk gone'));

      await expect(
        service.removeFiles(['listings/a/1.webp', 'listings/b/2.webp']),
      ).resolves.toBeUndefined();

      expect(storage.delete).toHaveBeenCalledTimes(4);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('listings/a/1.webp');
    });
  });

  describe('copyAll', () => {
    const source = [
      { id: 'image-1', storageKey: 'listings/old/1.webp', sortOrder: 0 },
      { id: 'image-2', storageKey: 'listings/old/2.webp', sortOrder: 1 },
    ] as ListingImage[];

    beforeEach(() => {
      storage.get.mockResolvedValue({
        data: Buffer.from('x'),
        contentType: 'image/webp',
      });
    });

    it('stores a copy of each file and records it for the target', async () => {
      await service.copyAll(source, 'new');

      expect(storage.put).toHaveBeenCalledTimes(4);
      expect(
        images.create.mock.calls.map(([image]) => image as object),
      ).toEqual([
        {
          listingId: 'new',
          storageKey: expect.stringMatching(
            /^listings\/new\/[0-9a-f-]{36}\.webp$/,
          ),
          sortOrder: 0,
        },
        {
          listingId: 'new',
          storageKey: expect.stringMatching(
            /^listings\/new\/[0-9a-f-]{36}\.webp$/,
          ),
          sortOrder: 1,
        },
      ]);
    });

    it('leaves out an image whose file is gone', async () => {
      storage.get.mockResolvedValueOnce(null);

      await service.copyAll(source, 'new');

      expect(images.create).toHaveBeenCalledTimes(1);
      expect(images.create.mock.calls[0][0]).toMatchObject({ sortOrder: 1 });
    });

    it('removes the files of a copy it could not finish, and fails', async () => {
      // First image: both files and the row. Second: the thumbnail fails.
      storage.put
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(service.copyAll(source, 'new')).rejects.toThrow('disk full');

      const second = storage.put.mock.calls[2][0] as string;
      expect(storage.delete.mock.calls.map(([key]) => key as string)).toEqual([
        second,
        second.replace('.webp', '_thumb.webp'),
      ]);
      expect(images.create).toHaveBeenCalledTimes(1);
    });

    it('removes the files of an image it could not record, and fails', async () => {
      images.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.copyAll(source, 'new')).rejects.toThrow(
        'connection lost',
      );

      const first = storage.put.mock.calls[0][0] as string;
      expect(storage.delete.mock.calls.map(([key]) => key as string)).toEqual([
        first,
        first.replace('.webp', '_thumb.webp'),
      ]);
    });
  });
});
