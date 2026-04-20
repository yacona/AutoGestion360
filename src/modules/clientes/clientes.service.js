const db = require('../../../db');
const AppError = require('../../lib/AppError');
const { toNumber, tableExists } = require('../../lib/helpers');

// Subquery reutilizable de stats por módulo para cliente
const STATS_BY_CLIENTE = /* sql */`
  LEFT JOIN (
    SELECT COALESCE(p.cliente_id, v.cliente_id) AS cliente_id,
           COUNT(*)::int AS total_parqueadero,
           COALESCE(SUM(p.valor_total), 0) AS ingresos_parqueadero,
           MAX(COALESCE(p.hora_salida, p.hora_entrada, p.creado_en)) AS ultima_parqueadero
    FROM parqueadero p LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
    WHERE p.empresa_id = $1 GROUP BY COALESCE(p.cliente_id, v.cliente_id)
  ) p ON p.cliente_id = c.id
  LEFT JOIN (
    SELECT COALESCE(l.cliente_id, v.cliente_id) AS cliente_id,
           COUNT(*)::int AS total_lavadero,
           COALESCE(SUM(l.precio), 0) AS ingresos_lavadero,
           MAX(COALESCE(l.hora_fin, l.hora_inicio, l.creado_en)) AS ultima_lavadero
    FROM lavadero l LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
    WHERE l.empresa_id = $1 GROUP BY COALESCE(l.cliente_id, v.cliente_id)
  ) l ON l.cliente_id = c.id
  LEFT JOIN (
    SELECT COALESCE(t.cliente_id, v.cliente_id) AS cliente_id,
           COUNT(*)::int AS total_taller,
           COALESCE(SUM(t.total_orden), 0) AS ingresos_taller,
           MAX(COALESCE(t.fecha_entrega, t.fecha_creacion)) AS ultima_taller
    FROM taller_ordenes t LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
    WHERE t.empresa_id = $1 GROUP BY COALESCE(t.cliente_id, v.cliente_id)
  ) t ON t.cliente_id = c.id
`;

const CLIENTE_FIELDS = /* sql */`
  c.id, c.nombre, c.documento, c.telefono, c.correo,
  c.creado_en AS fecha_registro,
  COALESCE(p.total_parqueadero, 0) AS total_parqueadero,
  COALESCE(l.total_lavadero, 0) AS total_lavadero,
  COALESCE(t.total_taller, 0) AS total_taller,
  COALESCE(p.ingresos_parqueadero, 0) AS ingresos_parqueadero,
  COALESCE(l.ingresos_lavadero, 0) AS ingresos_lavadero,
  COALESCE(t.ingresos_taller, 0) AS ingresos_taller,
  COALESCE(p.total_parqueadero, 0) + COALESCE(l.total_lavadero, 0) + COALESCE(t.total_taller, 0) AS total_servicios,
  COALESCE(p.ingresos_parqueadero, 0) + COALESCE(l.ingresos_lavadero, 0) + COALESCE(t.ingresos_taller, 0) AS total_gastado,
  GREATEST(
    COALESCE(p.ultima_parqueadero, c.creado_en),
    COALESCE(l.ultima_lavadero, c.creado_en),
    COALESCE(t.ultima_taller, c.creado_en)
  ) AS ultima_actividad
`;

