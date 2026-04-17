const express = require('express');
const ctrl = require('./parqueadero.controller');

const router = express.Router();

// Específicas primero para evitar colisiones con /:id
router.get('/activo',                         ctrl.getActivos);
router.get('/historial',                      ctrl.getHistorial);
router.get('/mensualidades',                  ctrl.getMensualidades);
router.post('/mensualidades',                 ctrl.crearMensualidad);
router.get('/mensualidades/:id/historial',    ctrl.getHistorialMensualidad);
router.get('/pre-carga/:placa',               ctrl.preCarga);
router.get('/buscar/:placa',                  ctrl.buscarPorPlaca);

router.post('/entrada', ctrl.uploadEvidencia, ctrl.registrarEntrada);
router.post('/salida/:id',                    ctrl.registrarSalida);
router.post('/:id/pre-salida',               ctrl.preSalida);

router.get('/:id',   ctrl.getById);
router.patch('/:id', ctrl.editarEntrada);

module.exports = router;
