import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { BankResponseDto } from './bank-response.dto.js';
import { BanksService } from './banks.service.js';

@ApiTags('banks')
@Controller('banks')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth()
export class BanksController {
  constructor(private readonly banks: BanksService) {}

  @Get()
  @ApiOkResponse({ type: [BankResponseDto] })
  list(): BankResponseDto[] {
    return [...this.banks.list()];
  }
}
