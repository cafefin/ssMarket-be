import { NotFoundException } from '@nestjs/common';
import type { Mocked } from 'vitest';
import { User, UserRole } from './user.entity.js';
import type { UsersRepository } from './users.repository.js';
import { type GoogleProfile, UsersService } from './users.service.js';

function buildUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: 'user-1',
    email: 'an@example.com',
    name: 'An',
    avatarUrl: null,
    googleId: 'google-1',
    role: UserRole.User,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

const profile: GoogleProfile = {
  googleId: 'google-1',
  email: 'An@Example.com',
  name: 'An Nguyen',
  avatarUrl: 'https://img.example.com/a.png',
};

describe('UsersService', () => {
  let repository: Mocked<
    Pick<UsersRepository, 'findById' | 'findByGoogleId' | 'save'>
  >;
  let service: UsersService;

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findByGoogleId: vi.fn(),
      save: vi.fn((user: Partial<User>) => Promise.resolve(buildUser(user))),
    };
    service = new UsersService(repository as unknown as UsersRepository);
  });

  describe('upsertFromGoogle', () => {
    it('creates a user with a lowercased email when none exists', async () => {
      repository.findByGoogleId.mockResolvedValue(null);

      const user = await service.upsertFromGoogle(profile);

      expect(repository.save).toHaveBeenCalledWith({
        googleId: 'google-1',
        email: 'an@example.com',
        name: 'An Nguyen',
        avatarUrl: 'https://img.example.com/a.png',
      });
      expect(user.email).toBe('an@example.com');
    });

    it('updates name and avatar on the existing user and keeps its id', async () => {
      repository.findByGoogleId.mockResolvedValue(
        buildUser({ id: 'existing-id', name: 'Old name' }),
      );

      await service.upsertFromGoogle(profile);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'existing-id', name: 'An Nguyen' }),
      );
    });
  });

  describe('getById', () => {
    it('returns the user when found', async () => {
      repository.findById.mockResolvedValue(buildUser());

      await expect(service.getById('user-1')).resolves.toMatchObject({
        id: 'user-1',
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('findById returns null when the user does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.findById('missing')).resolves.toBeNull();
  });
});
