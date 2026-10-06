import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { setAuthCookies } from '../auth/auth-cookies.js';
import { AuthService } from '../auth/auth.service.js';

const NAME = /^[a-z0-9-]{1,30}$/;

/**
 * Signs in as a made-up person without Google, so one developer can play
 * buyer and seller at once. This controller is only registered when
 * isDevLoginEnabled() is true; everywhere else the route does not exist.
 */
@ApiExcludeController()
@Controller('auth/dev-login')
export class DevLoginController {
  private readonly logger = new Logger(DevLoginController.name);
  private readonly webUrl: string;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webUrl = config.get('WEB_URL', { infer: true });
  }

  @Get()
  async signIn(
    @Query('as') name: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!name || !NAME.test(name)) {
      throw new BadRequestException(
        'Use ?as=<name> with 1-30 lowercase letters, digits or dashes',
      );
    }

    this.logger.warn(`Development sign-in as "${name}"`);
    const tokens = await this.auth.login({
      // The prefix keeps these accounts apart from real Google accounts, and
      // .invalid is a reserved top-level domain that can never receive mail.
      googleId: `dev-${name}`,
      email: `${name}@dev.invalid`,
      name: `Dev ${name}`,
      avatarUrl: null,
    });
    setAuthCookies(res, tokens, false);
    res.redirect(`${this.webUrl}/`);
  }
}
