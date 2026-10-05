import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from './user.entity.js';
import { UsersRepository } from './users.repository.js';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async upsertFromGoogle(profile: GoogleProfile): Promise<User> {
    const existing = await this.users.findByGoogleId(profile.googleId);

    return this.users.save({
      // Passing the existing id turns the save into an update.
      id: existing?.id,
      googleId: profile.googleId,
      email: profile.email.toLowerCase(),
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    });
  }

  findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  async getById(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
