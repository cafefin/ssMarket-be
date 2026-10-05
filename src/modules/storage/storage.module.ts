import { Global, Module } from '@nestjs/common';
import { LocalStorageService } from './local-storage.service.js';
import { MediaController } from './media.controller.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  controllers: [MediaController],
  providers: [{ provide: StorageService, useClass: LocalStorageService }],
  exports: [StorageService],
})
export class StorageModule {}
