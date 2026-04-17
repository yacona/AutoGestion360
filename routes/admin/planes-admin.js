'use strict';

/**
 * routes/admin/planes-admin.js
 *
 * Panel SuperAdmin — Gestión de planes y suscripciones (sistema nuevo).
 * Montado en: /api/admin
 *
 * Rutas:
 *   GET  /planes                       → catálogo de planes con conteo de módulos
 *   GET  /empresas                     → lista completa con plan activo
 *   GET  /empresas/:id                 → empresa + suscripción + módulos
 *   GET  /resumen                      → KPIs SaaS (MRR, ARR, trial, vencidas)
 *   GET  /proximas-vencer              → suscripciones que vencen en N días
 *   POST /onboarding                   → crear tenant de forma atómica
 *   GET  /suscripcion/:empresaId       → suscripción activa de una empresa
 *   POST /suscripcion/:empresaId       → asignar / cambiar plan
 *   POST /suscripcion/:empresaId/estado→ cambiar estado de suscripción
 *   POST /usuarios/:empresaId          → crear admin inicial para tenant existente
 */

const express = require('express');
const {
  listarEmpresas,
  getEmpresaCompleta,
  onboardEmpresa,
  listarPlanes,
  asignarPlan,
  cambiarEstadoSuscripcion,
  getProximasAVencer,
  getResumenSaas,
  getModulosParaEmpresa,
  crearAdminTenant,
} = require('../../services/adminService');
const db = require('../../db');

const router = express.Router();

// ─── Guard SuperAdmin ────────────────────────────────────────

function normRol(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s_-]+/g, '');
}

router.use((req, res, next) => {
  if (normRol(req.user?.rol) !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado. Solo SuperAdmin.' });
  }
  next();
});

function handleError(res, err, fallback) {
  console.error(fallback, err);
  if (err.code === '23505') return res.status(409).json({ error: 'Dato duplicado.' });
  return res.status(err.statusCode || 500).json({ error: err.message || fallback });
}

// ─── CATÁLOGO DE PLANES ──────────────────────────────────────

router.get('/planes', async (req, res) => {
  try {
    const planes = await listarPlanes();
    res.json(planes);
  } catch (err) {
    handleError(res, err, 'Error listando planes.');
  }
});

// ─── LISTA DE EMPRESAS ───────────────────────────────────────

router.get('/empresas', async (req, res) => {
  try {
    const empresas = await listarEmpresas();
    res.json(empresas);
  } catch (err) {
    handleError(res, err, 'Error listando empresas.');
  }
});

router.get('/empresas/:id', async (req, res) => {
  try {
    const empresaId = Number(req.params.id);
    const [empresa, modulos] = await Promise.all([
      getEmpresaCompleta(empresaId),
      getModulosParaEmpresa(empresaId),
    ]);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada.' });
    res.json({ ...empresa, modulos });
  } catch (err) {
    handleError(res, err, 'Error obteniendo empresa.');
  }
});

// ─── KPIs SaaS ───────────────────────────────────────────────

router.get('/resumen', async (req, res) => {
  try {
    const resumen = await getResumenSaas();
    res.json(resumen);
  } catch (err) {
    handleError(res, err, 'Error obteniendo resumen SaaS.');
  }
});

// ─── PRÓXIMAS A VENCER ───────────────────────────────────────

router.get('/proximas-vencer', async (req, res) => {
  try {
    const dias = Number(req.query.dias) || 30;
    const lista = await getProximasAVencer(dias);
    res.json(lista);
  } catch (err) {
    handleError(res, err, 'Error obteniendo próximas a vencer.');
  }
});

// ─── ONBOARDING ATÓMICO ──────────────────────────────────────
//
// Body:
//   { nombre, nit?, ciudad?, direccion?, telefono?, emailContacto?,
//     zonaHoraria?, planCodigo?,
//     adminNombre?, adminEmail?, adminPassword? }

router.post('/onboarding', async (req, res) => {
  try {
    const result = await onboardEmpresa(req.body);
    res.status(201).json({
      mensaje: 'Empresa creada con éxito.',
      empresa: result.empresa,
      plan:    result.plan,
    });
  } catch (err) {
    handleError(res, err, 'Error en onboarding.');
  }
});

// ─── SUSCRIPCIÓN DE UNA EMPRESA ──────────────────────────────

router.get('/suscripcion/:empresaId', async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId);
    const { rows } = await db.query(`
      SELECT s.*, p.codigo AS plan_codigo, p.nombre AS plan_nombre,
             p.precio_mensual, p.precio_anual, p.max_usuarios,
             p.max_vehiculos, p.max_empleados
      FROM suscripciones s
      JOIN planes p ON p.id = s.plan_id
      WHERE s.empresa_id = $1 AND s.estado IN ('TRIAL','ACTIVA')
      LIMIT 1
    `, [empresaId]);

    if (rows.length === 0) {
      return res.json({ suscripcion: null, mensaje: 'Sin suscripción activa en el nuevo sistema.' });
    }

    res.json(rows[0]);
  } catch (err) {
    handleError(res, err, 'Error obteniendo suscripción.');
  }
});

// POST /suscripcion/:empresaId
// Body: { plan_id, ciclo?, precio_pactado?, moneda?, fecha_fin?, estado?, observaciones?, pasarela? }

router.post('/suscripcion/:empresaId', async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId);
    const { plan_id, ...opts } = req.body;

    if (!plan_id) return res.status(400).json({ error: 'plan_id es requerido.' });

    const suscripcion = await asignarPlan(empresaId, Number(plan_id), {
      ciclo:         opts.ciclo,
      precioPactado: opts.precio_pactado !== undefined ? Number(opts.precio_pactado) : null,
      moneda:        opts.moneda,
      fechaFin:      opts.fecha_fin || null,
      estado:        opts.estado || 'ACTIVA',
      observaciones: opts.observaciones || null,
      pasarela:      opts.pasarela || 'MANUAL',
    });

    res.json({ mensaje: 'Plan asignado.', suscripcion });
  } catch (err) {
    handleError(res, err, 'Error asignando plan.');
  }
});

// POST /suscripcion/:empresaId/estado
// Body: { estado: 'ACTIVA'|'SUSPENDIDA'|'CANCELADA'|'VENCIDA' }

router.post('/suscripcion/:empresaId/estado', async (req, res) => {
  try {
    const empresaId  = Number(req.params.empresaId);
    const { estado } = req.body;

    if (!estado) return res.status(400).json({ error: 'estado es requerido.' });

    const suscripcion = await cambiarEstadoSuscripcion(empresaId, String(estado).toUpperCase());
    res.json({ mensaje: `Suscripción actualizada a ${estado}.`, suscripcion });
  } catch (err) {
    handleError(res, err, 'Error cambiando estado.');
  }
});

// ─── CREAR ADMIN PARA TENANT EXISTENTE ───────────────────────
//
// Body: { nombre, email, password, rol? }

router.post('/usuarios/:empresaId', async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId);
    const usuario   = await crearAdminTenant(empresaId, req.body);
    res.status(201).json({ mensaje: 'Usuario creado.', usuario });
  } catch (err) {
    handleError(res, err, 'Error creando usuario.');
  }
});

module.exports = router;
