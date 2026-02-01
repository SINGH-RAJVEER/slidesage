import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { type NewPresentation, type Presentation, presentations } from '../db/schema';
import type { PresentationJSON } from '../types';

export class PresentationRepository {
  async create(
    userId: string,
    title: string,
    prompt: string,
    slidesData: PresentationJSON
  ): Promise<Presentation> {
    const [presentation] = await db
      .insert(presentations)
      .values({
        userId,
        title,
        prompt,
        slidesData,
      })
      .returning();

    return presentation;
  }

  async findById(presentationId: string): Promise<Presentation | undefined> {
    const [presentation] = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, presentationId));

    return presentation;
  }

  async findByUserId(userId: string): Promise<Presentation[]> {
    const userPresentations = await db
      .select()
      .from(presentations)
      .where(eq(presentations.userId, userId))
      .orderBy(desc(presentations.createdAt));

    return userPresentations;
  }

  async delete(presentationId: string): Promise<void> {
    await db.delete(presentations).where(eq(presentations.id, presentationId));
  }

  async update(
    presentationId: string,
    updates: Partial<Presentation>
  ): Promise<Presentation | undefined> {
    const [presentation] = await db
      .update(presentations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(presentations.id, presentationId))
      .returning();

    return presentation;
  }
}
