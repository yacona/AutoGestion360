const express = require('express');
const ctrl = require('./alertas.controller');

const router = express.Router();

router.get('/inteligentes',   ctrl.inteligentes);
router.get('/resumen',        ctrl.resumen);
router.get('/no-leidas',      ctrl.noLeidas);
router.get('/',               ctrl.listar);
router.post('/',              ctrl.crear);
router.patch('/:id/leer',     ctrl.marcarLeida);

module.exports = router;
