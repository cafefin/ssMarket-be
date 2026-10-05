import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ACCESS_COOKIE } from './modules/auth/auth.constants.js';

/** Everything main.ts and the integration tests must configure identically. */
export function configureApp(app: NestExpressApplication): void {
  // Requests arrive through the frontend proxy (and later Nginx); trust one
  // hop so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  // This API serves JSON and Swagger UI only; the default CSP breaks Swagger UI.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ssMarket API')
      .setVersion('1.0')
      .addCookieAuth(ACCESS_COOKIE)
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
