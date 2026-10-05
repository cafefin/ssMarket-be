import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { StorageService } from './storage.service.js';

@ApiTags('media')
@Controller('media')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Get('*key')
  @ApiExcludeEndpoint()
  async serve(
    @Param('key') key: string | string[],
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.storage.get(
      Array.isArray(key) ? key.join('/') : key,
    );
    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Keys are unique per upload and never rewritten, so the browser may keep
    // the file for good. "private" keeps it out of shared caches, because
    // images are only for signed-in employees.
    res.set({
      'Content-Type': file.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(file.data);
  }
}
