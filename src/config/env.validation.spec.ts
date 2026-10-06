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

  describe('DEV_LOGIN_ENABLED', () => {
    it('defaults to off', () => {
      expect(validateEnv(valid).DEV_LOGIN_ENABLED).toBe('false');
    });

    it('accepts true in development', () => {
      expect(
        validateEnv({ ...valid, DEV_LOGIN_ENABLED: 'true' }).DEV_LOGIN_ENABLED,
      ).toBe('true');
    });

    it('refuses to start in production with it on', () => {
      expect(() =>
        validateEnv({
          ...valid,
          NODE_ENV: 'production',
          DEV_LOGIN_ENABLED: 'true',
        }),
      ).toThrow('DEV_LOGIN_ENABLED must not be true in production');
    });

    it('rejects anything other than true or false', () => {
      expect(() => validateEnv({ ...valid, DEV_LOGIN_ENABLED: '1' })).toThrow(
        'Invalid environment variables: DEV_LOGIN_ENABLED',
      );
    });
  });

  describe('ADMIN_EMAILS', () => {
    it('defaults to empty', () => {
      expect(validateEnv(valid).ADMIN_EMAILS).toBe('');
    });

    it('accepts a comma-separated list', () => {
      expect(
        validateEnv({ ...valid, ADMIN_EMAILS: 'a@example.com, b@example.com' })
          .ADMIN_EMAILS,
      ).toBe('a@example.com, b@example.com');
    });

    it('refuses to start when an entry is not an email', () => {
      expect(() => validateEnv({ ...valid, ADMIN_EMAILS: 'nope' })).toThrow(
        'Invalid ADMIN_EMAILS entry: nope',
      );
    });
  });
});
