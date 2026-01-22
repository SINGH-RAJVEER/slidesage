import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://slidesage:slidesage@localhost:5432/slidesage';

// Create postgres client with SSL configuration
export const client = postgres(connectionString, {
  ssl: 'require',
  connection: {
    application_name: 'slidesage-backend',
  },
});

// Create drizzle instance
export const db = drizzle(client, { schema });

export type Database = typeof db;
