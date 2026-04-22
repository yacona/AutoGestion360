'use strict';

/**
 * admin.controller.js
 *
 * Capa fina sobre admin.service.js para el panel SuperAdmin.
 * Todos los handlers asumen que el middleware SuperAdmin ya validó el rol
 * (ver admin.routes.js).
 */

const svc = require('./admin.service');
const { isSuperAdmin } = require('../../lib/helpers');
const { recordSecurityEventSafe, resolveRequestIp, resolveUserAgent } = require('../../lib/security/audit');

// ─── helpers ────────────────────────────────────────────────

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Dato duplicado.' });
    }
    next(err);
  }
};

async function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) {
    await recordSecurityEventSafe({
      empresaId: req.user?.empresa_id ?? null,
      usuarioId: req.user?.id ?? null,
      accion: 'AUTH_ACCESS_DENIED',
      entidad: 'auth_guard',
      detalle: {
        modulo: 'admin',
        razon: 'SUPERADMIN_REQUIRED',
        path: req.path,
        method: req.method,
        user_agent: resolveUserAgent(req),
      },
      ip: resolveRequestIp(req),
    });
    return res.status(403).json({ error: 'Acceso denegado. Solo SuperAdmin.' });
  }
  // Sprint 4.5: log tenant-scoped superadmins during transition.
  // Sprint 5 will enforce scope='platform' exclusively.
  if (req.user.scope !== 'platform') {
    console.warn(`[admin] SuperAdmin con scope tenant accediendo al panel: userId=${req.user.id}`);
  }
  next();
}

// ─── PLANES ─────────────────────────────────────────────────

const listarPlanes = wrap(async (req, res) => {
  res.json(await svc.listarPlanes());
});

const getPlan = wrap(async (req, res) => {
  const plan = await svc.getPlanConModulos(Number(req.params.id));
  res.json(plan);
});

const crearPlan = wrap(async (req, res) => {
  const plan = await svc.crearPlan(req.body);
  res.status(201).json({ mensaje: 'Plan creado.', plan });
});

const actualizarPlan = wrap(async (req, res) => {
  const plan = await svc.actualizarPlan(Number(req.params.id), req.body);
  res.json({ mensaje: 'Plan actualizado.', plan });
});

// ─── MÓDULOS DEL CATÁLOGO Y POR PLAN ────────────────────────

const listarModulos = wrap(async (req, res) => {
  res.json(await svc.getModulosDisponibles());
});

const getModulosPlan = wrap(async (req, res) => {
  const plan = await svc.getPlanConModulos(Number(req.params.id));
  res.json(plan.modulos);
});

const setModulosPlan = wrap(async (req, res) => {
  const modulos = await svc.setPlanModulos(Number(req.params.id), req.body.modulos);
  res.json({ mensaje: 'Módulos del plan actualizados.', modulos });
});

// ─── EMPRESAS ────────────────────────────────────────────────

const listarEmpresas = wrap(async (req, res) => {
  res.json(await svc.listarEmpresas());
});

const getEmpresa = wrap(async (req, res) => {
  const empresaId = Number(req.params.id);
  res.json(await svc.getEmpresaSaaSDetail(empresaId));
});

// ─── KPIs SaaS ───────────────────────────────────────────────

const getResumen = wrap(async (req, res) => {
  res.json(await svc.getResumenSaas());
});

const getProximasVencer = wrap(async (req, res) => {
  const dias = Number(req.query.dias) || 30;
  res.json(await svc.getProximasAVencer(dias));
});

// ─── ONBOARDING ──────────────────────────────────────────────

const onboarding = wrap(async (req, res) => {
  const result = await svc.onboardEmpresa(req.body);
  res.status(201).json({
    mensaje: 'Empresa creada con éxito.',
    empresa: result.empresa,
    plan:    result.plan,
  });
});

// ─── SUSCRIPCIÓN ─────────────────────────────────────────────

const getSuscripcion = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  res.json(await svc.getSuscripcionActual(empresaId));
});

const getSuscripcionHistorial = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  res.json(await svc.getHistorialSuscripciones(empresaId));
});

const getEstadoSaaS = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  res.json(await svc.getEstadoSaaSConsolidado(empresaId));
});

const asignarPlan = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const { plan_id, ...opts } = req.body;
  const suscripcion = await svc.asignarPlan(empresaId, Number(plan_id), {
    ciclo:         opts.ciclo,
    precioPactado: opts.precio_pactado !== undefined ? Number(opts.precio_pactado) : null,
    moneda:        opts.moneda,
    fechaFin:      opts.fecha_fin || null,
    estado:        opts.estado || 'ACTIVA',
    observaciones: opts.observaciones || null,
    pasarela:      opts.pasarela || 'MANUAL',
  });
  res.json({ mensaje: 'Plan asignado.', suscripcion });
});

