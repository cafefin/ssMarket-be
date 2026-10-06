import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from './cache/cache.module.js';
import {
  type EnvironmentVariables,
  validateEnv,
} from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './modules/auth/auth.constants.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BanksModule } from './modules/banks/banks.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { isDevLoginEnabled } from './modules/dev-login/dev-login.enabled.js';
import { DevLoginModule } from './modules/dev-login/dev-login.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ListingsModule } from './modules/listings/listings.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Global so JwtAuthGuard can be used by any module without importing AuthModule.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 20 }] }),
    DatabaseModule,
    RedisModule,
    CacheModule,
    StorageModule,
    BanksModule,
    CategoriesModule,
    UsersModule,
    AuthModule,
    ListingsModule,
    OrdersModule,
    HealthModule,
    // Registered only in development with DEV_LOGIN_ENABLED=true; otherwise
    // the route does not exist at all.
    ConditionalModule.registerWhen(DevLoginModule, isDevLoginEnabled),
  ],
})
export class AppModule {}
