import type { User } from '../db/schema';
import { UserRepository } from '../repositories/user.repository';

export class AuthService {
  private userRepo: UserRepository;

  constructor() {
    this.userRepo = new UserRepository();
  }

  async updateProfile(
    userId: string,
    options: {
      name?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    }
  ): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const updates: Partial<User> = {};

    // Update name
    if (options.name) {
      updates.name = options.name.trim();
    }

    // Update email
    if (options.email) {
      const email = options.email.trim().toLowerCase();
      if (email !== user.email) {
        const existing = await this.userRepo.findByEmail(email);
        if (existing) {
          throw new Error('Email already in use');
        }
        updates.email = email;
      }
    }

    // Update password
    if (options.newPassword) {
      if (!options.currentPassword) {
        throw new Error('Current password required to set new password');
      }
      if (!(await this.userRepo.verifyPassword(user, options.currentPassword))) {
        throw new Error('Current password is incorrect');
      }
      await this.userRepo.updatePassword(userId, options.newPassword);
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      const updatedUser = await this.userRepo.update(userId, updates);
      if (!updatedUser) {
        throw new Error('Failed to update user');
      }
      return updatedUser;
    }

    return user;
  }

  async getUserById(userId: string): Promise<User | undefined> {
    return await this.userRepo.findById(userId);
  }

  userToDict(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      slide_tokens: user.isUnlimited ? Number.POSITIVE_INFINITY : user.slideTokens,
      is_unlimited: user.isUnlimited,
      created_at: user.createdAt.toISOString(),
    };
  }
}
