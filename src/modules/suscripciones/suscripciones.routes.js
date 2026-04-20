const express = require('express');
const ctrl = require('./suscripciones.controller');

const router = express.Router();

router.use(ctrl.requireSuperAdmin);

router.get('/resumen',              ctrl.resumen);
router.get('/',                     ctrl.listar);
router.get('/:empresaId/facturas',  ctrl.listarFacturas);
router.post('/:empresaId/facturas', ctrl.crearFactura);
router.get('/:empresaId',           ctrl.obtenerSuscripcion);
router.post('/upsert',              ctrl.upsert);
router.post('/:empresaId/renovar',  ctrl.renovar);
router.post('/:empresaId/estado',   ctrl.cambiarEstado);

module.exports = router;
