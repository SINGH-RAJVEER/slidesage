import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { client, db } from './index';

async function runMigration() {
  console.log('Running migrations...');

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    // We don't close the client here if it's managed elsewhere,
    // but for a standalone script we should.
    await client.end();
  }
}

runMigration();
