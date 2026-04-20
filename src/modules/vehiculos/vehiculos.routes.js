const express = require('express');
const ctrl = require('./vehiculos.controller');

const router = express.Router();

// Orden importa: /perfil/:placa antes de /:placa
router.get('/perfil/:placa', ctrl.perfil360);
router.post('/',             ctrl.crear);
router.get('/:placa',        ctrl.buscarPorPlaca);

module.exports = router;
