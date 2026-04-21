'use strict';

/**
 * adminService.js — Lógica de negocio del panel SuperAdmin
 *
 * Trabaja exclusivamente con el sistema nuevo:
 *   planes  →  plan_modulos  →  suscripciones  →  empresa_modulos
 *
 * Todas las funciones reciben un `queryable` opcional (pool o client de pg)
 * para poder participar en transacciones externas.
 */

const bcrypt = require('bcryptjs');
const db = require('../db');
const { getParqueaderoConfig } = require('../utils/parqueadero-config');
const { assertEmpresaOwnedRecord, assertGlobalRecord } = require('../src/lib/tenant-scope');

// ─────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────

function clean(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function requireField(value, name) {
  if (!clean(value)) throw Object.assign(new Error(`El campo '${name}' es obligatorio.`), { statusCode: 400 });
}

// ─────────────────────────────────────────────────────────────
// EMPRESAS
// ─────────────────────────────────────────────────────────────

/**
 * Lista todas las empresas con métricas operativas y el plan activo
 * del sistema nuevo (suscripciones + planes).
 */
async function listarEmpresas(queryable = db) {
  const { rows } = await queryable.query(`
    SELECT
      e.id,
      e.nombre,
      e.nit,
      e.ciudad,
      e.email_contacto,
      e.telefono,
      e.zona_horaria,
      e.activa,
      e.creado_en,
      -- Plan actual (sistema nuevo)
      p.codigo          AS plan_codigo,
      p.nombre          AS plan_nombre,
      s.estado          AS suscripcion_estado,
      s.fecha_fin       AS suscripcion_fin,
      s.trial_hasta,
      -- Métricas de uso
      COALESCE(u.total,   0)::int AS usuarios_total,
      COALESCE(c.total,   0)::int AS clientes_total,
      COALESCE(pq.activos,0)::int AS parqueados_activos
    FROM empresas e
    LEFT JOIN suscripciones s
      ON s.empresa_id = e.id AND s.estado IN ('TRIAL','ACTIVA')
    LEFT JOIN planes p ON p.id = s.plan_id
    LEFT JOIN (SELECT empresa_id, COUNT(*) AS total  FROM usuarios   GROUP BY empresa_id) u  ON u.empresa_id  = e.id
    LEFT JOIN (SELECT empresa_id, COUNT(*) AS total  FROM clientes   GROUP BY empresa_id) c  ON c.empresa_id  = e.id
    LEFT JOIN (SELECT empresa_id, COUNT(*) AS activos FROM parqueadero
               WHERE hora_salida IS NULL GROUP BY empresa_id) pq ON pq.empresa_id = e.id
    ORDER BY e.creado_en DESC
  `);
  return rows;
}

/**
 * Devuelve una empresa con su suscripción activa y módulos habilitados.
 */
async function getEmpresaCompleta(empresaId, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');
  const { rows } = await queryable.query(`
    SELECT
      e.*,
      p.codigo       AS plan_codigo,
      p.nombre       AS plan_nombre,
      p.precio_mensual,
      s.id           AS suscripcion_id,
      s.estado       AS suscripcion_estado,
      s.fecha_inicio AS suscripcion_inicio,
      s.fecha_fin    AS suscripcion_fin,
      s.trial_hasta,
      s.ciclo,
      s.precio_pactado
    FROM empresas e
    LEFT JOIN suscripciones s  ON s.empresa_id = e.id AND s.estado IN ('TRIAL','ACTIVA')
    LEFT JOIN planes p         ON p.id = s.plan_id
    WHERE e.id = $1
    LIMIT 1
  `, [empresaId]);
  return rows[0] ?? null;
}

async function syncPlanModulos(queryable, planId, modulos = []) {
  await queryable.query('DELETE FROM plan_modulos WHERE plan_id = $1', [planId]);

  if (!Array.isArray(modulos) || modulos.length === 0) return;

  for (const modulo of modulos) {
    await assertGlobalRecord(
      queryable,
      'modulos',
      modulo.modulo_id,
      `Módulo ${modulo.modulo_id} no encontrado.`
    );

    await queryable.query(
      `INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        planId,
        modulo.modulo_id,
        modulo.limite_registros ?? null,
        modulo.activo !== false,
        modulo.metadata ? JSON.stringify(modulo.metadata) : null,
      ]
    );
  }
}

// ─────────────────────────────────────────────────────────────
// ONBOARDING — Creación atómica de tenant
// ─────────────────────────────────────────────────────────────

/**
 * Crea un nuevo tenant (empresa + suscripción + usuario admin) en una sola
 * transacción.
 *
 * @param {object} data
 *   nombre, nit, ciudad, direccion, telefono, emailContacto, zonaHoraria
 *   planCodigo  — 'starter' | 'pro' | 'enterprise'   (default: 'starter')
 *   adminNombre, adminEmail, adminPassword            (opcional)
 * @param {object} [queryable]  pool o client de pg
 */
async function onboardEmpresa(data, queryable = db) {
  const {
    nombre, nit, ciudad, direccion, telefono,
    emailContacto, zonaHoraria = 'America/Bogota',
    planCodigo = 'starter',
    adminNombre, adminEmail, adminPassword,
  } = data;

  requireField(nombre, 'nombre');
  if (adminEmail && String(adminPassword || '').trim().length < 6) {
    throw Object.assign(
      new Error('La contraseña del administrador debe tener al menos 6 caracteres.'),
      { statusCode: 400 }
    );
  }

  // Necesitamos client para la transacción
  const isExternalClient = queryable !== db && typeof queryable.query === 'function' && !queryable.connect;
  const client = isExternalClient ? queryable : await db.connect();

  try {
    if (!isExternalClient) await client.query('BEGIN');

    // 1. Verificar email único
    if (adminEmail) {
      const { rows } = await client.query(
        'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [adminEmail]
      );
      if (rows.length > 0) {
        throw Object.assign(
          new Error('Ese correo ya está registrado. Usa uno distinto para el admin.'),
          { statusCode: 409 }
        );
      }
    }

    // 2. Crear empresa
    const { rows: empRows } = await client.query(`
      INSERT INTO empresas (nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria, activa)
      VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
      RETURNING *
    `, [clean(nombre), clean(nit), clean(ciudad), clean(direccion), clean(telefono), clean(emailContacto), zonaHoraria]);
    const empresa = empRows[0];

    // 3. Buscar plan
    const { rows: planRows } = await client.query(
      'SELECT * FROM planes WHERE codigo = $1 AND activo = TRUE LIMIT 1',
      [planCodigo]
    );
    const plan = planRows[0];
    if (!plan) throw Object.assign(new Error(`Plan '${planCodigo}' no encontrado.`), { statusCode: 400 });

    // 4. Crear suscripción (TRIAL)
    const trialHasta = plan.trial_dias
      ? new Date(Date.now() + plan.trial_dias * 86400000)
      : null;

    await client.query(`
      INSERT INTO suscripciones
        (empresa_id, plan_id, estado, fecha_inicio, trial_hasta, ciclo,
         renovacion_automatica, pasarela, precio_pactado, moneda, observaciones)
      VALUES ($1,$2,'TRIAL',NOW(),$3,'MENSUAL',FALSE,'MANUAL',$4,'COP','Suscripción inicial en onboarding')
    `, [empresa.id, plan.id, trialHasta, plan.precio_mensual ?? 0]);

    // 5. Crear usuario admin
    if (adminEmail) {
      const hash = await bcrypt.hash(String(adminPassword).trim(), 10);
      await client.query(`
        INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol)
        VALUES ($1,$2,$3,$4,'Administrador')
      `, [empresa.id, clean(adminNombre) || `Admin ${empresa.nombre}`, adminEmail, hash]);
    }

    // 6. Inicializar configuración de parqueadero
    await getParqueaderoConfig(empresa.id, client);

    if (!isExternalClient) await client.query('COMMIT');

    return { empresa, plan };
  } catch (err) {
    if (!isExternalClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!isExternalClient) client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// PLANES Y SUSCRIPCIONES
// ─────────────────────────────────────────────────────────────

/** Lista todos los planes con el conteo de módulos que incluyen. */
async function listarPlanes(queryable = db) {
  const { rows } = await queryable.query(`
    SELECT
      p.*,
      COUNT(pm.id)::int AS modulos_incluidos
    FROM planes p
    LEFT JOIN plan_modulos pm ON pm.plan_id = p.id AND pm.activo = TRUE
    WHERE p.activo = TRUE
    GROUP BY p.id
    ORDER BY p.orden, p.id
  `);
  return rows;
}

async function crearPlan(data, queryable = db) {
  const isExternalClient = queryable !== db && typeof queryable.query === 'function' && !queryable.connect;
  const client = isExternalClient ? queryable : await db.connect();

  try {
    if (!isExternalClient) await client.query('BEGIN');

    const {
      codigo,
      nombre,
      descripcion = null,
      precio_mensual = 0,
      precio_anual = null,
      moneda = 'COP',
      trial_dias = 14,
      max_usuarios = null,
      max_vehiculos = null,
      max_empleados = null,
      es_publico = true,
      activo = true,
      orden = 0,
      metadata = null,
      modulos = [],
    } = data;

    const { rows } = await client.query(
      `INSERT INTO planes
       (codigo, nombre, descripcion, precio_mensual, precio_anual, moneda, trial_dias,
        max_usuarios, max_vehiculos, max_empleados, es_publico, activo, orden, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
       RETURNING *`,
      [
        clean(codigo),
        clean(nombre),
        clean(descripcion),
        precio_mensual,
        precio_anual,
        clean(moneda) || 'COP',
        trial_dias,
        max_usuarios,
        max_vehiculos,
        max_empleados,
        es_publico !== false,
        activo !== false,
        orden ?? 0,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    const plan = rows[0];
    await syncPlanModulos(client, plan.id, modulos);

    if (!isExternalClient) await client.query('COMMIT');
    return plan;
  } catch (err) {
    if (!isExternalClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!isExternalClient) client.release();
  }
}

async function actualizarPlan(planId, data, queryable = db) {
  await assertGlobalRecord(queryable, 'planes', planId, 'Plan no encontrado.');

  const isExternalClient = queryable !== db && typeof queryable.query === 'function' && !queryable.connect;
  const client = isExternalClient ? queryable : await db.connect();

  try {
    if (!isExternalClient) await client.query('BEGIN');

    const campos = [];
    const valores = [];
    let idx = 1;

    const mapping = {
      codigo: clean(data.codigo),
      nombre: clean(data.nombre),
      descripcion: data.descripcion === undefined ? undefined : clean(data.descripcion),
      precio_mensual: data.precio_mensual,
      precio_anual: data.precio_anual,
      moneda: data.moneda === undefined ? undefined : (clean(data.moneda) || 'COP'),
      trial_dias: data.trial_dias,
      max_usuarios: data.max_usuarios,
      max_vehiculos: data.max_vehiculos,
      max_empleados: data.max_empleados,
      es_publico: data.es_publico,
      activo: data.activo,
      orden: data.orden,
    };

    for (const [campo, valor] of Object.entries(mapping)) {
      if (valor === undefined) continue;
      campos.push(`${campo} = $${idx++}`);
      valores.push(valor);
    }

    if (data.metadata !== undefined) {
      campos.push(`metadata = $${idx++}::jsonb`);
      valores.push(data.metadata ? JSON.stringify(data.metadata) : null);
    }

    if (campos.length > 0) {
      campos.push(`actualizado_en = NOW()`);
      valores.push(planId);
      await client.query(
        `UPDATE planes SET ${campos.join(', ')} WHERE id = $${idx}`,
        valores
      );
    }

    if (data.modulos !== undefined) {
      await syncPlanModulos(client, planId, data.modulos);
    }

    const { rows } = await client.query('SELECT * FROM planes WHERE id = $1 LIMIT 1', [planId]);

    if (!isExternalClient) await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    if (!isExternalClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!isExternalClient) client.release();
  }
}

/**
 * Asigna un plan a una empresa.
 * Cancela la suscripción activa anterior (si es diferente plan).
 * Si es el mismo plan y está en TRIAL, actualiza en vez de reemplazar.
 *
 * @param {number} empresaId
 * @param {number} planId
 * @param {object} opts  ciclo, precioPactado, moneda, fechaFin, observaciones, pasarela
 */
async function asignarPlan(empresaId, planId, opts = {}, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');
  const {
    ciclo = 'MENSUAL',
    precioPactado = null,
    moneda = 'COP',
    fechaFin = null,
    observaciones = null,
    pasarela = 'MANUAL',
    estado = 'ACTIVA',
  } = opts;

  const { rows: planRows } = await queryable.query(
    'SELECT * FROM planes WHERE id = $1 LIMIT 1', [planId]
  );
  if (planRows.length === 0) {
    throw Object.assign(new Error('Plan no encontrado.'), { statusCode: 404 });
  }
  const plan = planRows[0];
  const precioFinal = precioPactado !== null ? precioPactado
    : (ciclo === 'ANUAL' ? plan.precio_anual : plan.precio_mensual) ?? 0;

  const isExternalClient = queryable !== db && typeof queryable.query === 'function' && !queryable.connect;
  const client = isExternalClient ? queryable : await db.connect();

  try {
    if (!isExternalClient) await client.query('BEGIN');

    // Cancelar suscripción activa anterior
    await client.query(`
      UPDATE suscripciones
      SET estado = 'CANCELADA', actualizado_en = NOW()
      WHERE empresa_id = $1 AND estado IN ('TRIAL','ACTIVA')
    `, [empresaId]);

    // Calcular trial_hasta si aplica
    const trialHasta = estado === 'TRIAL' && plan.trial_dias
      ? new Date(Date.now() + plan.trial_dias * 86400000)
      : null;

    const { rows } = await client.query(`
      INSERT INTO suscripciones
        (empresa_id, plan_id, estado, fecha_inicio, fecha_fin, trial_hasta,
         ciclo, pasarela, precio_pactado, moneda, observaciones)
      VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [empresaId, planId, estado, fechaFin, trialHasta,
        ciclo, pasarela, precioFinal, moneda, observaciones]);

    if (!isExternalClient) await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    if (!isExternalClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!isExternalClient) client.release();
  }
}

/**
 * Cambia el estado de una suscripción activa.
 * estados válidos: ACTIVA | SUSPENDIDA | CANCELADA | VENCIDA
 */
async function cambiarEstadoSuscripcion(empresaId, nuevoEstado, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');
  const ESTADOS = ['ACTIVA', 'TRIAL', 'SUSPENDIDA', 'CANCELADA', 'VENCIDA'];
  if (!ESTADOS.includes(nuevoEstado)) {
    throw Object.assign(new Error(`Estado inválido: ${nuevoEstado}`), { statusCode: 400 });
  }

  const { rows } = await queryable.query(`
    UPDATE suscripciones
    SET estado = $1, actualizado_en = NOW()
    WHERE empresa_id = $2 AND estado IN ('TRIAL','ACTIVA')
    RETURNING *
  `, [nuevoEstado, empresaId]);

  if (rows.length === 0) {
    throw Object.assign(new Error('No hay suscripción activa para esta empresa.'), { statusCode: 404 });
  }
  return rows[0];
}

/**
 * Suscripciones próximas a vencer (trial_hasta o fecha_fin dentro de N días).
 */
async function getProximasAVencer(dias = 30, queryable = db) {
  const { rows } = await queryable.query(`
    SELECT
      s.id           AS suscripcion_id,
      s.empresa_id,
      s.estado,
      s.fecha_fin,
      s.trial_hasta,
      p.codigo       AS plan_codigo,
      p.nombre       AS plan_nombre,
      p.precio_mensual,
      e.nombre       AS empresa_nombre,
      e.email_contacto,
      e.ciudad,
      EXTRACT(EPOCH FROM (
        COALESCE(
          CASE WHEN s.estado = 'TRIAL' THEN s.trial_hasta ELSE NULL END,
          s.fecha_fin
        ) - NOW()
      )) / 86400 AS dias_restantes
    FROM suscripciones s
    JOIN planes   p ON p.id = s.plan_id
    JOIN empresas e ON e.id = s.empresa_id
    WHERE s.estado IN ('TRIAL','ACTIVA')
      AND (
        (s.estado = 'TRIAL'  AND s.trial_hasta IS NOT NULL
          AND s.trial_hasta BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL)
        OR
        (s.estado = 'ACTIVA' AND s.fecha_fin IS NOT NULL
          AND s.fecha_fin BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL)
      )
    ORDER BY COALESCE(
      CASE WHEN s.estado = 'TRIAL' THEN s.trial_hasta ELSE NULL END,
      s.fecha_fin
    ) ASC
  `, [dias]);
  return rows;
}

/**
 * Resumen SaaS para el dashboard del superadmin.
 * Usa la nueva tabla suscripciones + planes.
 */
async function getResumenSaas(queryable = db) {
  const { rows } = await queryable.query(`
    SELECT
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE s.estado = 'TRIAL')           AS trial,
      COUNT(*) FILTER (WHERE s.estado = 'ACTIVA')          AS activas,
      COUNT(*) FILTER (
        WHERE s.estado = 'TRIAL'
          AND s.trial_hasta IS NOT NULL
          AND s.trial_hasta < NOW()
      )                                                     AS trials_vencidos,
      COUNT(*) FILTER (
        WHERE s.estado = 'ACTIVA'
          AND s.fecha_fin IS NOT NULL
          AND s.fecha_fin < NOW()
      )                                                     AS vencidas,
      COALESCE(SUM(
        CASE WHEN s.estado = 'ACTIVA' THEN s.precio_pactado ELSE 0 END
      ), 0)                                                 AS mrr,
      COALESCE(SUM(
        CASE WHEN s.estado = 'ACTIVA' THEN s.precio_pactado * 12 ELSE 0 END
      ), 0)                                                 AS arr
    FROM suscripciones s
    WHERE s.estado IN ('TRIAL','ACTIVA')
  `);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────
// EMPRESA_MODULOS — Sobreescrituras / add-ons por empresa
// ─────────────────────────────────────────────────────────────

/**
 * Devuelve todos los módulos activos con su estado para una empresa concreta.
 *
 * estado posibles:
 *   'incluido'    → el plan lo incluye y no está bloqueado por override
 *   'addon'       → override activo pero el plan NO lo incluye
 *   'desactivado' → override activo=FALSE (bloquea módulo del plan)
 *   'no_incluido' → ni el plan ni override lo incluyen
 */
async function getModulosParaEmpresa(empresaId, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');
  const { rows } = await queryable.query(`
    SELECT
      m.id,
      m.nombre,
      m.descripcion,
      m.icono_clave,
      m.orden,
      -- Override de empresa
      em.id             IS NOT NULL   AS tiene_override,
      em.activo                       AS override_activo,
      em.limite_override,
      em.notas                        AS override_notas,
      -- ¿Está en el plan activo?
      pm.id             IS NOT NULL   AS en_plan,
      pm.limite_registros             AS limite_plan,
      -- Estado efectivo calculado
      CASE
        WHEN em.id IS NOT NULL AND em.activo = TRUE  AND pm.id IS NULL     THEN 'addon'
        WHEN em.id IS NOT NULL AND em.activo = FALSE                       THEN 'desactivado'
        WHEN pm.id IS NOT NULL AND COALESCE(em.activo, TRUE) = TRUE        THEN 'incluido'
        ELSE 'no_incluido'
      END AS estado_efectivo
    FROM modulos m
    -- Suscripción activa de la empresa
    LEFT JOIN suscripciones s
      ON s.empresa_id = $1 AND s.estado IN ('TRIAL','ACTIVA')
    LEFT JOIN plan_modulos pm
      ON pm.plan_id = s.plan_id AND pm.modulo_id = m.id AND pm.activo = TRUE
    LEFT JOIN empresa_modulos em
      ON em.empresa_id = $1 AND em.modulo_id = m.id
    WHERE m.activo = TRUE
    ORDER BY m.orden NULLS LAST, m.nombre
  `, [empresaId]);
  return rows;
}

/**
 * Crea o actualiza un override de módulo para una empresa.
 *
 * @param {number}  empresaId
 * @param {number}  moduloId
 * @param {boolean} activo          true = habilitar, false = deshabilitar
 * @param {number}  [limiteOverride] null = heredar del plan, 0 = sin límite
 * @param {string}  [notas]
 */
async function upsertModuloOverride(empresaId, moduloId, { activo = true, limiteOverride = null, notas = null } = {}, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');
  await assertGlobalRecord(queryable, 'modulos', moduloId, 'Módulo no encontrado.');
  const { rows } = await queryable.query(`
    INSERT INTO empresa_modulos (empresa_id, modulo_id, activo, limite_override, notas)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (empresa_id, modulo_id)
    DO UPDATE SET
      activo          = EXCLUDED.activo,
      limite_override = EXCLUDED.limite_override,
      notas           = EXCLUDED.notas,
      actualizado_en  = NOW()
    RETURNING *
  `, [empresaId, moduloId, activo, limiteOverride, clean(notas)]);
  return rows[0];
}

/** Elimina el override de un módulo (vuelve al comportamiento del plan). */
async function removeModuloOverride(empresaId, moduloId, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');
  const { rowCount } = await queryable.query(
    'DELETE FROM empresa_modulos WHERE empresa_id = $1 AND modulo_id = $2',
    [empresaId, moduloId]
  );
  return rowCount > 0;
}

// ─────────────────────────────────────────────────────────────
// USUARIOS DE TENANT
// ─────────────────────────────────────────────────────────────

/**
 * Crea el usuario administrador inicial de un tenant existente.
 * Verifica que el email sea único globalmente.
 */
async function crearAdminTenant(empresaId, { nombre, email, password, rol = 'Administrador' }, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');
  requireField(email, 'email');
  requireField(password, 'password');
  if (String(password).trim().length < 6) {
    throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), { statusCode: 400 });
  }

  const { rows: exist } = await queryable.query(
    'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]
  );
  if (exist.length > 0) {
    throw Object.assign(new Error('Ese correo ya está registrado.'), { statusCode: 409 });
  }

  const hash = await bcrypt.hash(String(password).trim(), 10);
  const { rows } = await queryable.query(`
    INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, empresa_id, nombre, email, rol, activo, creado_en
  `, [empresaId, clean(nombre) || `Admin empresa ${empresaId}`, email, hash, rol]);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────
// PLANES — lectura detallada y gestión de módulos por plan
// ─────────────────────────────────────────────────────────────

/** Devuelve un plan con sus módulos asociados. */
async function getPlanConModulos(planId, queryable = db) {
  await assertGlobalRecord(queryable, 'planes', planId, 'Plan no encontrado.');
  const { rows: planRows } = await queryable.query(
    'SELECT * FROM planes WHERE id = $1 LIMIT 1', [planId]
  );
  const { rows: modulos } = await queryable.query(`
    SELECT
      m.id, m.nombre, m.descripcion, m.icono_clave, m.orden,
      pm.limite_registros, pm.activo, pm.metadata
    FROM plan_modulos pm
    JOIN modulos m ON m.id = pm.modulo_id
    WHERE pm.plan_id = $1 AND m.activo = TRUE
    ORDER BY m.orden NULLS LAST, m.nombre
  `, [planId]);
  return { ...planRows[0], modulos };
}

/** Lista todos los módulos del catálogo global. */
async function getModulosDisponibles(queryable = db) {
  const { rows } = await queryable.query(`
    SELECT id, nombre, descripcion, icono_clave, orden, activo
    FROM modulos
    WHERE activo = TRUE
    ORDER BY orden NULLS LAST, nombre
  `);
  return rows;
}

/**
 * Reemplaza los módulos de un plan.
 * Recibe array de { modulo_id, limite_registros?, activo?, metadata? }.
 */
async function setPlanModulos(planId, modulos, queryable = db) {
  await assertGlobalRecord(queryable, 'planes', planId, 'Plan no encontrado.');

  const isExternalClient = queryable !== db && typeof queryable.query === 'function' && !queryable.connect;
  const client = isExternalClient ? queryable : await db.connect();

  try {
    if (!isExternalClient) await client.query('BEGIN');
    await syncPlanModulos(client, planId, modulos);
    if (!isExternalClient) await client.query('COMMIT');

    const { rows } = await queryable.query(`
      SELECT
        m.id, m.nombre, m.descripcion, m.icono_clave, m.orden,
        pm.limite_registros, pm.activo, pm.metadata
      FROM plan_modulos pm
      JOIN modulos m ON m.id = pm.modulo_id
      WHERE pm.plan_id = $1 AND m.activo = TRUE
      ORDER BY m.orden NULLS LAST, m.nombre
    `, [planId]);
    return rows;
  } catch (err) {
    if (!isExternalClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!isExternalClient) client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// LÍMITES EFECTIVOS — plan + overrides consolidados
// ─────────────────────────────────────────────────────────────

/**
 * Calcula los límites efectivos de una empresa combinando:
 *   - Límites globales del plan (max_usuarios, max_vehiculos, max_empleados)
 *   - Límites por módulo del plan (plan_modulos.limite_registros)
 *   - Overrides por empresa (empresa_modulos.limite_override)
 */
async function getLimitesEfectivos(empresaId, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');

  const { rows: planRows } = await queryable.query(`
    SELECT
      p.id AS plan_id, p.codigo AS plan_codigo, p.nombre AS plan_nombre,
      p.max_usuarios, p.max_vehiculos, p.max_empleados,
      s.estado AS suscripcion_estado, s.fecha_fin, s.trial_hasta
    FROM suscripciones s
    JOIN planes p ON p.id = s.plan_id
    WHERE s.empresa_id = $1 AND s.estado IN ('TRIAL','ACTIVA')
    LIMIT 1
  `, [empresaId]);

  const plan = planRows[0] || null;
  const modulos = await getModulosParaEmpresa(empresaId, queryable);

  return {
    plan,
    limites_globales: {
      max_usuarios:  plan?.max_usuarios  ?? null,
      max_vehiculos: plan?.max_vehiculos ?? null,
      max_empleados: plan?.max_empleados ?? null,
    },
    modulos: modulos.map((m) => ({
      id:              m.id,
      nombre:          m.nombre,
      estado_efectivo: m.estado_efectivo,
      limite_plan:     m.limite_plan,
      limite_override: m.limite_override,
      limite_efectivo: m.limite_override !== null ? m.limite_override : m.limite_plan,
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// LIFECYCLE — upgrade, downgrade, reactivación
// ─────────────────────────────────────────────────────────────

/**
 * Upgrade de plan: cancela la suscripción actual e inicia una nueva con
 * un plan superior. Funcionalmente igual a asignarPlan; el prefijo
 * "upgrade" registra la intención en observaciones.
 */
async function upgradePlan(empresaId, planId, opts = {}, queryable = db) {
  return asignarPlan(empresaId, planId, {
    ...opts,
    observaciones: opts.observaciones || 'Upgrade de plan',
  }, queryable);
}

/**
 * Downgrade de plan: igual que upgradePlan pero marca la intención
 * de bajar de plan.
 */
async function downgradePlan(empresaId, planId, opts = {}, queryable = db) {
  return asignarPlan(empresaId, planId, {
    ...opts,
    observaciones: opts.observaciones || 'Downgrade de plan',
  }, queryable);
}

/**
 * Reactiva la suscripción más reciente que esté SUSPENDIDA o VENCIDA.
 * No cambia el plan; solo restaura el estado a ACTIVA.
 *
 * @param {number} empresaId
 * @param {{ fechaFin?: string|null, observaciones?: string }} [opts]
 */
async function reactivarSuscripcion(empresaId, opts = {}, queryable = db) {
  await assertEmpresaOwnedRecord(queryable, 'empresas', empresaId, empresaId, 'Empresa no encontrada.');

  const { rows } = await queryable.query(`
    UPDATE suscripciones
    SET estado = 'ACTIVA',
        fecha_fin = COALESCE($2::timestamptz, fecha_fin),
        observaciones = COALESCE($3, observaciones),
        actualizado_en = NOW()
    WHERE id = (
      SELECT id FROM suscripciones
      WHERE empresa_id = $1 AND estado IN ('SUSPENDIDA','VENCIDA')
      ORDER BY id DESC
      LIMIT 1
    )
    RETURNING *
  `, [empresaId, opts.fechaFin || null, opts.observaciones || 'Reactivación manual']);

  if (rows.length === 0) {
    throw Object.assign(
      new Error('No hay suscripción suspendida o vencida para reactivar.'),
      { statusCode: 404 }
    );
  }
  return rows[0];
}

module.exports = {
  // Empresas
  listarEmpresas,
  getEmpresaCompleta,
  onboardEmpresa,
  // Planes — catálogo y módulos
  listarPlanes,
  crearPlan,
  actualizarPlan,
  getPlanConModulos,
  getModulosDisponibles,
  setPlanModulos,
  // Suscripciones — lifecycle
  asignarPlan,
  upgradePlan,
  downgradePlan,
  reactivarSuscripcion,
  cambiarEstadoSuscripcion,
  getProximasAVencer,
  getResumenSaas,
  // Límites efectivos
  getLimitesEfectivos,
  // Módulos por empresa (overrides)
  getModulosParaEmpresa,
  upsertModuloOverride,
  removeModuloOverride,
  // Usuarios de tenant
  crearAdminTenant,
};
