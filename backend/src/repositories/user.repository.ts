import bcrypt from 'bcryptjs';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { type User, accounts, users } from '../db/schema';

export class UserRepository {
  async findById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async findByName(name: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.name, name));
    return user;
  }

  async deductTokens(userId: string, amount: number): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.isUnlimited && user.slideTokens < amount) {
      throw new Error('Insufficient tokens');
    }

    if (!user.isUnlimited) {
      await db
        .update(users)
        .set({
          slideTokens: user.slideTokens - amount,
        })
        .where(eq(users.id, userId));
    }
  }

  async awardDailyLoginBonus(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const today = new Date().toISOString().split('T')[0];

    if (!user.lastLoginDate || user.lastLoginDate.toISOString().split('T')[0] !== today) {
      await db
        .update(users)
        .set({
          lastLoginDate: new Date(today),
          slideTokens: user.slideTokens + 10,
        })
        .where(eq(users.id, userId));
    }
  }

  async update(userId: string, data: Partial<User>): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), isNotNull(accounts.password)));

    if (!account || !account.password) return false;
    return await bcrypt.compare(password, account.password);
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db
      .update(accounts)
      .set({ password: hashedPassword })
      .where(and(eq(accounts.userId, userId), isNotNull(accounts.password)));
  }
}
