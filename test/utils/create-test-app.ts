import type { ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { UserThrottlerGuard } from '../../src/common/guards/user-throttler.guard.js';
import type { GoogleIdentity } from '../../src/modules/auth/auth.types.js';
import { GoogleAuthGuard } from '../../src/modules/auth/guards/google-auth.guard.js';

/**
 * Boots the real app against the test Postgres and Redis. Only Google itself
 * is replaced: the guard puts `identity.current` on the request, exactly as
 * Passport would after a real sign-in.
 */
export async function createTestApp(identity: {
  current: GoogleIdentity | null;
}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(GoogleAuthGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest<{ user: unknown }>().user =
          identity.current;
        return true;
      },
    })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(UserThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  await app.get(DataSource).runMigrations();

  return app;
}
