const db = require('../../../db');
const AppError = require('../../lib/AppError');
const withTransaction = require('../../lib/withTransaction');
const { normalizeRole } = require('../../lib/helpers');
const { enviarNotificacionLicencia } = require('../../../utils/email');
const { ensureLicenciasSchema } = require('../../../utils/licencias-schema');
const { upsertSuscripcionEmpresa } = require('../../../utils/suscripciones-schema');

async function getLicenciaConModulos(licenciaId) {
  await ensureLicenciasSchema();
  const { rows } = await db.query(
    `SELECT id,nombre,descripcion,precio,creado_en FROM licencias WHERE id=$1`,
    [licenciaId]
  );
  if (!rows.length) return null;

  const { rows: modulos } = await db.query(
    `SELECT m.id,m.nombre,m.descripcion
     FROM modulos m JOIN licencia_modulo lm ON lm.modulo_id=m.id
     WHERE lm.licencia_id=$1 ORDER BY m.nombre`,
    [licenciaId]
  );
  return { ...rows[0], modulos };
}

async function getCatalogo() {
  await ensureLicenciasSchema();
  const [{ rows: licencias }, { rows: modulos }] = await Promise.all([
    db.query(`SELECT id,nombre,descripcion,precio,creado_en FROM licencias ORDER BY precio NULLS LAST, nombre`),
    db.query(`SELECT lm.licencia_id,m.id,m.nombre,m.descripcion FROM licencia_modulo lm JOIN modulos m ON m.id=lm.modulo_id ORDER BY m.nombre`),
  ]);
  return licencias.map((l) => ({
    ...l,
    modulos: modulos.filter((m) => Number(m.licencia_id) === Number(l.id)).map(({ licencia_id, ...m }) => m),
  }));
}

async function listar() {
  await ensureLicenciasSchema();
  const { rows } = await db.query(`SELECT * FROM licencias ORDER BY creado_en DESC`);
  return rows;
}

