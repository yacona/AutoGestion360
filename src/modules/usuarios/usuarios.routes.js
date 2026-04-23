const express = require('express');
const ctrl = require('./usuarios.controller');
const validate = require('../../middlewares/validate');
const { userRegistrationLimiter } = require('../../lib/security/rate-limit');
const { requirePermission } = require('../../../middleware/access');
const {
  cambiarEstadoUsuarioBodySchema,
  cambiarPasswordUsuarioBodySchema,
  createUsuarioBodySchema,
  listUsuariosQuerySchema,
  updateUsuarioBodySchema,
  userIdParamSchema,
} = require('../../lib/validation/usuarios.schemas');

const router = express.Router();

router.get('/',                  requirePermission('usuarios:ver'), validate({ query: listUsuariosQuerySchema }), ctrl.listar);
router.post('/',                 requirePermission('usuarios:crear'), userRegistrationLimiter, validate({ body: createUsuarioBodySchema }), ctrl.crear);
router.put('/:id',               requirePermission('usuarios:editar'), validate({ params: userIdParamSchema, body: updateUsuarioBodySchema }), ctrl.actualizar);
router.patch('/:id/estado',      requirePermission('usuarios:editar'), validate({ params: userIdParamSchema, body: cambiarEstadoUsuarioBodySchema }), ctrl.cambiarEstado);
router.patch('/:id/password',    requirePermission('usuarios:editar'), userRegistrationLimiter, validate({ params: userIdParamSchema, body: cambiarPasswordUsuarioBodySchema }), ctrl.cambiarPassword);

module.exports = router;
