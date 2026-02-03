import { relations } from 'drizzle-orm';
import { boolean, date, jsonb, pgTable, real, text, timestamp, varchar } from 'drizzle-orm/pg-core';

// Users table - using Clerk for authentication
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  image: text('image'),

  // Custom fields for our application
  slideTokens: real('slide_tokens').notNull().default(50.0),
  isUnlimited: boolean('is_unlimited').notNull().default(false),
  lastLoginDate: date('last_login_date', { mode: 'date' }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Presentations table
export const presentations = pgTable('presentations', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  prompt: text('prompt').notNull(),
  slidesData: jsonb('slides_data').notNull(),
  parentPresentationId: text('parent_presentation_id').references(
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle circular reference
    (): any => presentations.id
  ),

  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  presentations: many(presentations),
}));

export const presentationsRelations = relations(presentations, ({ one, many }) => ({
  user: one(users, {
    fields: [presentations.userId],
    references: [users.id],
  }),
  parentPresentation: one(presentations, {
    fields: [presentations.parentPresentationId],
    references: [presentations.id],
    relationName: 'iterations',
  }),
  iterations: many(presentations, {
    relationName: 'iterations',
  }),
}));

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Presentation = typeof presentations.$inferSelect;
export type NewPresentation = typeof presentations.$inferInsert;
