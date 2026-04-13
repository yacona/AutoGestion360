require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  try {
    const res = await pool.query(`
      SELECT 
        current_database()    AS db,
        current_user          AS usr,
        current_schema()      AS schema,
        current_schemas(true) AS search_path;
    `);

    console.log("INFO CONEXIÓN:", res.rows[0]);

    const tablas = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    console.log("TABLAS EN PUBLIC:");
    console.table(tablas.rows);

    process.exit(0);
  } catch (err) {
    console.error("ERROR DEBUG DB:", err);
    process.exit(1);
  }
})();