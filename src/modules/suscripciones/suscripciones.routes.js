const express = require('express');
const ctrl = require('./suscripciones.controller');
const validate = require('../../middlewares/validate');
const { adminMutationLimiter } = require('../../lib/security/rate-limit');
const {
  cambiarEstadoBodySchema,
  crearFacturaBodySchema,
  empresaIdParamSchema,
  listFacturasQuerySchema,
  listSuscripcionesQuerySchema,
  renovarSuscripcionBodySchema,
  upsertSuscripcionBodySchema,
} = require('../../lib/validation/suscripciones.schemas');

const router = express.Router();

router.use(ctrl.requireSuperAdmin);

router.get('/resumen',              ctrl.resumen);
router.get('/',                     validate({ query: listSuscripcionesQuerySchema }), ctrl.listar);
router.get('/:empresaId/facturas',  validate({ params: empresaIdParamSchema, query: listFacturasQuerySchema }), ctrl.listarFacturas);
router.post('/:empresaId/facturas', adminMutationLimiter, validate({ params: empresaIdParamSchema, body: crearFacturaBodySchema }), ctrl.crearFactura);
router.get('/:empresaId',           validate({ params: empresaIdParamSchema }), ctrl.obtenerSuscripcion);
router.post('/upsert',              adminMutationLimiter, validate({ body: upsertSuscripcionBodySchema }), ctrl.upsert);
router.post('/:empresaId/renovar',  adminMutationLimiter, validate({ params: empresaIdParamSchema, body: renovarSuscripcionBodySchema }), ctrl.renovar);
router.post('/:empresaId/estado',   adminMutationLimiter, validate({ params: empresaIdParamSchema, body: cambiarEstadoBodySchema }), ctrl.cambiarEstado);

module.exports = router;
