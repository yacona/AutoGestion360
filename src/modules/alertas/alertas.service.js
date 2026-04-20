const db = require('../../../db');
const AppError = require('../../lib/AppError');
const { toNumber, tableExists } = require('../../lib/helpers');
const { ensurePagosServiciosSchema } = require('../../../utils/pagos-servicios-schema');

const THRESHOLDS = {
  licenciaDias: 30, mensualidadDias: 7,
  parqueaderoHoras: 8, lavaderoHoras: 4, tallerHoras: 48,
  ocupacionPorcentaje: 85,
};

const SEVERITY_ORDER = { CRITICA: 0, ADVERTENCIA: 1, INFO: 2 };

function normalizarSeveridad(value) {
  const s = String(value || 'INFO').toUpperCase();
  return ['CRITICA', 'ADVERTENCIA', 'INFO'].includes(s) ? s : 'INFO';
}

function safeLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value, 10);
  return (!Number.isFinite(parsed) || parsed <= 0) ? fallback : Math.min(parsed, max);
}

function daysUntil(value) {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(23, 59, 59, 999);
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

function buildAlert({ tipo, severidad = 'INFO', titulo, descripcion, modulo = 'dashboard',
  referencia_tipo = null, referencia_id = null, placa = null, cliente_nombre = null,
  monto = null, fecha = null, dias = null, horas = null, accion = null }) {
  const s = normalizarSeveridad(severidad);
  const keyParts = [tipo, modulo, referencia_tipo, referencia_id, placa, fecha]
    .filter(Boolean).map((v) => (v instanceof Date ? v.toISOString() : String(v))).join('-');
  return {
    id: keyParts || `${tipo}-${Date.now()}`, tipo, severidad: s, titulo, descripcion, modulo,
    referencia_tipo, referencia_id, placa, cliente_nombre,
    monto: monto == null ? null : toNumber(monto),
    fecha, dias, horas, accion: accion || 'Revisar', leida: false, calculada: true,
  };
}

async function ensureAlertasSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS alertas (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      tipo VARCHAR(60) NOT NULL,
      parqueadero_id BIGINT,
      cliente_id BIGINT,
      titulo VARCHAR(160) NOT NULL,
      descripcion TEXT,
      leida BOOLEAN DEFAULT FALSE,
      creado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    ALTER TABLE alertas
      ADD COLUMN IF NOT EXISTS severidad VARCHAR(20) DEFAULT 'INFO',
      ADD COLUMN IF NOT EXISTS modulo VARCHAR(60),
      ADD COLUMN IF NOT EXISTS referencia_tipo VARCHAR(60),
      ADD COLUMN IF NOT EXISTS referencia_id BIGINT,
      ADD COLUMN IF NOT EXISTS placa VARCHAR(20),
      ADD COLUMN IF NOT EXISTS monto NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS accion VARCHAR(120)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS alertas_empresa_leida_idx ON alertas (empresa_id, leida, creado_en DESC)
  `);
}

async function agregarAlertasLicencia(empresaId, alertas, resumen) {
  const { rows: empresas } = await db.query(
    `SELECT id,nombre,activa,licencia_tipo,licencia_inicio,licencia_fin FROM empresas WHERE id=$1 LIMIT 1`,
    [empresaId]
  );
  const empresa = empresas[0];
  if (!empresa) return;

  let licencia = { nombre: empresa.licencia_tipo || 'Sin plan', fecha_inicio: empresa.licencia_inicio,
    fecha_fin: empresa.licencia_fin, activa: empresa.activa };

  if (await tableExists('empresa_licencia')) {
    const hasLicencias = await tableExists('licencias');
    const q = hasLicencias
      ? `SELECT el.fecha_inicio,el.fecha_fin,el.activa,COALESCE(l.nombre,e.licencia_tipo,'Sin plan') AS nombre
         FROM empresa_licencia el JOIN empresas e ON e.id=el.empresa_id LEFT JOIN licencias l ON l.id=el.licencia_id
         WHERE el.empresa_id=$1 AND el.activa=TRUE ORDER BY el.fecha_fin NULLS LAST LIMIT 1`
      : `SELECT el.fecha_inicio,el.fecha_fin,el.activa,COALESCE(e.licencia_tipo,'Sin plan') AS nombre
         FROM empresa_licencia el JOIN empresas e ON e.id=el.empresa_id
         WHERE el.empresa_id=$1 AND el.activa=TRUE ORDER BY el.fecha_fin NULLS LAST LIMIT 1`;
    const { rows } = await db.query(q, [empresaId]);
    if (rows[0]) licencia = rows[0];
  }

  const diasRestantes = daysUntil(licencia.fecha_fin);
  resumen.licencia = { nombre: licencia.nombre, activa: Boolean(licencia.activa && empresa.activa),
    fecha_inicio: licencia.fecha_inicio, fecha_fin: licencia.fecha_fin, dias_restantes: diasRestantes };

  if (!empresa.activa) {
    alertas.push(buildAlert({ tipo: 'LICENCIA_INACTIVA', severidad: 'CRITICA',
      titulo: 'Empresa inactiva',
      descripcion: 'La empresa está desactivada. Revisa el estado operativo antes de procesar servicios.',
      modulo: 'config', referencia_tipo: 'empresa', referencia_id: empresa.id, accion: 'Revisar empresa' }));
    return;
  }
  if (diasRestantes === null) return;
  if (diasRestantes < 0) {
    alertas.push(buildAlert({ tipo: 'LICENCIA_VENCIDA', severidad: 'CRITICA',
      titulo: 'Licencia vencida',
      descripcion: `La licencia ${licencia.nombre} venció hace ${Math.abs(diasRestantes)} día(s).`,
      modulo: 'config', referencia_tipo: 'licencia', referencia_id: empresa.id,
      fecha: licencia.fecha_fin, dias: diasRestantes, accion: 'Renovar licencia' }));
    return;
  }
  if (diasRestantes <= THRESHOLDS.licenciaDias) {
    alertas.push(buildAlert({ tipo: 'LICENCIA_POR_VENCER',
      severidad: diasRestantes <= 7 ? 'CRITICA' : 'ADVERTENCIA',
      titulo: 'Licencia próxima a vencer',
      descripcion: `La licencia ${licencia.nombre} vence en ${diasRestantes} día(s).`,
      modulo: 'config', referencia_tipo: 'licencia', referencia_id: empresa.id,
      fecha: licencia.fecha_fin, dias: diasRestantes, accion: 'Gestionar plan' }));
  }
}

async function agregarAlertasMensualidades(empresaId, alertas, resumen) {
  if (!(await tableExists('mensualidades_parqueadero'))) return;

  const { rows: sr } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE estado='ACTIVA')::int AS activas,
            COUNT(*) FILTER (WHERE estado='ACTIVA' AND fecha_fin<CURRENT_DATE)::int AS vencidas,
            COUNT(*) FILTER (WHERE estado='ACTIVA' AND fecha_fin>=CURRENT_DATE AND fecha_fin<=CURRENT_DATE+$2::int)::int AS proximas,
            COALESCE(SUM(valor_mensual) FILTER (WHERE estado='ACTIVA' AND fecha_fin<CURRENT_DATE),0) AS valor_vencido
     FROM mensualidades_parqueadero WHERE empresa_id=$1`,
    [empresaId, THRESHOLDS.mensualidadDias]
  );
  resumen.mensualidades = { activas: Number(sr[0]?.activas||0), vencidas: Number(sr[0]?.vencidas||0),
    proximas: Number(sr[0]?.proximas||0), valor_vencido: toNumber(sr[0]?.valor_vencido) };

  const { rows } = await db.query(
    `SELECT mp.id,mp.placa,mp.nombre_cliente,mp.cliente_id,mp.fecha_fin,mp.valor_mensual,
            (mp.fecha_fin-CURRENT_DATE)::int AS dias_restantes
     FROM mensualidades_parqueadero mp
     WHERE mp.empresa_id=$1 AND mp.estado='ACTIVA' AND mp.fecha_fin<=CURRENT_DATE+$2::int
     ORDER BY mp.fecha_fin ASC LIMIT 12`,
    [empresaId, THRESHOLDS.mensualidadDias]
  );

  for (const row of rows) {
    const dias = Number(row.dias_restantes);
    const vencida = dias < 0;
    alertas.push(buildAlert({
      tipo: vencida ? 'MENSUALIDAD_VENCIDA' : 'MENSUALIDAD_POR_VENCER',
      severidad: vencida || dias <= 2 ? 'CRITICA' : 'ADVERTENCIA',
      titulo: vencida ? 'Mensualidad vencida' : 'Mensualidad por vencer',
      descripcion: vencida
        ? `${row.nombre_cliente||row.placa} tiene una mensualidad vencida hace ${Math.abs(dias)} día(s).`
        : `${row.nombre_cliente||row.placa} vence en ${dias} día(s).`,
      modulo: 'parqueadero', referencia_tipo: 'mensualidad', referencia_id: row.id,
      placa: row.placa, cliente_nombre: row.nombre_cliente, monto: row.valor_mensual,
      fecha: row.fecha_fin, dias, accion: 'Ver mensualidades',
    }));
  }
}

