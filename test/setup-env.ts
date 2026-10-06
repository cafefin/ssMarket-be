import 'reflect-metadata';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs before every test file. Forces the test database and a separate Redis
// database so a test run can never wipe development data.
process.env.NODE_ENV = 'test';
process.env.PORT = '4000';
process.env.WEB_URL = 'http://localhost:3000';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://ssmarket:ssmarket@localhost:5433/ssmarket_test';
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/1';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.ALLOWED_EMAIL_DOMAIN = 'example.com';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.UPLOAD_DIR = join(tmpdir(), 'ssmarket-test-uploads');
process.env.ADMIN_EMAILS = 'admin@example.com';
