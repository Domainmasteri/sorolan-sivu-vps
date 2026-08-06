import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configuredDatabasePath = String(process.env.DATABASE_PATH || '').trim();
const defaultDatabasePath = path.join(__dirname, 'data', 'database.sqlite');
const databasePath = configuredDatabasePath
  ? (path.isAbsolute(configuredDatabasePath)
    ? configuredDatabasePath
    : path.resolve(__dirname, configuredDatabasePath))
  : defaultDatabasePath;
const schemaPath = path.resolve(__dirname, 'schema.sql');
const busyTimeoutMs = Math.max(0, Number.parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS, 10) || 5000);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const readSchemaSql = () => {
  try {
    return fs.readFileSync(schemaPath, 'utf8');
  } catch (error) {
    throw new Error(`SQLite-skeeman lukeminen epäonnistui tiedostosta ${schemaPath}: ${error.message}`);
  }
};

const openDatabase = () => {
  try {
    const connection = new Database(databasePath);
    try {
      connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
    } catch (error) {
      connection.close();
      throw new Error(`SQLite busy_timeout -pragma epäonnistui: ${error.message}`);
    }
    return connection;
  } catch (error) {
    throw new Error(`SQLite-tietokannan avaaminen epäonnistui polusta ${databasePath}: ${error.message}`);
  }
};

const schemaSql = readSchemaSql();

const migrateCustomElementsSortOrder = (connection) => {
  const customElementsTable = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('custom_elements');

  if (!customElementsTable) {
    return;
  }

  const columns = connection.prepare('PRAGMA table_info(custom_elements)').all();
  const hasSortOrder = columns.some(column => column.name === 'sort_order');

  if (hasSortOrder) {
    return;
  }

  connection.prepare('ALTER TABLE custom_elements ADD COLUMN sort_order INTEGER DEFAULT 0').run();
  connection.prepare('UPDATE custom_elements SET sort_order = 0 WHERE sort_order IS NULL').run();
};

const runMigrations = (connection) => {
  migrateCustomElementsSortOrder(connection);
};

const initializeDatabase = () => {
  const connection = openDatabase();

  try {
    connection.exec(schemaSql);
    runMigrations(connection);
    return connection;
  } catch (error) {
    connection.close();
    throw new Error(`SQLite-skeeman alustus epäonnistui: ${error.message}`);
  }
};

const database = initializeDatabase();

const closeDatabase = () => {
  if (database.open) {
    database.close();
  }
};

process.once('SIGINT', closeDatabase);
process.once('SIGTERM', closeDatabase);

const normalizeSqliteQuery = (sql, params = []) => {
  const orderedParams = [];
  const normalizedSql = sql.replace(/\$(\d+)/g, (_match, index) => {
    const paramIndex = Number.parseInt(index, 10) - 1;
    if (paramIndex < 0 || paramIndex >= params.length) {
      throw new Error(`SQL-parametri $${index} puuttuu kyselyn parametreista.`);
    }
    orderedParams.push(params[paramIndex]);
    return '?';
  });

  return {
    sql: normalizedSql,
    params: orderedParams.length > 0 ? orderedParams : params
  };
};

const isReadQuery = (sql) => {
  const normalized = sql.trimStart().toUpperCase();
  return normalized.startsWith('SELECT')
    || normalized.startsWith('WITH')
    || normalized.startsWith('PRAGMA')
    || normalized.startsWith('EXPLAIN');
};

const execute = (connection, sql, params = []) => {
  const normalized = normalizeSqliteQuery(sql, params);
  const statement = connection.prepare(normalized.sql);

  if (isReadQuery(normalized.sql)) {
    const rows = statement.all(...normalized.params);
    return { rows, fields: statement.columns() || [] };
  }

  const result = statement.run(...normalized.params);
  return {
    rows: [],
    fields: [],
    changes: result.changes,
    lastInsertRowid: result.lastInsertRowid
  };
};

const query = (sql, params = []) => execute(database, sql, params);

const connect = () => {
  const connection = openDatabase();

  return {
    query: (sql, params = []) => execute(connection, sql, params),
    release: () => connection.close()
  };
};

export const db = {
  query,
  connect,
  path: databasePath
};
