'use strict';

const { Router } = require('express');
const ctrl = require('./sedes.controller');
const { requirePermission } = require('../../../middleware/access');

const router = Router();

router.get('/',       requirePermission('sedes:ver'),      ctrl.listar);
router.get('/:id',    requirePermission('sedes:ver'),      ctrl.obtener);
router.post('/',      requirePermission('sedes:crear'),    ctrl.crear);
router.put('/:id',    requirePermission('sedes:editar'),   ctrl.actualizar);
router.patch('/:id/activar',    requirePermission('sedes:editar'),   ctrl.activar);
router.patch('/:id/desactivar', requirePermission('sedes:eliminar'), ctrl.desactivar);

module.exports = router;
