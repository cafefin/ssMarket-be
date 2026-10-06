import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Mocked } from 'vitest';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { BanksService } from '../banks/banks.service.js';
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
    deliveryLocation: null,
    bankBin: null,
    bankAccountNumber: null,
    bankAccountName: null,
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

  const buildService = (adminEmails: string) =>
    new UsersService(
      repository as unknown as UsersRepository,
      new BanksService(),
      { get: () => adminEmails } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
    );

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findByGoogleId: vi.fn(),
      save: vi.fn((user: Partial<User>) => Promise.resolve(buildUser(user))),
    };
    service = buildService('');
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
        role: UserRole.User,
      });
      expect(user.email).toBe('an@example.com');
    });

    it('makes a listed email an admin, whatever its case', async () => {
      repository.findByGoogleId.mockResolvedValue(null);
      service = buildService('AN@example.com');

      await service.upsertFromGoogle(profile);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.Admin }),
      );
    });

    it('takes the role away from someone no longer listed', async () => {
      repository.findByGoogleId.mockResolvedValue(
        buildUser({ role: UserRole.Admin }),
      );

      await service.upsertFromGoogle(profile);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', role: UserRole.User }),
      );
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

  describe('updateProfile', () => {
    const bank = {
      bankBin: '970436',
      bankAccountNumber: '0123456789',
      bankAccountName: 'Nguyễn  Văn An',
    };

    it('throws NotFoundException for an unknown user', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.updateProfile('missing', { deliveryLocation: 'Tầng 7' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('trims the delivery location and leaves bank fields unchanged', async () => {
      repository.findById.mockResolvedValue(
        buildUser({
          bankBin: '970436',
          bankAccountNumber: '1',
          bankAccountName: 'A',
        }),
      );

      const user = await service.updateProfile('user-1', {
        deliveryLocation: '  Tầng 7  ',
      });

      expect(user.deliveryLocation).toBe('Tầng 7');
      expect(user.bankBin).toBe('970436');
    });

    it('stores an empty delivery location as null', async () => {
      repository.findById.mockResolvedValue(
        buildUser({ deliveryLocation: 'Tầng 7' }),
      );

      const user = await service.updateProfile('user-1', {
        deliveryLocation: '   ',
      });

      expect(user.deliveryLocation).toBeNull();
    });

    it('saves bank details with the account name in unaccented upper case', async () => {
      repository.findById.mockResolvedValue(buildUser());

      const user = await service.updateProfile('user-1', bank);

      expect(user).toMatchObject({
        bankBin: '970436',
        bankAccountNumber: '0123456789',
        bankAccountName: 'NGUYEN VAN AN',
      });
    });

    it('clears bank details when all three are null', async () => {
      repository.findById.mockResolvedValue(buildUser(bank));

      const user = await service.updateProfile('user-1', {
        bankBin: null,
        bankAccountNumber: null,
        bankAccountName: null,
      });

      expect(user).toMatchObject({
        bankBin: null,
        bankAccountNumber: null,
        bankAccountName: null,
      });
    });

    it.each([
      ['only one bank field', { bankBin: '970436' }],
      ['a mix of null and values', { ...bank, bankAccountName: null }],
    ])('rejects %s', async (_label, input) => {
      repository.findById.mockResolvedValue(buildUser());

      await expect(
        service.updateProfile('user-1', input),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects a bank that is not in the directory', async () => {
      repository.findById.mockResolvedValue(buildUser());

      await expect(
        service.updateProfile('user-1', { ...bank, bankBin: '000000' }),
      ).rejects.toThrow('Unknown bank');
    });
  });

  describe('hasBankProfile', () => {
    it('is true only when all three bank fields are set', () => {
      expect(service.hasBankProfile(buildUser())).toBe(false);
      expect(
        service.hasBankProfile(
          buildUser({
            bankBin: '970436',
            bankAccountNumber: '0123456789',
            bankAccountName: 'NGUYEN VAN AN',
          }),
        ),
      ).toBe(true);
    });
  });
});
