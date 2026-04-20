const express = require('express');
const ctrl = require('./lavadero.controller');

const router = express.Router();

// Tipos de lavado
router.post('/tipos',        ctrl.crearTipo);
router.get('/tipos',         ctrl.listarTipos);
router.put('/tipos/:id',     ctrl.actualizarTipo);

// Historial (antes de /:id para que Express no lo capture)
router.get('/historial',     ctrl.historial);

// Órdenes
router.post('/',             ctrl.crear);
router.get('/',              ctrl.listar);
router.get('/:id',           ctrl.obtener);
router.patch('/:id',         ctrl.actualizar);
router.patch('/:id/estado',  ctrl.actualizarEstado);
router.post('/:id/pago',     ctrl.registrarPago);
router.patch('/:id/lavador', ctrl.asignarLavador);

module.exports = router;
