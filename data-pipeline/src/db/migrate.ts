import { closeDb, runMigrations } from './client';

runMigrations();
console.log('Database migrated successfully.');
closeDb();
