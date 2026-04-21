const express = require('express');
const authMiddleware = require('../../../middleware/auth');
const ctrl = require('./auth.controller');
const validate = require('../../middlewares/validate');
const { loginLimiter, setupDemoLimiter } = require('../../lib/security/rate-limit');
const { loginBodySchema, updateEmpresaBodySchema } = require('../../lib/validation/auth.schemas');

const router = express.Router();

router.get('/setup-demo', setupDemoLimiter, ctrl.setupDemo);
router.post('/login', loginLimiter, validate({ body: loginBodySchema }), ctrl.login);
router.get('/empresa', authMiddleware, ctrl.getEmpresa);
router.put('/empresa', authMiddleware, validate({ body: updateEmpresaBodySchema }), ctrl.updateEmpresa);
router.post('/empresa/logo', authMiddleware, ctrl.uploadLogoMiddleware, ctrl.uploadLogo);
router.get('/empresa/licencia', authMiddleware, ctrl.getEmpresaLicencia);
router.get('/empresa/licencia/permisos', authMiddleware, ctrl.getLicenciaPermisos);
router.get('/licencia/permisos', authMiddleware, ctrl.getLicenciaPermisos);

module.exports = router;
