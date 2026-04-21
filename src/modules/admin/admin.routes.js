'use strict';

/**
 * admin.routes.js — Panel SuperAdmin
 *
 * Montado en: /api/admin
 *
 * Catálogo de planes
 *   GET    /planes                              → lista planes con conteo de módulos
 *   POST   /planes                              → crear plan
 *   GET    /planes/:id                          → detalle de plan con módulos
 *   PUT    /planes/:id                          → actualizar plan (y módulos si se envían)
 *   GET    /planes/:id/modulos                  → módulos de un plan
 *   PUT    /planes/:id/modulos                  → reemplazar módulos de un plan
 *
 * Catálogo de módulos
 *   GET    /modulos                             → todos los módulos disponibles
 *
 * Panel de empresas
 *   GET    /empresas                            → lista con plan activo y métricas
 *   GET    /empresas/:id                        → detalle con suscripción y módulos
 *
 * KPIs
 *   GET    /resumen                             → MRR, ARR, trial, vencidas
 *   GET    /proximas-vencer                     → vencen en N días (default 30)
 *
 * Onboarding
 *   POST   /onboarding                          → crear tenant atómicamente
 *
 * Suscripciones por empresa
 *   GET    /suscripcion/:empresaId              → suscripción activa
 *   POST   /suscripcion/:empresaId              → asignar / cambiar plan
 *   POST   /suscripcion/:empresaId/upgrade      → upgrade de plan
 *   POST   /suscripcion/:empresaId/downgrade    → downgrade de plan
 *   POST   /suscripcion/:empresaId/reactivar    → reactivar suspendida/vencida
 *   POST   /suscripcion/:empresaId/estado       → cambiar estado manualmente
 *
 * Límites efectivos por empresa
 *   GET    /limites/:empresaId                  → plan + overrides consolidados
 *
 * Overrides de módulos por empresa
 *   GET    /empresa-modulos/:empresaId          → todos los módulos con estado override
 *   PUT    /empresa-modulos/:empresaId/bulk     → sobreescritura masiva de overrides
 *   PUT    /empresa-modulos/:empresaId/:moduloId → crear/actualizar override individual
 *   DELETE /empresa-modulos/:empresaId/:moduloId → eliminar override
 *
 * Usuarios de tenant
 *   POST   /usuarios/:empresaId                 → crear admin inicial para tenant
 */

const express  = require('express');
const ctrl     = require('./admin.controller');
const validate = require('../../middlewares/validate');
const {
  adminMutationLimiter,
  userRegistrationLimiter,
} = require('../../lib/security/rate-limit');
const {
  assignPlanBodySchema,
  changeSubscriptionStateBodySchema,
  createAdminTenantBodySchema,
  createPlanBodySchema,
  empresaIdParamSchema,
  idParamSchema,
  moduloIdParamSchema,
  moduloOverrideBodySchema,
  moduloOverrideBulkBodySchema,
  onboardingBodySchema,
  proximasVencerQuerySchema,
  reactivarBodySchema,
  setPlanModulosBodySchema,
  updatePlanBodySchema,
} = require('../../lib/validation/admin.schemas');

const router = express.Router();

// SuperAdmin guard — se aplica a TODAS las rutas de este router
router.use(ctrl.requireSuperAdmin);

// ─── MÓDULOS GLOBALES ─────────────────────────────────────────
router.get('/modulos', ctrl.listarModulos);

// ─── CATÁLOGO DE PLANES ───────────────────────────────────────
router.get('/planes',
  ctrl.listarPlanes);

router.post('/planes',
  adminMutationLimiter,
  validate({ body: createPlanBodySchema }),
  ctrl.crearPlan);

// IMPORTANTE: /planes/:id/modulos ANTES de /planes/:id para que Express
// no interprete "modulos" como valor del parámetro :id
router.get('/planes/:id/modulos',
  validate({ params: idParamSchema }),
  ctrl.getModulosPlan);

router.put('/planes/:id/modulos',
  adminMutationLimiter,
  validate({ params: idParamSchema, body: setPlanModulosBodySchema }),
  ctrl.setModulosPlan);

