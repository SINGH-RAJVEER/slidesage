import { sql } from 'drizzle-orm';
import { db } from './index';

async function migrate() {
  console.log('Running migrations...');

  try {
    // Create tables if they don't exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(120) NOT NULL UNIQUE,
        name VARCHAR(100),
        password_hash VARCHAR(255),
        profile_picture TEXT,
        oauth_provider VARCHAR(50),
        oauth_id VARCHAR(255),
        slide_tokens REAL NOT NULL DEFAULT 50.0,
        is_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
        last_login_date DATE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS presentations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        prompt TEXT NOT NULL,
        slides_data JSONB NOT NULL,
        parent_presentation_id INTEGER REFERENCES presentations(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Create indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_presentations_user_id ON presentations(user_id);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_presentations_parent_id ON presentations(parent_presentation_id);
    `);

    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
