const express = require('express');
const ctrl = require('./usuarios.controller');
const validate = require('../../middlewares/validate');
const { userRegistrationLimiter } = require('../../lib/security/rate-limit');
const {
  cambiarEstadoUsuarioBodySchema,
  cambiarPasswordUsuarioBodySchema,
  createUsuarioBodySchema,
  listUsuariosQuerySchema,
  updateUsuarioBodySchema,
  userIdParamSchema,
} = require('../../lib/validation/usuarios.schemas');

const router = express.Router();

router.get('/',                  validate({ query: listUsuariosQuerySchema }), ctrl.listar);
router.post('/',                 userRegistrationLimiter, validate({ body: createUsuarioBodySchema }), ctrl.crear);
router.put('/:id',               validate({ params: userIdParamSchema, body: updateUsuarioBodySchema }), ctrl.actualizar);
router.patch('/:id/estado',      validate({ params: userIdParamSchema, body: cambiarEstadoUsuarioBodySchema }), ctrl.cambiarEstado);
router.patch('/:id/password',    userRegistrationLimiter, validate({ params: userIdParamSchema, body: cambiarPasswordUsuarioBodySchema }), ctrl.cambiarPassword);

module.exports = router;
