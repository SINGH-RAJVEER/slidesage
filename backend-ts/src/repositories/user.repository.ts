import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { type User, users } from "../db/schema";

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
      throw new Error("User not found");
    }

    if (!user.isUnlimited && user.slideTokens < amount) {
      throw new Error("Insufficient tokens");
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
      throw new Error("User not found");
    }

    const today = new Date().toISOString().split("T")[0];

    if (
      !user.lastLoginDate ||
      user.lastLoginDate.toISOString().split("T")[0] !== today
    ) {
      await db
        .update(users)
        .set({
          lastLoginDate: new Date(today),
          slideTokens: user.slideTokens + 10,
        })
        .where(eq(users.id, userId));
    }
  }
}
