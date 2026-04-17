const express = require('express');
const ctrl = require('./tarifas.controller');

const router = express.Router();

router.get('/', ctrl.getTarifas);
router.get('/tipo/:tipo_vehiculo', ctrl.getTarifaPorTipo);
router.post('/', ctrl.crearTarifa);
router.patch('/:id', ctrl.actualizarTarifa);

module.exports = router;