function carteraPendienteSql() {
  return `
    SELECT 'parqueadero' AS modulo,p.id AS referencia_id,p.placa,
           COALESCE(c.nombre,p.nombre_cliente) AS cliente_nombre,
           GREATEST(COALESCE(p.valor_total,0)-COALESCE(psp.total_pagado,0),0) AS monto,p.hora_salida AS fecha
    FROM parqueadero p LEFT JOIN clientes c ON c.id=p.cliente_id
    LEFT JOIN (SELECT referencia_id,COALESCE(SUM(monto),0) AS total_pagado FROM pagos_servicios
               WHERE empresa_id=$1 AND modulo='parqueadero' AND estado='APLICADO' GROUP BY referencia_id) psp ON psp.referencia_id=p.id
    WHERE p.empresa_id=$1 AND p.hora_salida IS NOT NULL AND COALESCE(p.valor_total,0)>0
      AND UPPER(COALESCE(p.estado_pago,'')) NOT IN ('PAGADO','MENSUALIDAD')
      AND (NULLIF(TRIM(COALESCE(p.metodo_pago,'')),'') IS NULL OR COALESCE(psp.total_pagado,0)<COALESCE(p.valor_total,0))
      AND GREATEST(COALESCE(p.valor_total,0)-COALESCE(psp.total_pagado,0),0)>0
    UNION ALL
    SELECT 'lavadero',l.id,l.placa,c.nombre,GREATEST(COALESCE(l.precio,0)-COALESCE(psl.total_pagado,0),0),l.hora_fin
    FROM lavadero l LEFT JOIN clientes c ON c.id=l.cliente_id
    LEFT JOIN (SELECT referencia_id,COALESCE(SUM(monto),0) AS total_pagado FROM pagos_servicios
               WHERE empresa_id=$1 AND modulo='lavadero' AND estado='APLICADO' GROUP BY referencia_id) psl ON psl.referencia_id=l.id
    WHERE l.empresa_id=$1 AND l.estado='Completado' AND COALESCE(l.precio,0)>0
      AND (NULLIF(TRIM(COALESCE(l.metodo_pago,'')),'') IS NULL OR COALESCE(psl.total_pagado,0)<COALESCE(l.precio,0))
      AND GREATEST(COALESCE(l.precio,0)-COALESCE(psl.total_pagado,0),0)>0
    UNION ALL
    SELECT 'taller',t.id,t.placa,c.nombre,GREATEST(COALESCE(t.total_orden,0)-COALESCE(pst.total_pagado,0),0),t.fecha_entrega
    FROM taller_ordenes t LEFT JOIN clientes c ON c.id=t.cliente_id
    LEFT JOIN (SELECT referencia_id,COALESCE(SUM(monto),0) AS total_pagado FROM pagos_servicios
               WHERE empresa_id=$1 AND modulo='taller' AND estado='APLICADO' GROUP BY referencia_id) pst ON pst.referencia_id=t.id
    WHERE t.empresa_id=$1 AND t.estado='Entregado' AND COALESCE(t.total_orden,0)>0
      AND (NULLIF(TRIM(COALESCE(t.metodo_pago,'')),'') IS NULL OR COALESCE(pst.total_pagado,0)<COALESCE(t.total_orden,0))
      AND GREATEST(COALESCE(t.total_orden,0)-COALESCE(pst.total_pagado,0),0)>0
  `;
}

