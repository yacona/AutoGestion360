require("dotenv").config();
const db = require("../db");

const email = process.argv[2] || "admin@demo.com";

(async () => {
  const { rows } = await db.query(
    `UPDATE usuarios
     SET rol = 'SuperAdmin'
     WHERE LOWER(email) = LOWER($1)
     RETURNING id, empresa_id, nombre, email, rol`,
    [email]
  );

  if (rows.length === 0) {
    console.error(`No se encontro ningun usuario con email ${email}.`);
    process.exit(1);
  }

  console.table(rows);
  process.exit(0);
})().catch((error) => {
  console.error("Error promoviendo usuario a SuperAdmin:", error);
  process.exit(1);
});
