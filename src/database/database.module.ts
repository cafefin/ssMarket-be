import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { DatabaseHealth } from './database.health.js';
import { migrations } from './migrations/index.js';
import { TransactionRunner } from './transaction.js';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        autoLoadEntities: true,
        synchronize: false,
        migrations,
      }),
    }),
  ],
  providers: [DatabaseHealth, TransactionRunner],
  exports: [DatabaseHealth, TransactionRunner],
})
export class DatabaseModule {}
