const express = require('express');
const ctrl = require('./clientes.controller');

const router = express.Router();

router.get('/',       ctrl.listar);
router.post('/',      ctrl.crear);
router.get('/:id',    ctrl.obtener);
router.patch('/:id',  ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);

module.exports = router;
