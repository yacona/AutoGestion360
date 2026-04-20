const express = require('express');
const ctrl = require('./empresas.controller');

const router = express.Router();

router.use(ctrl.requireSuperAdmin);

router.get('/',              ctrl.listar);
router.get('/:id',           ctrl.obtener);
router.post('/',             ctrl.crear);
router.put('/:id',           ctrl.actualizar);
router.patch('/:id/estado',  ctrl.cambiarEstado);

module.exports = router;
