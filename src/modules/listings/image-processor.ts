import sharp from 'sharp';
import { DomainException } from '../../common/errors/domain.exception.js';

const ALLOWED_FORMATS = ['jpeg', 'png', 'webp'];
const FULL_EDGE = 1600;
const THUMBNAIL_EDGE = 400;

function invalidImage(): DomainException {
  return new DomainException(
    422,
    'INVALID_IMAGE',
    'The file must be a JPEG, PNG or WebP image',
  );
}

/**
 * Re-encodes an upload as WebP in two sizes. The format is read from the
 * bytes, not from the file name or the Content-Type header. Re-encoding also
 * drops EXIF data such as the GPS position that phones embed in photos.
 */
export async function processListingImage(
  input: Buffer,
): Promise<{ full: Buffer; thumbnail: Buffer }> {
  try {
    const metadata = await sharp(input, { failOn: 'error' }).metadata();
    if (!ALLOWED_FORMATS.includes(metadata.format)) {
      throw invalidImage();
    }

    // rotate() applies the EXIF orientation before that tag is discarded.
    const upright = sharp(input, { failOn: 'error' }).rotate();
    const resize = (edge: number, quality: number) =>
      upright
        .clone()
        .resize({
          width: edge,
          height: edge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer();

    const [full, thumbnail] = await Promise.all([
      resize(FULL_EDGE, 82),
      resize(THUMBNAIL_EDGE, 75),
    ]);
    return { full, thumbnail };
  } catch (error) {
    if (error instanceof DomainException) {
      throw error;
    }
    throw invalidImage();
  }
}
