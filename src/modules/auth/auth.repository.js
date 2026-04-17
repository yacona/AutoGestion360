const db = require('../../../db');

async function findUserWithEmpresa(email) {
  const { rows } = await db.query(
    `SELECT u.id, u.empresa_id, u.nombre, u.email,
            u.password_hash, u.rol, u.activo,
            e.nombre AS empresa_nombre, e.logo_url, e.zona_horaria,
            e.licencia_tipo, e.licencia_id, e.licencia_fin,
            e.activa AS empresa_activa
     FROM usuarios u
     JOIN empresas e ON e.id = u.empresa_id
     WHERE LOWER(u.email) = LOWER($1)
     ORDER BY CASE WHEN LOWER(u.rol) IN ('superadmin','super_admin','super admin') THEN 0 ELSE 1 END, u.id
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function findEmpresaLicenciaActiva(empresaId) {
  const { rows } = await db.query(
    `SELECT el.licencia_id, el.fecha_inicio, el.fecha_fin, el.activa,
            l.nombre AS licencia_nombre, l.descripcion, l.precio
     FROM empresa_licencia el
     JOIN licencias l ON el.licencia_id = l.id
     WHERE el.empresa_id = $1 AND el.activa = true
     ORDER BY el.creado_en DESC
     LIMIT 1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function findEmpresaLicenciaDirecta(empresaId) {
  const { rows } = await db.query(
    `SELECT e.licencia_id, e.licencia_inicio AS fecha_inicio, e.licencia_fin AS fecha_fin,
            e.activa, l.nombre AS licencia_nombre, l.descripcion, l.precio
     FROM empresas e
     JOIN licencias l ON l.id = e.licencia_id
     WHERE e.id = $1 AND e.licencia_id IS NOT NULL
     LIMIT 1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function findEmpresaLegacy(empresaId) {
  const { rows } = await db.query(
    `SELECT licencia_tipo, licencia_inicio, licencia_fin, activa
     FROM empresas WHERE id = $1 LIMIT 1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function findModulosByLicenciaId(licenciaId) {
  const { rows } = await db.query(
    `SELECT m.nombre, m.descripcion
     FROM licencia_modulo lm
     JOIN modulos m ON lm.modulo_id = m.id
     WHERE lm.licencia_id = $1
     ORDER BY m.nombre`,
    [licenciaId]
  );
  return rows;
}

async function findEmpresaById(empresaId) {
  const { rows } = await db.query(
    `SELECT id, nombre, nit, ciudad, direccion, telefono, email_contacto, logo_url, zona_horaria
     FROM empresas WHERE id = $1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function updateEmpresa(empresaId, { nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria }) {
  const { rows } = await db.query(
    `UPDATE empresas
     SET nombre=$1, nit=$2, ciudad=$3, direccion=$4, telefono=$5, email_contacto=$6, zona_horaria=$7
     WHERE id=$8 RETURNING *`,
    [nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria, empresaId]
  );
  return rows[0] || null;
}

async function updateEmpresaLogo(empresaId, logoUrl) {
  const { rows } = await db.query(
    `UPDATE empresas SET logo_url=$1 WHERE id=$2 RETURNING logo_url`,
    [logoUrl, empresaId]
  );
  return rows[0] || null;
}

async function countEmpresas() {
  const { rows } = await db.query('SELECT COUNT(*) AS total FROM empresas');
  return parseInt(rows[0].total, 10);
}

async function createEmpresaDemo(data) {
  const { rows } = await db.query(
    `INSERT INTO empresas (nombre, nit, ciudad, direccion, telefono, email_contacto, licencia_tipo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.nombre, data.nit, data.ciudad, data.direccion, data.telefono, data.email_contacto, data.licencia_tipo]
  );
  return rows[0];
}

async function createUsuario(empresaId, { nombre, email, password_hash, rol }) {
  const { rows } = await db.query(
    `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, empresa_id, nombre, email, rol`,
    [empresaId, nombre, email, password_hash, rol]
  );
  return rows[0];
}

module.exports = {
  findUserWithEmpresa,
  findEmpresaLicenciaActiva,
  findEmpresaLicenciaDirecta,
  findEmpresaLegacy,
  findModulosByLicenciaId,
  findEmpresaById,
  updateEmpresa,
  updateEmpresaLogo,
  countEmpresas,
  createEmpresaDemo,
  createUsuario,
};