async function crear({ nombre, descripcion, precio }) {
  if (!nombre) throw new AppError('El nombre de la licencia es requerido', 400);
  await ensureLicenciasSchema();
  try {
    const { rows } = await db.query(
      `INSERT INTO licencias (nombre,descripcion,precio) VALUES ($1,$2,$3) RETURNING *`,
      [nombre, descripcion, precio]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new AppError('Ya existe una licencia con ese nombre', 409);
    throw err;
  }
}

async function actualizar(id, { nombre, descripcion, precio }) {
  await ensureLicenciasSchema();
  const { rows } = await db.query(
    `UPDATE licencias SET nombre=$1,descripcion=$2,precio=$3 WHERE id=$4 RETURNING *`,
    [nombre, descripcion, precio, id]
  );
  if (!rows.length) throw new AppError('Licencia no encontrada', 404);
  return rows[0];
}

async function asignarModulos(licenciaId, modulos) {
  if (!Array.isArray(modulos)) throw new AppError('modulos debe ser un array de IDs', 400);
  await ensureLicenciasSchema();
  await db.query('DELETE FROM licencia_modulo WHERE licencia_id=$1', [licenciaId]);
  if (modulos.length > 0) {
    const values = modulos.map((_, i) => `($1,$${i + 2})`).join(',');
    await db.query(
      `INSERT INTO licencia_modulo (licencia_id,modulo_id) VALUES ${values}`,
      [licenciaId, ...modulos]
    );
  }
}

async function obtenerModulos(licenciaId) {
  await ensureLicenciasSchema();
  const { rows } = await db.query(
    `SELECT m.* FROM modulos m JOIN licencia_modulo lm ON m.id=lm.modulo_id WHERE lm.licencia_id=$1`,
    [licenciaId]
  );
  return rows;
}

async function catalogoCompleto() {
  await ensureLicenciasSchema();
  const [licencias, { rows: modulos }] = await Promise.all([
    getCatalogo(),
    db.query('SELECT * FROM modulos ORDER BY nombre'),
  ]);
  return { licencias, modulos };
}

async function licenciaEmpresa(empresaId) {
  await ensureLicenciasSchema();
  const { rows } = await db.query(
    `SELECT el.*,e.nombre AS empresa_nombre,l.nombre AS licencia_nombre,l.descripcion,l.precio
     FROM empresa_licencia el
     JOIN empresas e ON el.empresa_id=e.id
     JOIN licencias l ON el.licencia_id=l.id
     WHERE el.empresa_id=$1 AND el.activa=true
     ORDER BY el.creado_en DESC LIMIT 1`,
    [empresaId]
  );
  if (!rows.length) return { mensaje: 'No hay licencia asignada' };
  const licencia = await getLicenciaConModulos(rows[0].licencia_id);
  return { ...rows[0], modulos: licencia?.modulos || [] };
}

async function asignarLicencia({ empresa_id, licencia_id, fecha_inicio, fecha_fin }) {
  if (!empresa_id || !licencia_id) {
    throw new AppError('empresa_id y licencia_id son requeridos', 400);
  }
  await ensureLicenciasSchema();

  const licencia = await getLicenciaConModulos(licencia_id);
  if (!licencia) throw new AppError('Licencia no encontrada', 404);

  return withTransaction(async (client) => {
    await client.query('UPDATE empresa_licencia SET activa=false WHERE empresa_id=$1', [empresa_id]);

    const { rows } = await client.query(
      `INSERT INTO empresa_licencia (empresa_id,licencia_id,fecha_inicio,fecha_fin,activa)
       VALUES ($1,$2,COALESCE($3,NOW()),$4,true)
       ON CONFLICT (empresa_id) DO UPDATE
       SET licencia_id=EXCLUDED.licencia_id, fecha_inicio=EXCLUDED.fecha_inicio,
           fecha_fin=EXCLUDED.fecha_fin, activa=true, creado_en=NOW()
       RETURNING *`,
      [empresa_id, licencia_id, fecha_inicio || null, fecha_fin || null]
    );

    await client.query(
      `UPDATE empresas
       SET licencia_tipo=$1, licencia_id=$2, licencia_inicio=COALESCE($3,NOW()), licencia_fin=$4, activa=true
       WHERE id=$5`,
      [licencia.nombre, licencia_id, fecha_inicio || null, fecha_fin || null, empresa_id]
    );

    await upsertSuscripcionEmpresa({
      queryable: client, empresaId: empresa_id, licenciaId: licencia_id,
      estado: normalizeRole(licencia.nombre) === 'demo' ? 'TRIAL' : 'ACTIVA',
      fechaInicio: fecha_inicio || null, fechaFin: fecha_fin || null,
      renovacionAutomatica: false, pasarela: 'MANUAL',
      observaciones: 'Sincronizada desde asignacion de licencia',
      moneda: 'COP', precioPlan: licencia.precio,
    });

    return { asignacion: rows[0], licencia };
  });
}

async function asignaciones() {
  await ensureLicenciasSchema();
  const { rows } = await db.query(
    `SELECT el.*,e.nombre AS empresa_nombre,l.nombre AS licencia_nombre
     FROM empresa_licencia el
     JOIN empresas e ON el.empresa_id=e.id
     JOIN licencias l ON el.licencia_id=l.id
     ORDER BY el.creado_en DESC`
  );
  return rows;
}

async function modulosDisponibles() {
  await ensureLicenciasSchema();
  const { rows } = await db.query('SELECT * FROM modulos ORDER BY nombre');
  return rows;
}

async function proximasVencer(dias = 30) {
  await ensureLicenciasSchema();
  const fechaLimite = new Date();
  fechaLimite.setDate(fechaLimite.getDate() + dias);
  const { rows } = await db.query(
    `SELECT el.*,e.nombre AS empresa_nombre,e.email_contacto,l.nombre AS licencia_nombre
     FROM empresa_licencia el
     JOIN empresas e ON el.empresa_id=e.id
     JOIN licencias l ON el.licencia_id=l.id
     WHERE el.activa=true AND el.fecha_fin<=$1 AND el.fecha_fin>NOW()
     ORDER BY el.fecha_fin ASC`,
    [fechaLimite]
  );
  return rows;
}

async function enviarNotificaciones(dias = 30) {
  const licencias = await proximasVencer(dias);
  let enviados = 0, errores = 0;
  for (const lic of licencias) {
    if (lic.email_contacto) {
      const exito = await enviarNotificacionLicencia(
        lic.email_contacto, lic.empresa_nombre, lic.licencia_nombre, lic.fecha_fin
      );
      if (exito) enviados++; else errores++;
    }
  }
  return { mensaje: `Notificaciones enviadas: ${enviados}, Errores: ${errores}`, total: licencias.length };
}

module.exports = {
  listar, crear, actualizar,
  asignarModulos, obtenerModulos, catalogoCompleto,
  licenciaEmpresa, asignarLicencia, asignaciones,
  modulosDisponibles, proximasVencer, enviarNotificaciones,
};