async function agregarAlertasCartera(empresaId, alertas, resumen) {
  await ensurePagosServiciosSchema();
  const sql = carteraPendienteSql();
  const { rows: sr } = await db.query(
    `SELECT COUNT(*)::int AS servicios_pendientes,COALESCE(SUM(monto),0) AS monto_pendiente FROM (${sql}) c`,
    [empresaId]
  );
  const totalPendientes = Number(sr[0]?.servicios_pendientes||0);
  const montoPendiente  = toNumber(sr[0]?.monto_pendiente);
  resumen.cartera = { servicios_pendientes: totalPendientes, monto_pendiente: montoPendiente };
  if (totalPendientes === 0) return;

  alertas.push(buildAlert({ tipo: 'CARTERA_PENDIENTE',
    severidad: totalPendientes >= 5 || montoPendiente >= 500000 ? 'CRITICA' : 'ADVERTENCIA',
    titulo: 'Cartera pendiente',
    descripcion: `${totalPendientes} servicio(s) cerrado(s) tienen pago pendiente por registrar.`,
    modulo: 'clientes', referencia_tipo: 'cartera', monto: montoPendiente, accion: 'Revisar cartera' }));

  const { rows } = await db.query(`SELECT * FROM (${sql}) c ORDER BY fecha ASC NULLS LAST LIMIT 8`, [empresaId]);
  for (const row of rows) {
    alertas.push(buildAlert({ tipo: 'SERVICIO_SIN_PAGO', severidad: 'ADVERTENCIA',
      titulo: 'Servicio sin pago registrado',
      descripcion: `${row.modulo} ${row.placa||''} tiene un saldo pendiente.`,
      modulo: row.modulo, referencia_tipo: row.modulo, referencia_id: row.referencia_id,
      placa: row.placa, cliente_nombre: row.cliente_nombre, monto: row.monto,
      fecha: row.fecha, accion: 'Registrar pago' }));
  }
}

