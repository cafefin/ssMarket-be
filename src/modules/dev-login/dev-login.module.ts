import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DevLoginController } from './dev-login.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [DevLoginController],
})
export class DevLoginModule {}
