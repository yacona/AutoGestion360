/**
 * promote-superadmin.js
 *
 * Promueve un usuario existente a SuperAdmin de plataforma.
 * Establece rol='SuperAdmin', scope='platform' y empresa_id=NULL.
 *
 * Uso:
 *   node scripts/promote-superadmin.js admin@demo.com
 */
require('dotenv').config();
const db = require('../db');

const email = process.argv[2];

if (!email) {
  console.error('Uso: node scripts/promote-superadmin.js <email>');
  process.exit(1);
}

(async () => {
  const { rows } = await db.query(
    `UPDATE usuarios
     SET rol = 'SuperAdmin', scope = 'platform', empresa_id = NULL
     WHERE LOWER(email) = LOWER($1)
     RETURNING id, empresa_id, nombre, email, rol, scope`,
    [email]
  );

  if (rows.length === 0) {
    console.error(`No se encontró ningún usuario con email "${email}".`);
    process.exit(1);
  }

  console.log('Usuario promovido a SuperAdmin de plataforma:');
  console.table(rows);
  process.exit(0);
})().catch((err) => {
  console.error('Error promoviendo usuario a SuperAdmin de plataforma:', err);
  process.exit(1);
});
