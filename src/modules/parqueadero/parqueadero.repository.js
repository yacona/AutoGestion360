const db = require('../../../db');

// ── Schema runtime (se migra a 001_base_schema.sql en la Fase 2) ─────────────
async function ensureSchema(qbl = db) {
  await qbl.query(`
    CREATE TABLE IF NOT EXISTS mensualidades_parqueadero (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
      vehiculo_id BIGINT REFERENCES vehiculos(id) ON DELETE SET NULL,
      placa VARCHAR(20) NOT NULL,
      tipo_vehiculo VARCHAR(30) NOT NULL,
      nombre_cliente VARCHAR(150) NOT NULL,
      documento VARCHAR(40),
      telefono VARCHAR(40),
      correo VARCHAR(120),
      direccion VARCHAR(150),
      contacto_emergencia VARCHAR(150),
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      valor_mensual NUMERIC(12,2) DEFAULT 0,
      estado VARCHAR(30) DEFAULT 'ACTIVA',
      observaciones TEXT,
      creado_en TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ DEFAULT NOW()
    )`);
  await qbl.query(`
    CREATE INDEX IF NOT EXISTS mensualidades_parqueadero_empresa_placa_idx
    ON mensualidades_parqueadero (empresa_id, placa, estado)`);
  await qbl.query(`ALTER TABLE parqueadero ADD COLUMN IF NOT EXISTS tipo_servicio VARCHAR(30) DEFAULT 'OCASIONAL_HORA'`);
  await qbl.query(`ALTER TABLE parqueadero ADD COLUMN IF NOT EXISTS mensualidad_id BIGINT`);
}

// ── Entradas ──────────────────────────────────────────────────────────────────
async function findOpenEntryByPlaca(qbl, empresaId, placa) {
  const { rows } = await qbl.query(
    `SELECT id FROM parqueadero WHERE empresa_id=$1 AND placa=$2 AND hora_salida IS NULL LIMIT 1`,
    [empresaId, placa]
  );
  return rows[0] || null;
}

async function findActiveMensualidad(qbl, empresaId, { placa, mensualidadId }) {
  const params = [empresaId];
  let whereExtra = '';
  if (mensualidadId) {
    params.push(mensualidadId);
    whereExtra = `AND mp.id = $${params.length}`;
  } else {
    params.push(placa);
    whereExtra = `AND mp.placa = $${params.length}`;
  }
  const { rows } = await qbl.query(
    `SELECT mp.*, c.id AS cliente_id_db, v.id AS vehiculo_id_db
     FROM mensualidades_parqueadero mp
     LEFT JOIN clientes c ON c.id = mp.cliente_id
     LEFT JOIN vehiculos v ON v.id = mp.vehiculo_id
     WHERE mp.empresa_id=$1 ${whereExtra}
       AND mp.estado='ACTIVA'
       AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin
     ORDER BY mp.fecha_fin DESC LIMIT 1`,
    params
  );
  return rows[0] || null;
}

// ── Clientes ──────────────────────────────────────────────────────────────────
async function findClientByDocument(qbl, empresaId, documento) {
  const { rows } = await qbl.query(
    `SELECT id, nombre, documento, telefono, correo FROM clientes WHERE empresa_id=$1 AND documento=$2 LIMIT 1`,
    [empresaId, documento]
  );
  return rows[0] || null;
}

async function findClientByName(qbl, empresaId, nombre) {
  const { rows } = await qbl.query(
    `SELECT id, nombre, documento, telefono, correo FROM clientes WHERE empresa_id=$1 AND UPPER(TRIM(nombre))=$2 LIMIT 1`,
    [empresaId, nombre]
  );
  return rows[0] || null;
}

async function insertClient(qbl, empresaId, { nombre, documento, telefono, correo }) {
  const { rows } = await qbl.query(
    `INSERT INTO clientes (empresa_id, nombre, documento, telefono, correo) VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, documento, telefono, correo`,
    [empresaId, nombre, documento || null, telefono || null, correo || null]
  );
  return rows[0];
}

async function updateClientData(qbl, id, empresaId, { nombre, telefono, correo }) {
  const { rows } = await qbl.query(
    `UPDATE clientes SET nombre=$1, telefono=COALESCE($2,telefono), correo=COALESCE($3,correo) WHERE id=$4 AND empresa_id=$5 RETURNING id, nombre, documento, telefono, correo`,
    [nombre, telefono || null, correo || null, id, empresaId]
  );
  return rows[0];
}

