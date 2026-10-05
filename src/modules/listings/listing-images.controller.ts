import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ListingImageDto } from './dto/listing-response.dto.js';
import { ListingImagesService } from './listing-images.service.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The part of multer's in-memory file object that this controller uses. */
interface UploadedImage {
  buffer: Buffer;
}

@ApiTags('listings')
@Controller('listings/:listingId/images')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class ListingImagesController {
  constructor(private readonly images: ListingImagesService) {}

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // Files stay in memory (no temp files) and are capped at 5 MB; a larger
  // upload is rejected with 413 before it is buffered in full.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: ListingImageDto })
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<ListingImageDto> {
    if (!file) {
      throw new BadRequestException(
        'Send the image in a form field named "file"',
      );
    }
    const image = await this.images.add(user.id, listingId, file.buffer);
    return ListingImageDto.from(image);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Image removed' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    await this.images.remove(user.id, listingId, imageId);
  }
}
