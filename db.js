import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'sorola',
  user: process.env.DB_USER || 'sorola',
  password: process.env.DB_PASSWORD || '',
});

pool.on('error', (err) => {
  console.error('PostgreSQL-yhteysvirhe:', err.message);
});

const query = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return {
    rows: result.rows,
    fields: result.fields || [],
    changes: result.rowCount,
    lastInsertRowid: result.rows[0]?.id ?? null
  };
};

const connect = async () => {
  const client = await pool.connect();
  return {
    query: async (sql, params = []) => {
      const result = await client.query(sql, params);
      return {
        rows: result.rows,
        fields: result.fields || [],
        changes: result.rowCount,
        lastInsertRowid: result.rows[0]?.id ?? null
      };
    },
    release: () => client.release()
  };
};

const closeDatabase = async () => {
  await pool.end();
};

process.once('SIGINT', closeDatabase);
process.once('SIGTERM', closeDatabase);

const schemaPath = path.resolve(__dirname, 'schema.sql');

const initializeDatabase = async () => {
  let schemaSql;
  try {
    schemaSql = fs.readFileSync(schemaPath, 'utf8');
  } catch (error) {
    throw new Error(`PostgreSQL-skeeman lukeminen epäonnistui tiedostosta ${schemaPath}: ${error.message}`);
  }
  try {
    await pool.query(schemaSql);
  } catch (error) {
    throw new Error(`PostgreSQL-skeeman alustus epäonnistui: ${error.message}`);
  }
};

await initializeDatabase();

export const db = {
  query,
  connect
};
