import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databasePath = path.resolve(__dirname, process.env.DATABASE_PATH || 'data/database.sqlite');
const schemaPath = path.resolve(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);

const schemaSql = fs.readFileSync(schemaPath, 'utf8');
database.exec(schemaSql);

const toSqlitePlaceholders = (sql) => sql.replace(/\$\d+/g, '?');

const isReadQuery = (sql) => {
  const normalized = sql.trimStart().toUpperCase();
  return normalized.startsWith('SELECT')
    || normalized.startsWith('WITH')
    || normalized.startsWith('PRAGMA')
    || normalized.startsWith('EXPLAIN');
};

const execute = (sql, params = []) => {
  const normalizedSql = toSqlitePlaceholders(sql);
  const statement = database.prepare(normalizedSql);

  if (isReadQuery(normalizedSql)) {
    return { rows: statement.all(...params), fields: [] };
  }

  const result = statement.run(...params);
  return {
    rows: [],
    fields: [],
    changes: result.changes,
    lastInsertRowid: Number(result.lastInsertRowid)
  };
};

const query = (sql, params = []) => execute(sql, params);

const connect = () => ({
  query: (sql, params = []) => execute(sql, params),
  release: () => {}
});

export const db = {
  query,
  connect,
  path: databasePath
};
