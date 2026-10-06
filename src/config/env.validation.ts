import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { parseAdminEmails } from './admin-emails.js';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 4000;

  @IsUrl({ require_tld: false })
  WEB_URL!: string;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(1)
  REDIS_URL!: string;

  @IsString()
  @MinLength(1)
  GOOGLE_CLIENT_ID!: string;

  @IsString()
  @MinLength(1)
  GOOGLE_CLIENT_SECRET!: string;

  @IsString()
  @MinLength(3)
  ALLOWED_EMAIL_DOMAIN!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  /**
   * Enables GET /auth/dev-login, a sign-in without Google for local testing.
   * A string, not a boolean: implicit conversion would turn "false" into true.
   */
  @IsIn(['true', 'false'])
  DEV_LOGIN_ENABLED: string = 'false';

  /** Comma-separated emails that get the admin role at sign-in. */
  @IsString()
  ADMIN_EMAILS: string = '';

  /** Directory where uploaded images are stored on local disk. */
  @IsString()
  @MinLength(1)
  UPLOAD_DIR: string = './uploads';
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const names = errors.map((error) => error.property).join(', ');
    throw new Error(`Invalid environment variables: ${names}`);
  }

  if (
    validated.DEV_LOGIN_ENABLED === 'true' &&
    validated.NODE_ENV === NodeEnv.Production
  ) {
    throw new Error('DEV_LOGIN_ENABLED must not be true in production');
  }

  // Throws on a malformed entry, so a typo cannot silently drop an admin.
  parseAdminEmails(validated.ADMIN_EMAILS);

  return validated;
}
