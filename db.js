import mysql from 'mysql2/promise';

const mysqlConfigFromUrl = (databaseUrl) => {
  const parsedUrl = new URL(databaseUrl);
  const database = parsedUrl.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL:sta puuttuu tietokannan nimi.');
  }
  return {
    host: parsedUrl.hostname,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database,
    port: parsedUrl.port ? Number(parsedUrl.port) : 3306
  };
};

const mysqlConfigFromEnv = () => {
  const { HOST, USER, PASSWORD, DATABASE, PORT } = process.env;
  if (!HOST || !USER || !DATABASE) {
    throw new Error('MySQL-muuttujat puuttuvat. Määritä DATABASE_URL tai HOST, USER, PASSWORD, DATABASE, PORT.');
  }
  return {
    host: HOST,
    user: USER,
    password: PASSWORD ?? '',
    database: DATABASE,
    port: PORT ? Number(PORT) : 3306
  };
};

const pool = mysql.createPool({
  ...(process.env.DATABASE_URL
    ? mysqlConfigFromUrl(process.env.DATABASE_URL)
    : mysqlConfigFromEnv()),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const toMysqlPlaceholders = (sql) => sql.replace(/\$\d+/g, '?');

const query = async (sql, params = []) => {
  const [rows, fields] = await pool.query(toMysqlPlaceholders(sql), params);
  return { rows, fields };
};

const connect = async () => {
  const connection = await pool.getConnection();
  return {
    query: async (sql, params = []) => {
      const [rows, fields] = await connection.query(toMysqlPlaceholders(sql), params);
      return { rows, fields };
    },
    release: () => connection.release()
  };
};

export const db = {
  query,
  connect
};
