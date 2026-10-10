import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  ssl: env.NODE_ENV === 'production' && process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined,
});

pool.on('error', (error) => console.error('Error inesperado del pool PostgreSQL:', error));

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}