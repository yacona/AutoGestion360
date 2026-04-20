const express = require('express');
const ctrl = require('./empleados.controller');

const router = express.Router();

router.get('/',              ctrl.listar);
router.post('/',             ctrl.crear);
router.get('/:id',           ctrl.obtener);
router.put('/:id',           ctrl.actualizar);
router.patch('/:id/estado',  ctrl.cambiarEstado);
router.delete('/:id',        ctrl.desactivar);

module.exports = router;