const upgradePlan = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const { plan_id, ...opts } = req.body;
  const suscripcion = await svc.upgradePlan(empresaId, Number(plan_id), {
    ciclo:         opts.ciclo,
    precioPactado: opts.precio_pactado !== undefined ? Number(opts.precio_pactado) : null,
    moneda:        opts.moneda,
    fechaFin:      opts.fecha_fin || null,
    observaciones: opts.observaciones || null,
    pasarela:      opts.pasarela || 'MANUAL',
  });
  res.json({ mensaje: 'Upgrade aplicado.', suscripcion });
});

const downgradePlan = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const { plan_id, ...opts } = req.body;
  const suscripcion = await svc.downgradePlan(empresaId, Number(plan_id), {
    ciclo:         opts.ciclo,
    precioPactado: opts.precio_pactado !== undefined ? Number(opts.precio_pactado) : null,
    moneda:        opts.moneda,
    fechaFin:      opts.fecha_fin || null,
    observaciones: opts.observaciones || null,
    pasarela:      opts.pasarela || 'MANUAL',
  });
  res.json({ mensaje: 'Downgrade aplicado.', suscripcion });
});

const reactivarSuscripcion = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const suscripcion = await svc.reactivarSuscripcion(empresaId, {
    fechaFin:      req.body.fecha_fin || null,
    observaciones: req.body.observaciones || null,
  });
  res.json({ mensaje: 'Suscripción reactivada.', suscripcion });
});

const cambiarEstadoSuscripcion = wrap(async (req, res) => {
  const empresaId  = Number(req.params.empresaId);
  const { estado } = req.body;
  const suscripcion = await svc.cambiarEstadoSuscripcion(empresaId, String(estado).toUpperCase());
  res.json({ mensaje: `Suscripción actualizada a ${estado}.`, suscripcion });
});

// ─── LÍMITES EFECTIVOS ───────────────────────────────────────

const getLimites = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  res.json(await svc.getLimitesEfectivos(empresaId));
});

// ─── EMPRESA_MODULOS (overrides) ─────────────────────────────

const getEmpresaModulos = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  res.json(await svc.getModulosParaEmpresa(empresaId));
});

const upsertOverride = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const moduloId  = Number(req.params.moduloId);
  const override  = await svc.upsertModuloOverride(empresaId, moduloId, {
    activo:        req.body.activo !== false,
    limiteOverride: req.body.limite_override ?? null,
    notas:          req.body.notas ?? null,
  });
  res.json({ mensaje: 'Override guardado.', override });
});

const deleteOverride = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const moduloId  = Number(req.params.moduloId);
  const eliminado = await svc.removeModuloOverride(empresaId, moduloId);
  if (!eliminado) return res.status(404).json({ error: 'Override no encontrado.' });
  res.json({ mensaje: 'Override eliminado. El módulo sigue el comportamiento del plan.' });
});

const bulkOverrides = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const overrides = req.body.overrides;
  const results = [];

  for (const item of overrides) {
    const moduloId = Number(item.modulo_id);
    if (!moduloId) continue;

    if (item.eliminar) {
      await svc.removeModuloOverride(empresaId, moduloId);
      results.push({ modulo_id: moduloId, accion: 'eliminado' });
    } else {
      const saved = await svc.upsertModuloOverride(empresaId, moduloId, {
        activo:         item.activo !== false,
        limiteOverride: item.limite_override ?? null,
        notas:          item.notas ?? null,
      });
      results.push({ modulo_id: moduloId, accion: 'guardado', override: saved });
    }
  }

  res.json({ mensaje: `${results.length} overrides procesados.`, results });
});

// ─── USUARIOS DE TENANT ──────────────────────────────────────

const crearAdminTenant = wrap(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const usuario   = await svc.crearAdminTenant(empresaId, req.body);
  res.status(201).json({ mensaje: 'Usuario creado.', usuario });
});

module.exports = {
  requireSuperAdmin,
  // Planes
  listarPlanes,
  getPlan,
  crearPlan,
  actualizarPlan,
  // Módulos
  listarModulos,
  getModulosPlan,
  setModulosPlan,
  // Empresas
  listarEmpresas,
  getEmpresa,
  // KPIs
  getResumen,
  getProximasVencer,
  // Onboarding
  onboarding,
  // Suscripciones
  getSuscripcion,
  getSuscripcionHistorial,
  asignarPlan,
  upgradePlan,
  downgradePlan,
  reactivarSuscripcion,
  cambiarEstadoSuscripcion,
  getEstadoSaaS,
  // Límites
  getLimites,
  // Overrides
  getEmpresaModulos,
  upsertOverride,
  deleteOverride,
  bulkOverrides,
  // Usuarios
  crearAdminTenant,
};
