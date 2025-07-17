import { neon } from '@neondatabase/serverless';

let sql: ReturnType<typeof neon> | null = null;

export function getDatabase() {
  if (!sql) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    sql = neon(databaseUrl);
  }
  return sql;
}