// ── Vehículos ─────────────────────────────────────────────────────────────────
async function findVehicleWithOwner(qbl, empresaId, placa) {
  const { rows } = await qbl.query(
    `SELECT v.id, v.cliente_id,
            c.nombre AS propietario_nombre_db, c.documento AS propietario_documento_db,
            c.telefono AS propietario_telefono_db, c.correo AS propietario_correo_db
     FROM vehiculos v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.empresa_id=$1 AND v.placa=$2 LIMIT 1`,
    [empresaId, placa]
  );
  return rows[0] || null;
}

async function insertVehicle(qbl, empresaId, { clienteId, placa, tipoVehiculo, marca, modelo, color }) {
  const { rows } = await qbl.query(
    `INSERT INTO vehiculos (empresa_id, cliente_id, placa, tipo_vehiculo, marca, modelo, color) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [empresaId, clienteId || null, placa, tipoVehiculo, marca || null, modelo || null, color || null]
  );
  return rows[0];
}

async function updateVehicleOwner(qbl, id, empresaId, { clienteId, tipoVehiculo, marca, modelo, color }) {
  const { rows } = await qbl.query(
    `UPDATE vehiculos SET cliente_id=$1, tipo_vehiculo=$2, marca=COALESCE($3,marca), modelo=COALESCE($4,modelo), color=COALESCE($5,color) WHERE id=$6 AND empresa_id=$7 RETURNING id`,
    [clienteId, tipoVehiculo, marca || null, modelo || null, color || null, id, empresaId]
  );
  return rows[0];
}

async function updateVehicleClient(qbl, id, clienteId) {
  await qbl.query(`UPDATE vehiculos SET cliente_id=$1 WHERE id=$2`, [clienteId, id]);
}

// ── Mensualidades ─────────────────────────────────────────────────────────────
async function linkMensualidadVehicle(qbl, mensualidadId, empresaId, vehiculoId, clienteId) {
  await qbl.query(
    `UPDATE mensualidades_parqueadero SET vehiculo_id=$1, cliente_id=COALESCE(cliente_id,$2), actualizado_en=NOW() WHERE id=$3 AND empresa_id=$4`,
    [vehiculoId, clienteId || null, mensualidadId, empresaId]
  );
}

async function deactivateMensualidadesByPlaca(qbl, empresaId, placa) {
  await qbl.query(
    `UPDATE mensualidades_parqueadero SET estado='INACTIVA', actualizado_en=NOW() WHERE empresa_id=$1 AND placa=$2 AND estado='ACTIVA'`,
    [empresaId, placa]
  );
}

async function insertMensualidad(qbl, data) {
  const { rows } = await qbl.query(
    `INSERT INTO mensualidades_parqueadero
     (empresa_id, cliente_id, vehiculo_id, placa, tipo_vehiculo, nombre_cliente, documento,
      telefono, correo, direccion, contacto_emergencia, fecha_inicio, fecha_fin, valor_mensual, estado, observaciones)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVA',$15) RETURNING *`,
    [
      data.empresa_id, data.cliente_id, data.vehiculo_id, data.placa, data.tipo_vehiculo,
      data.nombre_cliente, data.documento, data.telefono || null, data.correo || null,
      data.direccion || null, data.contacto_emergencia || null, data.fecha_inicio, data.fecha_fin,
      data.valor_mensual, data.observaciones || null,
    ]
  );
  return rows[0];
}

async function findMensualidades(qbl, empresaId, incluirInactivas) {
  const { rows } = await qbl.query(
    `SELECT mp.*, COUNT(p.id)::int AS ingresos_registrados, MAX(p.hora_entrada) AS ultimo_ingreso
     FROM mensualidades_parqueadero mp
     LEFT JOIN parqueadero p ON p.mensualidad_id=mp.id AND p.empresa_id=mp.empresa_id
     WHERE mp.empresa_id=$1 AND ($2::boolean=TRUE OR mp.estado='ACTIVA')
     GROUP BY mp.id
     ORDER BY mp.estado, mp.fecha_fin ASC, mp.nombre_cliente ASC`,
    [empresaId, incluirInactivas]
  );
  return rows;
}

async function findMensualidadById(qbl, id, empresaId) {
  const { rows } = await qbl.query(
    `SELECT * FROM mensualidades_parqueadero WHERE id=$1 AND empresa_id=$2`,
    [id, empresaId]
  );
  return rows[0] || null;
}