async function listar(empresaId, { search } = {}) {
  const params = [empresaId];
  let where = 'c.empresa_id = $1';

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (UPPER(c.nombre) LIKE UPPER($2) OR c.documento LIKE $2)`;
  }

  const { rows } = await db.query(
    `SELECT ${CLIENTE_FIELDS}
     FROM clientes c ${STATS_BY_CLIENTE}
     WHERE ${where}
     ORDER BY ultima_actividad DESC NULLS LAST, c.nombre ASC`,
    params
  );
  return rows;
}

async function obtener(empresaId, clienteId) {
  const { rows } = await db.query(
    `SELECT ${CLIENTE_FIELDS}
     FROM clientes c ${STATS_BY_CLIENTE}
     WHERE c.id = $2 AND c.empresa_id = $1
     LIMIT 1`,
    [empresaId, clienteId]
  );

  if (!rows.length) throw new AppError('Cliente no encontrado.', 404);
  const cliente = rows[0];

  const [{ rows: vehiculos }, { rows: historial }] = await Promise.all([
    db.query(
      `SELECT v.id, v.placa, v.tipo_vehiculo, v.marca, v.modelo, v.color,
              v.creado_en AS fecha_registro,
              COALESCE(p.total_parqueadero,0) AS total_parqueadero,
              COALESCE(l.total_lavadero,0)    AS total_lavadero,
              COALESCE(t.total_taller,0)      AS total_taller,
              COALESCE(p.total_parqueadero,0)+COALESCE(l.total_lavadero,0)+COALESCE(t.total_taller,0) AS total_servicios,
              COALESCE(p.ingresos_parqueadero,0)+COALESCE(l.ingresos_lavadero,0)+COALESCE(t.ingresos_taller,0) AS total_gastado,
              GREATEST(
                COALESCE(p.ultima_parqueadero,v.creado_en),
                COALESCE(l.ultima_lavadero,v.creado_en),
                COALESCE(t.ultima_taller,v.creado_en)
              ) AS ultima_actividad
       FROM vehiculos v
       LEFT JOIN (
         SELECT vehiculo_id, COUNT(*)::int AS total_parqueadero,
                COALESCE(SUM(valor_total),0) AS ingresos_parqueadero,
                MAX(COALESCE(hora_salida,hora_entrada,creado_en)) AS ultima_parqueadero
         FROM parqueadero WHERE empresa_id=$2 GROUP BY vehiculo_id
       ) p ON p.vehiculo_id=v.id
       LEFT JOIN (
         SELECT vehiculo_id, COUNT(*)::int AS total_lavadero,
                COALESCE(SUM(precio),0) AS ingresos_lavadero,
                MAX(COALESCE(hora_fin,hora_inicio,creado_en)) AS ultima_lavadero
         FROM lavadero WHERE empresa_id=$2 GROUP BY vehiculo_id
       ) l ON l.vehiculo_id=v.id
       LEFT JOIN (
         SELECT vehiculo_id, COUNT(*)::int AS total_taller,
                COALESCE(SUM(total_orden),0) AS ingresos_taller,
                MAX(COALESCE(fecha_entrega,fecha_creacion)) AS ultima_taller
         FROM taller_ordenes WHERE empresa_id=$2 GROUP BY vehiculo_id
       ) t ON t.vehiculo_id=v.id
       WHERE v.cliente_id=$1 AND v.empresa_id=$2
       ORDER BY ultima_actividad DESC NULLS LAST, v.creado_en DESC`,
      [clienteId, empresaId]
    ),
    db.query(
      `SELECT referencia_id, tipo, fecha, monto, placa, estado, metodo_pago, detalle
       FROM (
         SELECT p.id AS referencia_id, 'Parqueadero' AS tipo,
                p.hora_salida AS fecha, p.valor_total AS monto, p.placa,
                COALESCE(p.estado_pago,'CERRADO') AS estado, p.metodo_pago, p.tipo_servicio AS detalle
         FROM parqueadero p LEFT JOIN vehiculos v ON v.id=p.vehiculo_id
         WHERE COALESCE(p.cliente_id,v.cliente_id)=$1 AND p.empresa_id=$2 AND p.hora_salida IS NOT NULL
         UNION ALL
         SELECT l.id, 'Lavadero', COALESCE(l.hora_fin,l.hora_inicio), l.precio, l.placa,
                l.estado, l.metodo_pago, 'Servicio de lavado'
         FROM lavadero l LEFT JOIN vehiculos v ON v.id=l.vehiculo_id
         WHERE COALESCE(l.cliente_id,v.cliente_id)=$1 AND l.empresa_id=$2
         UNION ALL
         SELECT t.id, 'Taller', COALESCE(t.fecha_entrega,t.fecha_creacion), t.total_orden, t.placa,
                t.estado, t.metodo_pago, COALESCE(t.descripcion_falla,'Orden de taller')
         FROM taller_ordenes t LEFT JOIN vehiculos v ON v.id=t.vehiculo_id
         WHERE COALESCE(t.cliente_id,v.cliente_id)=$1 AND t.empresa_id=$2
       ) historial
       ORDER BY fecha DESC NULLS LAST LIMIT 25`,
      [clienteId, empresaId]
    ),
  ]);

  let mensualidades = [];
  if (await tableExists('mensualidades_parqueadero')) {
    const { rows: mensualidadesRows } = await db.query(
      `SELECT mp.*, COUNT(p.id)::int AS ingresos_registrados, MAX(p.hora_entrada) AS ultimo_ingreso
       FROM mensualidades_parqueadero mp
       LEFT JOIN parqueadero p ON p.mensualidad_id=mp.id AND p.empresa_id=mp.empresa_id
       WHERE mp.empresa_id=$2 AND (mp.cliente_id=$1 OR ($3::text IS NOT NULL AND mp.documento=$3::text))
       GROUP BY mp.id
       ORDER BY CASE WHEN mp.estado='ACTIVA' THEN 0 ELSE 1 END, mp.fecha_fin DESC, mp.creado_en DESC`,
      [clienteId, empresaId, cliente.documento || null]
    );
    mensualidades = mensualidadesRows;
  }

  const totalParqueadero    = toNumber(cliente.total_parqueadero);
  const totalLavadero       = toNumber(cliente.total_lavadero);
  const totalTaller         = toNumber(cliente.total_taller);
  const ingresosParqueadero = toNumber(cliente.ingresos_parqueadero);
  const ingresosLavadero    = toNumber(cliente.ingresos_lavadero);
  const ingresosTaller      = toNumber(cliente.ingresos_taller);
  const mensualidadesActivas = mensualidades.filter((m) => {
    const activa  = m.estado === 'ACTIVA';
    const vigente = !m.fecha_fin || new Date(m.fecha_fin) >= new Date();
    return activa && vigente;
  }).length;

  return {
    cliente,
    vehiculos,
    historial,
    mensualidades,
    estadisticas: {
      total_servicios: totalParqueadero + totalLavadero + totalTaller,
      total_gastado: ingresosParqueadero + ingresosLavadero + ingresosTaller,
      vehiculos_total: vehiculos.length,
      mensualidades_total: mensualidades.length,
      mensualidades_activas: mensualidadesActivas,
      ultima_visita: cliente.ultima_actividad || historial[0]?.fecha || null,
      modulos: {
        parqueadero: { servicios: totalParqueadero, ingresos: ingresosParqueadero },
        lavadero:    { servicios: totalLavadero,    ingresos: ingresosLavadero },
        taller:      { servicios: totalTaller,      ingresos: ingresosTaller },
      },
    },
  };
}

async function crear(empresaId, { nombre, documento, telefono, correo }) {
  if (!nombre) throw new AppError('El nombre es obligatorio.', 400);

  if (documento) {
    const { rows } = await db.query(
      `SELECT id FROM clientes WHERE empresa_id=$1 AND documento=$2`,
      [empresaId, documento]
    );
    if (rows.length) throw new AppError('Ya existe un cliente con este documento.', 409);
  }

  const { rows } = await db.query(
    `INSERT INTO clientes (empresa_id, nombre, documento, telefono, correo)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, nombre, documento, telefono, correo, creado_en AS fecha_registro`,
    [empresaId, nombre, documento || null, telefono || null, correo || null]
  );

  return rows[0];
}

async function actualizar(empresaId, clienteId, body) {
  const campos = [];
  const params = [clienteId, empresaId];
  let idx = 3;

  for (const key of ['nombre', 'documento', 'telefono', 'correo']) {
    if (body[key] !== undefined) {
      campos.push(`${key} = $${idx++}`);
      params.push(body[key]);
    }
  }

  if (!campos.length) return { mensaje: 'No hay cambios para aplicar.' };

  const { rows } = await db.query(
    `UPDATE clientes SET ${campos.join(', ')}
     WHERE id=$1 AND empresa_id=$2
     RETURNING id, nombre, documento, telefono, correo, creado_en AS fecha_registro`,
    params
  );

  if (!rows.length) throw new AppError('Cliente no encontrado.', 404);
  return rows[0];
}

async function eliminar(empresaId, clienteId) {
  const { rows } = await db.query(
    `DELETE FROM clientes WHERE id=$1 AND empresa_id=$2 RETURNING id`,
    [clienteId, empresaId]
  );
  if (!rows.length) throw new AppError('Cliente no encontrado.', 404);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
