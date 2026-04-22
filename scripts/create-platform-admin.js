/**
 * create-platform-admin.js
 *
 * Bootstrap: crea el primer usuario de plataforma (scope='platform').
 * Este usuario NO pertenece a ninguna empresa cliente.
 *
 * Uso:
 *   node scripts/create-platform-admin.js
 *   PLATFORM_ADMIN_EMAIL=ops@miempresa.com PLATFORM_ADMIN_PASSWORD=secret node scripts/create-platform-admin.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const email    = process.env.PLATFORM_ADMIN_EMAIL    || 'platform@auto360.com';
const password = process.env.PLATFORM_ADMIN_PASSWORD || 'changeme123';
const nombre   = process.env.PLATFORM_ADMIN_NOMBRE   || 'Platform SuperAdmin';
const rol      = process.env.PLATFORM_ADMIN_ROL      || 'SuperAdmin';

(async () => {
  const { rows: existing } = await db.query(
    `SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) AND scope = 'platform'`,
    [email]
  );

  if (existing.length > 0) {
    console.warn(`Ya existe un usuario de plataforma con email "${email}" (id=${existing[0].id}). Sin cambios.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);

  const { rows } = await db.query(
    `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol, scope, activo)
     VALUES (NULL, $1, $2, $3, $4, 'platform', true)
     RETURNING id, empresa_id, nombre, email, rol, scope`,
    [nombre, email, hash, rol]
  );

  console.log('Usuario de plataforma creado:');
  console.table(rows);
  console.log(`\nCredenciales de acceso:\n  Email:    ${email}\n  Password: ${password}`);
  console.warn('\nCAMBIA la contraseña después del primer login.');
  process.exit(0);
})().catch((err) => {
  console.error('Error creando usuario de plataforma:', err);
  process.exit(1);
});
