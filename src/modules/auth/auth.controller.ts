import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiExcludeEndpoint,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { readCookie } from '../../common/http/read-cookie.js';
import {
  type EnvironmentVariables,
  NodeEnv,
} from '../../config/env.validation.js';
import { clearAuthCookies, setAuthCookies } from './auth-cookies.js';
import { REFRESH_COOKIE } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { GoogleIdentity } from './auth.types.js';
import { GoogleAuthGuard } from './guards/google-auth.guard.js';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  private readonly webUrl: string;
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webUrl = config.get('WEB_URL', { infer: true });
    this.secureCookies =
      config.get('NODE_ENV', { infer: true }) === NodeEnv.Production;
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  google(): void {
    // GoogleAuthGuard redirects to Google before this body runs.
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  async googleCallback(
    @Req() req: Request & { user?: GoogleIdentity | null },
    @Res() res: Response,
  ): Promise<void> {
    if (!req.user) {
      res.redirect(`${this.webUrl}/login?error=login_failed`);
      return;
    }

    const profile = this.auth.toAllowedProfile(req.user);
    if (!profile) {
      res.redirect(`${this.webUrl}/login?error=domain_not_allowed`);
      return;
    }

    const tokens = await this.auth.login(profile);
    setAuthCookies(res, tokens, this.secureCookies);
    res.redirect(`${this.webUrl}/`);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'New token cookies were set' })
  @ApiUnauthorizedResponse({ description: 'Refresh token missing or invalid' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      const tokens = await this.auth.refresh(readCookie(req, REFRESH_COOKIE));
      setAuthCookies(res, tokens, this.secureCookies);
    } catch (error) {
      clearAuthCookies(res, this.secureCookies);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Session ended' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readCookie(req, REFRESH_COOKIE));
    clearAuthCookies(res, this.secureCookies);
  }
}
