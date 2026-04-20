const bcrypt = require('bcryptjs');
const db = require('../../../db');
const AppError = require('../../lib/AppError');
const withTransaction = require('../../lib/withTransaction');
const { cleanText } = require('../../lib/helpers');
const { getParqueaderoConfig } = require('../../../utils/parqueadero-config');
const { ensureLicenciasSchema } = require('../../../utils/licencias-schema');
const { upsertSuscripcionEmpresa } = require('../../../utils/suscripciones-schema');

function normalizePayload(body = {}) {
  return {
    nombre: cleanText(body.nombre),
    nit: cleanText(body.nit),
    ciudad: cleanText(body.ciudad),
    direccion: cleanText(body.direccion),
    telefono: cleanText(body.telefono),
    email_contacto: cleanText(body.email_contacto),
    zona_horaria: cleanText(body.zona_horaria) || 'America/Bogota',
    licencia_tipo: cleanText(body.licencia_tipo) || 'demo',
    licencia_fin: cleanText(body.licencia_fin),
    activa: body.activa !== false,
  };
}

async function listar() {
  await ensureLicenciasSchema();
  const { rows } = await db.query(`
    SELECT e.id, e.nombre, e.nit, e.ciudad, e.direccion, e.telefono, e.email_contacto,
           e.zona_horaria, e.licencia_tipo, e.licencia_fin,
           COALESCE(el.licencia_id, e.licencia_id) AS licencia_id,
           el.fecha_inicio AS licencia_asignacion_inicio,
           el.fecha_fin AS licencia_asignacion_fin,
           el.activa AS licencia_asignacion_activa,
           l.nombre AS licencia_nombre,
           e.activa, e.creado_en,
           COALESCE(u.total,0)::int AS usuarios_total,
           COALESCE(c.total,0)::int AS clientes_total,
           COALESCE(v.total,0)::int AS vehiculos_total,
           COALESCE(p.activos,0)::int AS parqueados_activos,
           COALESCE(i.ingresos_total,0)::numeric AS ingresos_total
    FROM empresas e
    LEFT JOIN empresa_licencia el ON el.empresa_id=e.id AND el.activa=true
    LEFT JOIN licencias l ON l.id=COALESCE(el.licencia_id,e.licencia_id)
    LEFT JOIN (SELECT empresa_id,COUNT(*) AS total FROM usuarios GROUP BY empresa_id) u ON u.empresa_id=e.id
    LEFT JOIN (SELECT empresa_id,COUNT(*) AS total FROM clientes GROUP BY empresa_id) c ON c.empresa_id=e.id
    LEFT JOIN (SELECT empresa_id,COUNT(*) AS total FROM vehiculos GROUP BY empresa_id) v ON v.empresa_id=e.id
    LEFT JOIN (SELECT empresa_id,COUNT(*) AS activos FROM parqueadero WHERE hora_salida IS NULL GROUP BY empresa_id) p ON p.empresa_id=e.id
    LEFT JOIN (SELECT empresa_id,COALESCE(SUM(valor_total),0) AS ingresos_total FROM parqueadero WHERE hora_salida IS NOT NULL GROUP BY empresa_id) i ON i.empresa_id=e.id
    ORDER BY e.creado_en DESC, e.id DESC
  `);
  return rows;
}

async function obtener(id) {
  const { rows } = await db.query(
    `SELECT id, nombre, nit, ciudad, direccion, telefono, email_contacto,
            zona_horaria, licencia_tipo, licencia_id, licencia_inicio, licencia_fin, activa, creado_en
     FROM empresas WHERE id=$1`,
    [id]
  );
  if (!rows.length) throw new AppError('Empresa no encontrada.', 404);
  return rows[0];
}

