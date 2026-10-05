import { validateEnv } from './env.validation.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  ALLOWED_EMAIL_DOMAIN: 'example.com',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
};

function without(...keys: Array<keyof typeof valid>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...valid };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

describe('validateEnv', () => {
  it('returns typed values and converts PORT to a number', () => {
    const env = validateEnv(valid);

    expect(env.PORT).toBe(4000);
    expect(env.ALLOWED_EMAIL_DOMAIN).toBe('example.com');
  });

  it('applies defaults for NODE_ENV and PORT', () => {
    const env = validateEnv(without('NODE_ENV', 'PORT'));

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.UPLOAD_DIR).toBe('./uploads');
  });

  it('names every missing variable in the error', () => {
    expect(() => validateEnv(without('DATABASE_URL', 'REDIS_URL'))).toThrow(
      'Invalid environment variables: DATABASE_URL, REDIS_URL',
    );
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      'Invalid environment variables: JWT_ACCESS_SECRET',
    );
  });
});
