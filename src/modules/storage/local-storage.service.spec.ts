import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import {
  isSafeStorageKey,
  LocalStorageService,
} from './local-storage.service.js';

describe('LocalStorageService', () => {
  let root: string;
  let storage: LocalStorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ssmarket-storage-'));
    storage = new LocalStorageService({
      get: () => root,
    } as unknown as ConfigService<EnvironmentVariables, true>);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores a file under nested directories and reads it back', async () => {
    await storage.put('listings/abc/photo.webp', Buffer.from('image-bytes'));

    const file = await storage.get('listings/abc/photo.webp');

    expect(file?.data.toString()).toBe('image-bytes');
    expect(file?.contentType).toBe('image/webp');
    expect(existsSync(join(root, 'listings/abc/photo.webp'))).toBe(true);
  });

  it('returns null for a key that does not exist', async () => {
    await expect(storage.get('listings/abc/missing.webp')).resolves.toBeNull();
  });

  it('deletes a file and ignores a missing one', async () => {
    await storage.put('a/b.webp', Buffer.from('x'));

    await storage.delete('a/b.webp');
    await storage.delete('a/b.webp');

    await expect(storage.get('a/b.webp')).resolves.toBeNull();
  });

  it.each([
    '../secret.webp',
    'a/../../secret.webp',
    '/etc/passwd.webp',
    'a\\b.webp',
    'a//b.webp',
    'a/b.png',
    'a/.env',
    '',
    `${'a'.repeat(260)}.webp`,
  ])('refuses the unsafe key %j', async (key) => {
    expect(isSafeStorageKey(key)).toBe(false);
    await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(
      'Unsafe storage key',
    );
    await expect(storage.delete(key)).rejects.toThrow('Unsafe storage key');
    await expect(storage.get(key)).resolves.toBeNull();
  });

  it('never reads outside its root, even when such a file exists', async () => {
    await writeFile(join(root, '..', 'outside.webp'), 'secret').catch(
      () => undefined,
    );

    await expect(storage.get('../outside.webp')).resolves.toBeNull();
    await rm(join(root, '..', 'outside.webp'), { force: true });
  });
});
