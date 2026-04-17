const express = require('express');
const authMiddleware = require('../../../middleware/auth');
const ctrl = require('./auth.controller');

const router = express.Router();

router.get('/setup-demo', ctrl.setupDemo);
router.post('/login', ctrl.login);
router.get('/empresa', authMiddleware, ctrl.getEmpresa);
router.put('/empresa', authMiddleware, ctrl.updateEmpresa);
router.post('/empresa/logo', authMiddleware, ctrl.uploadLogoMiddleware, ctrl.uploadLogo);
router.get('/empresa/licencia', authMiddleware, ctrl.getEmpresaLicencia);
router.get('/empresa/licencia/permisos', authMiddleware, ctrl.getLicenciaPermisos);
router.get('/licencia/permisos', authMiddleware, ctrl.getLicenciaPermisos);

module.exports = router;
