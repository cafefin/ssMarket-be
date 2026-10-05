import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

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

  return validated;
}
