const express = require('express');
const ctrl = require('./usuarios.controller');

const router = express.Router();

router.get('/',                  ctrl.listar);
router.post('/',                 ctrl.crear);
router.put('/:id',               ctrl.actualizar);
router.patch('/:id/estado',      ctrl.cambiarEstado);
router.patch('/:id/password',    ctrl.cambiarPassword);

module.exports = router;
