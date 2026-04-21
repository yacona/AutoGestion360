const express = require('express');
const ctrl = require('./empresas.controller');
const validate = require('../../middlewares/validate');
const { userRegistrationLimiter } = require('../../lib/security/rate-limit');
const {
  cambiarEstadoEmpresaBodySchema,
  createEmpresaBodySchema,
  empresaIdParamSchema,
  updateEmpresaBodySchema,
} = require('../../lib/validation/empresas.schemas');

const router = express.Router();

router.use(ctrl.requireSuperAdmin);

router.get('/',              ctrl.listar);
router.get('/:id',           validate({ params: empresaIdParamSchema }), ctrl.obtener);
router.post('/',             userRegistrationLimiter, validate({ body: createEmpresaBodySchema }), ctrl.crear);
router.put('/:id',           validate({ params: empresaIdParamSchema, body: updateEmpresaBodySchema }), ctrl.actualizar);
router.patch('/:id/estado',  validate({ params: empresaIdParamSchema, body: cambiarEstadoEmpresaBodySchema }), ctrl.cambiarEstado);

module.exports = router;
