import sharp from 'sharp';
import { DomainException } from '../../common/errors/domain.exception.js';
import { processListingImage } from './image-processor.js';

function solid(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  });
}

async function expectInvalid(input: Buffer): Promise<void> {
  const error = await processListingImage(input).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).code).toBe('INVALID_IMAGE');
}

describe('processListingImage', () => {
  it('shrinks a large photo to 1600px and a 400px thumbnail, both WebP', async () => {
    const input = await solid(3000, 2000).jpeg().toBuffer();

    const { full, thumbnail } = await processListingImage(input);

    const fullMeta = await sharp(full).metadata();
    const thumbMeta = await sharp(thumbnail).metadata();
    expect(fullMeta).toMatchObject({
      format: 'webp',
      width: 1600,
      height: 1067,
    });
    expect(thumbMeta).toMatchObject({
      format: 'webp',
      width: 400,
      height: 267,
    });
  });

  it('does not enlarge a small image', async () => {
    const input = await solid(200, 100).png().toBuffer();

    const { full, thumbnail } = await processListingImage(input);

    expect(await sharp(full).metadata()).toMatchObject({
      width: 200,
      height: 100,
    });
    expect(await sharp(thumbnail).metadata()).toMatchObject({
      width: 200,
      height: 100,
    });
  });

  it('accepts WebP input', async () => {
    const input = await solid(50, 50).webp().toBuffer();

    await expect(processListingImage(input)).resolves.toBeDefined();
  });

  it('removes EXIF data such as GPS coordinates', async () => {
    const input = await solid(100, 100)
      .jpeg()
      .withExif({
        IFD0: { Make: 'PhoneMaker', Model: 'Phone 1' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '21/1 1/1 0/1' },
      })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const { full, thumbnail } = await processListingImage(input);

    expect((await sharp(full).metadata()).exif).toBeUndefined();
    expect((await sharp(thumbnail).metadata()).exif).toBeUndefined();
  });

  it('turns a photo upright using its EXIF orientation', async () => {
    // Orientation 6 means "rotate 90° clockwise to display".
    const input = await solid(300, 100)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const { full } = await processListingImage(input);

    expect(await sharp(full).metadata()).toMatchObject({
      width: 100,
      height: 300,
    });
  });

  it.each([
    ['random bytes', Buffer.from('this is definitely not an image')],
    ['an empty file', Buffer.alloc(0)],
    [
      'an SVG',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
      ),
    ],
  ])('rejects %s', async (_label, input) => {
    await expectInvalid(input);
  });

  it('rejects a GIF', async () => {
    await expectInvalid(await solid(10, 10).gif().toBuffer());
  });
});
