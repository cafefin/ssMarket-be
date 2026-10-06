import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PublicUserDto } from './dto/public-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async me(@CurrentUser() current: AuthUser): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.users.getById(current.id));
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async updateMe(
    @CurrentUser() current: AuthUser,
    @Body() body: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(
      await this.users.updateProfile(current.id, body),
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOkResponse({ type: PublicUserDto })
  @ApiNotFoundResponse({ description: 'No such person' })
  async publicProfile(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicUserDto> {
    return PublicUserDto.from(await this.users.getById(id));
  }
}
