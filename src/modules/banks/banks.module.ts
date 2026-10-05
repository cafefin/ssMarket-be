import { Module } from '@nestjs/common';
import { BanksController } from './banks.controller.js';
import { BanksService } from './banks.service.js';

@Module({
  controllers: [BanksController],
  providers: [BanksService],
  exports: [BanksService],
})
export class BanksModule {}
