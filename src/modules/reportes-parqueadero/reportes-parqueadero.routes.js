const express = require('express');
const ctrl = require('./reportes-parqueadero.controller');

const router = express.Router();

router.get('/resumen-dia',          ctrl.getResumenDia);
router.get('/resumen-periodo',      ctrl.getResumenPeriodo);
router.get('/clientes-frecuentes',  ctrl.getClientesFrecuentes);
router.get('/estado-pago',          ctrl.getEstadoPago);
router.get('/ocupancia',            ctrl.getOcupancia);

module.exports = router;