// ── Parqueadero entries ───────────────────────────────────────────────────────
async function insertEntry(qbl, data) {
  const { rows } = await qbl.query(
    `INSERT INTO parqueadero
     (empresa_id, vehiculo_id, cliente_id, placa, tipo_vehiculo, nombre_cliente, telefono,
      conductor_nombre, conductor_documento, conductor_telefono, es_propietario,
      observaciones, evidencia_url, tipo_servicio, mensualidad_id, estado_pago)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [
      data.empresa_id, data.vehiculo_id, data.cliente_id, data.placa, data.tipo_vehiculo,
      data.nombre_cliente, data.telefono, data.conductor_nombre, data.conductor_documento,
      data.conductor_telefono, data.es_propietario, data.observaciones, data.evidencia_url,
      data.tipo_servicio, data.mensualidad_id, data.estado_pago,
    ]
  );
  return rows[0];
}

async function findOpenEntryById(qbl, id, empresaId) {
  const { rows } = await qbl.query(
    `SELECT id, hora_entrada, tipo_vehiculo, placa, tipo_servicio, mensualidad_id
     FROM parqueadero WHERE id=$1 AND empresa_id=$2 AND hora_salida IS NULL`,
    [id, empresaId]
  );
  return rows[0] || null;
}

async function findEntryById(qbl, id, empresaId) {
  const { rows } = await qbl.query(
    `SELECT p.id, p.placa, p.tipo_vehiculo, p.tipo_servicio, p.mensualidad_id,
            p.nombre_cliente, p.telefono, NULL::text AS documento_cliente,
            p.conductor_nombre AS nombre_conductor, p.conductor_documento AS documento_conductor,
            p.conductor_telefono AS telefono_conductor, p.hora_entrada, p.hora_salida,
            p.observaciones, p.metodo_pago, p.valor_total, p.minutos_total,
            v.id AS vehiculo_id, v.marca, v.modelo, v.color
     FROM parqueadero p
     LEFT JOIN vehiculos v ON v.id=p.vehiculo_id
     WHERE p.id=$1 AND p.empresa_id=$2`,
    [id, empresaId]
  );
  return rows[0] || null;
}

async function closeEntry(qbl, id, data) {
  const { rows } = await qbl.query(
    `UPDATE parqueadero
     SET hora_salida=$1, minutos_total=$2, valor_total=$3, estado_pago=$4,
         metodo_pago=$5, detalle_pago=$6,
         observaciones=CASE WHEN $7 IS NULL THEN observaciones ELSE COALESCE(observaciones||E'\n','') || $7 END
     WHERE id=$8 RETURNING *`,
    [data.hora_salida, data.minutos_total, data.valor_total, data.estado_pago,
     data.metodo_pago, data.detalle_pago, data.observaciones || null, id]
  );
  return rows[0] || null;
}

async function findEntryForRead(qbl, id, empresaId) {
  const { rows } = await qbl.query(
    `SELECT * FROM parqueadero WHERE id=$1 AND empresa_id=$2 LIMIT 1`,
    [id, empresaId]
  );
  return rows[0] || null;
}

async function findTarifaForVehicle(qbl, empresaId, tipoVehiculo) {
  const { rows } = await qbl.query(
    `SELECT * FROM tarifas WHERE empresa_id=$1 AND tipo_vehiculo=$2 AND activo=TRUE`,
    [empresaId, tipoVehiculo]
  );
  return rows[0] || null;
}

async function findActiveEntries(qbl, empresaId) {
  const { rows } = await qbl.query(
    `SELECT p.id, p.placa, p.tipo_vehiculo, p.tipo_servicio, p.mensualidad_id,
            p.nombre_cliente, p.telefono, p.hora_entrada, p.observaciones,
            v.marca, v.modelo, v.color
     FROM parqueadero p
     LEFT JOIN vehiculos v ON v.id=p.vehiculo_id
     WHERE p.empresa_id=$1 AND p.hora_salida IS NULL
     ORDER BY p.hora_entrada ASC`,
    [empresaId]
  );
  return rows;
}

async function findHistorial(qbl, empresaId, limit) {
  const { rows } = await qbl.query(
    `SELECT p.id, p.placa, p.tipo_vehiculo, p.tipo_servicio, p.mensualidad_id,
            p.nombre_cliente, p.hora_entrada, p.hora_salida, p.minutos_total,
            p.valor_total, p.metodo_pago
     FROM parqueadero p
     WHERE p.empresa_id=$1 AND p.hora_salida IS NOT NULL
     ORDER BY p.hora_salida DESC LIMIT $2`,
    [empresaId, limit]
  );
  return rows;
}

async function findHistorialByMensualidad(qbl, empresaId, mensualidadId, placa) {
  const { rows } = await qbl.query(
    `SELECT id, placa, tipo_vehiculo, tipo_servicio, nombre_cliente, hora_entrada,
            hora_salida, minutos_total, valor_total, metodo_pago, observaciones
     FROM parqueadero
     WHERE empresa_id=$1 AND (mensualidad_id=$2 OR placa=$3)
     ORDER BY hora_entrada DESC LIMIT 100`,
    [empresaId, mensualidadId, placa]
  );
  return rows;
}

async function findVehicleInfoByPlaca(qbl, empresaId, placa) {
  const { rows } = await qbl.query(
    `SELECT v.id AS vehiculo_id, v.placa, v.tipo_vehiculo, v.marca, v.modelo, v.color,
            c.id AS propietario_id, c.nombre AS propietario_nombre,
            c.documento AS propietario_documento, c.telefono AS propietario_telefono,
            c.correo AS propietario_correo
     FROM vehiculos v
     LEFT JOIN clientes c ON c.id=v.cliente_id
     WHERE v.empresa_id=$1 AND v.placa=$2 LIMIT 1`,
    [empresaId, placa]
  );
  return rows[0] || null;
}

async function findHistorialMultimodalByPlaca(qbl, empresaId, placa) {
  const [parqueadero, lavadero, taller] = await Promise.all([
    qbl.query(
      `SELECT id, hora_entrada, hora_salida, minutos_total, valor_total, metodo_pago, tipo_servicio, mensualidad_id, observaciones
       FROM parqueadero WHERE empresa_id=$1 AND placa=$2 ORDER BY hora_entrada DESC LIMIT 10`,
      [empresaId, placa]
    ),
    qbl.query(
      `SELECT id, tipo_lavado_id, precio, estado, hora_inicio, hora_fin, lavador_id, metodo_pago, observaciones
       FROM lavadero WHERE empresa_id=$1 AND placa=$2 ORDER BY hora_inicio DESC LIMIT 10`,
      [empresaId, placa]
    ),
    qbl.query(
      `SELECT id, numero_orden, descripcion_falla, estado, fecha_creacion, fecha_entrega, total_orden
       FROM taller_ordenes WHERE empresa_id=$1 AND placa=$2 ORDER BY fecha_creacion DESC LIMIT 10`,
      [empresaId, placa]
    ),
  ]);
  return { parqueadero: parqueadero.rows, lavadero: lavadero.rows, taller: taller.rows };
}

async function updateEntryFields(qbl, id, empresaId, fields) {
  const updates = [];
  const values = [];
  let idx = 1;

  const fieldMap = {
    placa: (v) => v.toUpperCase().trim(),
    tipo_vehiculo: (v) => v,
    nombre_cliente: (v) => v.trim(),
    telefono: (v) => v.trim(),
    conductor_nombre: (v) => v.trim(),
    conductor_documento: (v) => v.trim(),
    conductor_telefono: (v) => v.trim(),
    observaciones: (v) => v.trim(),
  };

  for (const [col, transform] of Object.entries(fieldMap)) {
    if (fields[col] !== undefined && fields[col] !== null) {
      updates.push(`${col}=$${idx++}`);
      values.push(transform(fields[col]));
    }
  }

  if (updates.length === 0) return null;

  values.push(empresaId, id);
  const { rows } = await qbl.query(
    `UPDATE parqueadero SET ${updates.join(',')} WHERE empresa_id=$${idx++} AND id=$${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

module.exports = {
  ensureSchema,
  findOpenEntryByPlaca, findActiveMensualidad,
  findClientByDocument, findClientByName, insertClient, updateClientData,
  findVehicleWithOwner, insertVehicle, updateVehicleOwner, updateVehicleClient,
  linkMensualidadVehicle, deactivateMensualidadesByPlaca, insertMensualidad, findMensualidades, findMensualidadById,
  insertEntry, findOpenEntryById, findEntryById, closeEntry, findEntryForRead,
  findTarifaForVehicle, findActiveEntries, findHistorial,
  findHistorialByMensualidad, findVehicleInfoByPlaca, findHistorialMultimodalByPlaca, updateEntryFields,
};
