import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env.DATABASE_URL || 'postgresql://slidesage:slidesage@localhost:5432/slidesage';
// Ensure SSL is enabled for the connection
const url = databaseUrl;

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
});
