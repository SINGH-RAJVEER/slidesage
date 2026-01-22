import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env.DATABASE_URL || 'postgresql://slidesage:slidesage@localhost:5432/slidesage';
// Ensure SSL is enabled for the connection
const url = databaseUrl.includes('ssl=')
  ? databaseUrl
  : `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}ssl=require`;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
});