async function agregarAlertasOperaciones(empresaId, alertas, resumen) {
  const op = { parqueadero_abiertos: 0, lavadero_abiertos: 0, taller_abiertos: 0, demoradas: 0 };

  const [{ rows: pr }, { rows: lr }, { rows: tr }] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM parqueadero WHERE empresa_id=$1 AND hora_salida IS NULL`, [empresaId]),
    db.query(`SELECT COUNT(*)::int AS total FROM lavadero WHERE empresa_id=$1 AND estado<>'Completado'`, [empresaId]),
    db.query(`SELECT COUNT(*)::int AS total FROM taller_ordenes WHERE empresa_id=$1 AND estado<>'Entregado'`, [empresaId]),
  ]);
  op.parqueadero_abiertos = Number(pr[0]?.total||0);
  op.lavadero_abiertos    = Number(lr[0]?.total||0);
  op.taller_abiertos      = Number(tr[0]?.total||0);

  const [{ rows: pqDems }, { rows: lavDems }, { rows: talDems }] = await Promise.all([
    db.query(
      `SELECT id,placa,nombre_cliente,hora_entrada,
              ROUND((EXTRACT(EPOCH FROM(NOW()-hora_entrada))/3600)::numeric,1) AS horas_abierto
       FROM parqueadero WHERE empresa_id=$1 AND hora_salida IS NULL
       AND EXTRACT(EPOCH FROM(NOW()-hora_entrada))/3600>=$2 ORDER BY hora_entrada ASC LIMIT 8`,
      [empresaId, THRESHOLDS.parqueaderoHoras]
    ),
    db.query(
      `SELECT l.id,l.placa,l.estado,l.hora_inicio,c.nombre AS cliente_nombre,
              ROUND((EXTRACT(EPOCH FROM(NOW()-l.hora_inicio))/3600)::numeric,1) AS horas_abierto
       FROM lavadero l LEFT JOIN clientes c ON c.id=l.cliente_id
       WHERE l.empresa_id=$1 AND l.estado<>'Completado'
       AND EXTRACT(EPOCH FROM(NOW()-l.hora_inicio))/3600>=$2 ORDER BY l.hora_inicio ASC LIMIT 8`,
      [empresaId, THRESHOLDS.lavaderoHoras]
    ),
    db.query(
      `SELECT t.id,t.placa,t.estado,t.fecha_creacion,c.nombre AS cliente_nombre,
              ROUND((EXTRACT(EPOCH FROM(NOW()-t.fecha_creacion))/3600)::numeric,1) AS horas_abierto
       FROM taller_ordenes t LEFT JOIN clientes c ON c.id=t.cliente_id
       WHERE t.empresa_id=$1 AND t.estado<>'Entregado'
       AND EXTRACT(EPOCH FROM(NOW()-t.fecha_creacion))/3600>=$2 ORDER BY t.fecha_creacion ASC LIMIT 8`,
      [empresaId, THRESHOLDS.tallerHoras]
    ),
  ]);

  for (const row of pqDems) {
    const horas = toNumber(row.horas_abierto); op.demoradas += 1;
    alertas.push(buildAlert({ tipo: 'PARQUEADERO_DEMORADO', severidad: horas>=24?'CRITICA':'ADVERTENCIA',
      titulo: 'Vehículo con permanencia alta',
      descripcion: `${row.placa} lleva ${horas} hora(s) sin salida registrada.`,
      modulo: 'parqueadero', referencia_tipo: 'parqueadero', referencia_id: row.id,
      placa: row.placa, cliente_nombre: row.nombre_cliente, fecha: row.hora_entrada,
      horas, accion: 'Registrar salida' }));
  }
  for (const row of lavDems) {
    const horas = toNumber(row.horas_abierto); op.demoradas += 1;
    alertas.push(buildAlert({ tipo: 'LAVADO_DEMORADO', severidad: horas>=12?'CRITICA':'ADVERTENCIA',
      titulo: 'Lavado pendiente por cerrar',
      descripcion: `${row.placa} está en ${row.estado} hace ${horas} hora(s).`,
      modulo: 'lavadero', referencia_tipo: 'lavadero', referencia_id: row.id,
      placa: row.placa, cliente_nombre: row.cliente_nombre, fecha: row.hora_inicio,
      horas, accion: 'Completar lavado' }));
  }
  for (const row of talDems) {
    const horas = toNumber(row.horas_abierto); op.demoradas += 1;
    alertas.push(buildAlert({ tipo: 'TALLER_DEMORADO', severidad: horas>=168?'CRITICA':'ADVERTENCIA',
      titulo: 'Orden de taller con seguimiento pendiente',
      descripcion: `${row.placa} lleva ${horas} hora(s) en estado ${row.estado}.`,
      modulo: 'taller', referencia_tipo: 'taller', referencia_id: row.id,
      placa: row.placa, cliente_nombre: row.cliente_nombre, fecha: row.fecha_creacion,
      horas, accion: 'Revisar orden' }));
  }
  resumen.operaciones = op;
}

async function agregarAlertasOcupacion(empresaId, alertas, resumen) {
  if (!(await tableExists('configuracion_parqueadero'))) return;
  const { rows: cfg } = await db.query(
    `SELECT capacidad_total FROM configuracion_parqueadero WHERE empresa_id=$1 LIMIT 1`,
    [empresaId]
  );
  const capacidad = Number(cfg[0]?.capacidad_total||0);
  if (capacidad <= 0) { resumen.ocupacion = { capacidad_total: 0, ocupados: 0, porcentaje: 0 }; return; }

  const { rows: occ } = await db.query(
    `SELECT COUNT(*)::int AS ocupados FROM parqueadero WHERE empresa_id=$1 AND hora_salida IS NULL`,
    [empresaId]
  );
  const ocupados   = Number(occ[0]?.ocupados||0);
  const porcentaje = Math.round((ocupados/capacidad)*100);
  resumen.ocupacion = { capacidad_total: capacidad, ocupados, porcentaje };

  if (porcentaje >= THRESHOLDS.ocupacionPorcentaje) {
    alertas.push(buildAlert({ tipo: 'OCUPACION_ALTA',
      severidad: porcentaje >= 100 ? 'CRITICA' : 'ADVERTENCIA',
      titulo: porcentaje >= 100 ? 'Parqueadero lleno' : 'Ocupación alta',
      descripcion: `La ocupación está en ${porcentaje}% (${ocupados} de ${capacidad} espacios).`,
      modulo: 'parqueadero', referencia_tipo: 'ocupacion', accion: 'Ver parqueadero' }));
  }
}

async function generarInteligentes(empresaId) {
  const alertas = [];
  const resumen = {
    total: 0, criticas: 0, advertencias: 0, informativas: 0,
    licencia: null,
    mensualidades: { activas: 0, vencidas: 0, proximas: 0, valor_vencido: 0 },
    cartera: { servicios_pendientes: 0, monto_pendiente: 0 },
    operaciones: { parqueadero_abiertos: 0, lavadero_abiertos: 0, taller_abiertos: 0, demoradas: 0 },
    ocupacion: { capacidad_total: 0, ocupados: 0, porcentaje: 0 },
  };

  await Promise.all([
    agregarAlertasLicencia(empresaId, alertas, resumen),
    agregarAlertasMensualidades(empresaId, alertas, resumen),
    agregarAlertasCartera(empresaId, alertas, resumen),
    agregarAlertasOperaciones(empresaId, alertas, resumen),
    agregarAlertasOcupacion(empresaId, alertas, resumen),
  ]);

  const ordenadas = alertas.sort((a, b) => {
    const sv = SEVERITY_ORDER[a.severidad] - SEVERITY_ORDER[b.severidad];
    if (sv !== 0) return sv;
    return (a.fecha ? new Date(a.fecha).getTime() : 0) - (b.fecha ? new Date(b.fecha).getTime() : 0);
  });

  resumen.total       = ordenadas.length;
  resumen.criticas    = ordenadas.filter((a) => a.severidad === 'CRITICA').length;
  resumen.advertencias = ordenadas.filter((a) => a.severidad === 'ADVERTENCIA').length;
  resumen.informativas = ordenadas.filter((a) => a.severidad === 'INFO').length;

  return { generado_en: new Date().toISOString(), resumen, alertas: ordenadas };
}

async function listar(empresaId, { tipo, limit } = {}) {
  await ensureAlertasSchema();
  const params = [empresaId];
  let query = `SELECT * FROM alertas WHERE empresa_id=$1`;
  if (tipo) { params.push(tipo); query += ` AND tipo=$${params.length}`; }
  params.push(safeLimit(limit));
  query += ` ORDER BY creado_en DESC LIMIT $${params.length}`;
  const { rows } = await db.query(query, params);
  return rows;
}

async function noLeidas(empresaId) {
  await ensureAlertasSchema();
  const { rows } = await db.query(
    `SELECT * FROM alertas WHERE empresa_id=$1 AND leida=FALSE ORDER BY creado_en DESC LIMIT 20`,
    [empresaId]
  );
  return rows;
}

async function marcarLeida(empresaId, id) {
  await ensureAlertasSchema();
  const { rows } = await db.query(
    `UPDATE alertas SET leida=TRUE WHERE id=$1 AND empresa_id=$2 RETURNING *`,
    [id, empresaId]
  );
  if (!rows.length) throw new AppError('Alerta no encontrada.', 404);
  return rows[0];
}

async function crear(empresaId, body) {
  const { tipo, parqueadero_id, cliente_id, titulo, descripcion, modulo,
          referencia_tipo, referencia_id, placa, monto, accion } = body;
  const severidad = normalizarSeveridad(body.severidad);

  if (!tipo || !titulo) throw new AppError('Tipo y titulo son obligatorios.', 400);

  await ensureAlertasSchema();
  const { rows } = await db.query(
    `INSERT INTO alertas
     (empresa_id,tipo,parqueadero_id,cliente_id,titulo,descripcion,severidad,modulo,referencia_tipo,referencia_id,placa,monto,accion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [empresaId, tipo, parqueadero_id||null, cliente_id||null, titulo, descripcion||null,
     severidad, modulo||null, referencia_tipo||null, referencia_id||null, placa||null, monto||null, accion||null]
  );
  return rows[0];
}

module.exports = { generarInteligentes, listar, noLeidas, marcarLeida, crear };
