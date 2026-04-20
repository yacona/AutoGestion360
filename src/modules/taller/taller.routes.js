const express = require('express');
const ctrl = require('./taller.controller');

const router = express.Router();

// Historial con filtros (antes de /:id)
router.get('/historial/filter', ctrl.historial);

// CRUD órdenes
router.post('/',             ctrl.crear);
router.get('/',              ctrl.listar);
router.get('/:id',           ctrl.obtener);
router.patch('/:id',         ctrl.actualizar);
router.patch('/:id/estado',  ctrl.cambiarEstado);
router.post('/:id/pago',     ctrl.registrarPago);

// Ítems
router.post('/:id/items',        ctrl.agregarItem);
router.delete('/items/:itemId',  ctrl.eliminarItem);

module.exports = router;