async function crear(body) {
  const payload = normalizePayload(body);
  const adminNombre   = cleanText(body.admin_nombre);
  const adminEmail    = cleanText(body.admin_email);
  const adminPassword = String(body.admin_password || '').trim();

  if (!payload.nombre) throw new AppError('El nombre de la empresa es obligatorio.', 400);
  if (adminEmail && adminPassword.length < 6) {
    throw new AppError('La contraseña del administrador debe tener al menos 6 caracteres.', 400);
  }

  await ensureLicenciasSchema();

  return withTransaction(async (client) => {
    if (adminEmail) {
      const { rows } = await client.query(
        'SELECT id FROM usuarios WHERE LOWER(email)=LOWER($1) LIMIT 1',
        [adminEmail]
      );
      if (rows.length) {
        throw new AppError('Ese correo ya existe en otra empresa. Usa un correo único para iniciar sesión.', 409);
      }
    }

    const { rows } = await client.query(
      `INSERT INTO empresas (nombre,nit,ciudad,direccion,telefono,email_contacto,zona_horaria,licencia_tipo,licencia_fin,activa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [payload.nombre, payload.nit, payload.ciudad, payload.direccion, payload.telefono,
       payload.email_contacto, payload.zona_horaria, payload.licencia_tipo, payload.licencia_fin, payload.activa]
    );
    const empresa = rows[0];

    const { rows: licencias } = await client.query(
      `SELECT id, nombre, precio FROM licencias
       WHERE LOWER(translate(nombre,'áéíóúÁÉÍÓÚ','aeiouAEIOU'))=LOWER(translate($1,'áéíóúÁÉÍÓÚ','aeiouAEIOU'))
       LIMIT 1`,
      [payload.licencia_tipo || 'Demo']
    );
    const licenciaInicial = licencias[0];

    if (adminEmail) {
      const hash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `INSERT INTO usuarios (empresa_id,nombre,email,password_hash,rol) VALUES ($1,$2,$3,$4,$5)`,
        [empresa.id, adminNombre || `Admin ${empresa.nombre}`, adminEmail, hash, 'Administrador']
      );
    }

    await getParqueaderoConfig(empresa.id, client);

    if (licenciaInicial) {
      await upsertSuscripcionEmpresa({
        queryable: client,
        empresaId: empresa.id,
        licenciaId: licenciaInicial.id,
        estado: String(licenciaInicial.nombre || '').toLowerCase() === 'demo' ? 'TRIAL' : 'ACTIVA',
        fechaInicio: new Date(),
        fechaFin: payload.licencia_fin,
        renovacionAutomatica: false,
        pasarela: 'MANUAL',
        observaciones: 'Suscripcion inicial creada al registrar la empresa',
        moneda: 'COP',
        precioPlan: licenciaInicial.precio,
      });
    }

    return empresa;
  });
}

async function actualizar(empresaId, selfEmpresaId, body) {
  const payload = normalizePayload(body);
  if (!payload.nombre) throw new AppError('El nombre de la empresa es obligatorio.', 400);
  if (empresaId === Number(selfEmpresaId) && payload.activa === false) {
    throw new AppError('No puedes desactivar la empresa de la sesión actual.', 400);
  }

  const { rows } = await db.query(
    `UPDATE empresas
     SET nombre=$1,nit=$2,ciudad=$3,direccion=$4,telefono=$5,email_contacto=$6,
         zona_horaria=$7,licencia_tipo=$8,licencia_fin=$9,activa=$10
     WHERE id=$11
     RETURNING *`,
    [payload.nombre, payload.nit, payload.ciudad, payload.direccion, payload.telefono,
     payload.email_contacto, payload.zona_horaria, payload.licencia_tipo, payload.licencia_fin,
     payload.activa, empresaId]
  );
  if (!rows.length) throw new AppError('Empresa no encontrada.', 404);
  return rows[0];
}

async function cambiarEstado(empresaId, selfEmpresaId, activa) {
  if (empresaId === Number(selfEmpresaId) && !activa) {
    throw new AppError('No puedes desactivar la empresa de la sesión actual.', 400);
  }
  const { rows } = await db.query(
    `UPDATE empresas SET activa=$1 WHERE id=$2 RETURNING id,nombre,activa`,
    [activa, empresaId]
  );
  if (!rows.length) throw new AppError('Empresa no encontrada.', 404);
  return rows[0];
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