router.get('/planes/:id',
  validate({ params: idParamSchema }),
  ctrl.getPlan);

router.put('/planes/:id',
  adminMutationLimiter,
  validate({ params: idParamSchema, body: updatePlanBodySchema }),
  ctrl.actualizarPlan);

// ─── EMPRESAS ─────────────────────────────────────────────────
router.get('/empresas',
  ctrl.listarEmpresas);

router.get('/empresas/:id',
  validate({ params: idParamSchema }),
  ctrl.getEmpresa);

// ─── KPIs SaaS ────────────────────────────────────────────────
router.get('/resumen',
  ctrl.getResumen);

router.get('/proximas-vencer',
  validate({ query: proximasVencerQuerySchema }),
  ctrl.getProximasVencer);

// ─── ONBOARDING ───────────────────────────────────────────────
router.post('/onboarding',
  userRegistrationLimiter,
  adminMutationLimiter,
  validate({ body: onboardingBodySchema }),
  ctrl.onboarding);

// ─── SUSCRIPCIONES ────────────────────────────────────────────

// Rutas específicas ANTES del handler genérico :empresaId
// para que Express no confunda 'upgrade', 'downgrade', etc. con un ID

router.get('/suscripcion/:empresaId',
  validate({ params: empresaIdParamSchema }),
  ctrl.getSuscripcion);

// Upgrade / downgrade — semántica diferenciada
router.post('/suscripcion/:empresaId/upgrade',
  adminMutationLimiter,
  validate({ params: empresaIdParamSchema, body: assignPlanBodySchema }),
  ctrl.upgradePlan);

router.post('/suscripcion/:empresaId/downgrade',
  adminMutationLimiter,
  validate({ params: empresaIdParamSchema, body: assignPlanBodySchema }),
  ctrl.downgradePlan);

router.post('/suscripcion/:empresaId/reactivar',
  adminMutationLimiter,
  validate({ params: empresaIdParamSchema, body: reactivarBodySchema }),
  ctrl.reactivarSuscripcion);

router.post('/suscripcion/:empresaId/estado',
  adminMutationLimiter,
  validate({ params: empresaIdParamSchema, body: changeSubscriptionStateBodySchema }),
  ctrl.cambiarEstadoSuscripcion);

// Asignación/cambio de plan (genérico)
router.post('/suscripcion/:empresaId',
  adminMutationLimiter,
  validate({ params: empresaIdParamSchema, body: assignPlanBodySchema }),
  ctrl.asignarPlan);

// ─── LÍMITES EFECTIVOS ────────────────────────────────────────
router.get('/limites/:empresaId',
  validate({ params: empresaIdParamSchema }),
  ctrl.getLimites);

// ─── EMPRESA_MODULOS (overrides) ──────────────────────────────

// /bulk ANTES de /:moduloId para evitar ambigüedad de parámetros
router.put('/empresa-modulos/:empresaId/bulk',
  adminMutationLimiter,
  validate({ params: empresaIdParamSchema, body: moduloOverrideBulkBodySchema }),
  ctrl.bulkOverrides);

router.get('/empresa-modulos/:empresaId',
  validate({ params: empresaIdParamSchema }),
  ctrl.getEmpresaModulos);

router.put('/empresa-modulos/:empresaId/:moduloId',
  adminMutationLimiter,
  validate({ params: moduloIdParamSchema, body: moduloOverrideBodySchema }),
  ctrl.upsertOverride);

router.delete('/empresa-modulos/:empresaId/:moduloId',
  adminMutationLimiter,
  validate({ params: moduloIdParamSchema }),
  ctrl.deleteOverride);

// ─── USUARIOS DE TENANT ───────────────────────────────────────
router.post('/usuarios/:empresaId',
  userRegistrationLimiter,
  adminMutationLimiter,
  validate({ params: empresaIdParamSchema, body: createAdminTenantBodySchema }),
  ctrl.crearAdminTenant);

module.exports = router;
