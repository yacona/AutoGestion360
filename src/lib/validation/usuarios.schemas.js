'use strict';

const {
  z,
  booleanFromUnknown,
  optionalBooleanFromUnknown,
  optionalPositiveIntFromUnknown,
  optionalTrimmedString,
  positiveIntFromUnknown,
} = require('./common');

const userIdParamSchema = z.object({
  id: positiveIntFromUnknown,
});

const listUsuariosQuerySchema = z.object({
  empresa_id: z.union([z.literal('all'), optionalPositiveIntFromUnknown]).optional(),
  rol: optionalTrimmedString,
  scope: z.enum(['platform', 'tenant']).optional(),
  activos: optionalBooleanFromUnknown,
});

const createUsuarioBodySchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
  email: z.string().trim().email('Debe enviar un correo válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  rol: optionalTrimmedString,
  rol_codigo: optionalTrimmedString,
  roles: z.array(z.string().trim().min(1)).min(1).optional(),
  scope: z.enum(['platform', 'tenant']).optional(),
  empresa_id: optionalPositiveIntFromUnknown,
  activo: optionalBooleanFromUnknown,
});

const updateUsuarioBodySchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
  email: z.string().trim().email('Debe enviar un correo válido.'),
  rol: optionalTrimmedString,
  rol_codigo: optionalTrimmedString,
  roles: z.array(z.string().trim().min(1)).min(1).optional(),
  scope: z.enum(['platform', 'tenant']).optional(),
  activo: optionalBooleanFromUnknown,
});

const cambiarEstadoUsuarioBodySchema = z.object({
  activo: booleanFromUnknown,
});

const cambiarPasswordUsuarioBodySchema = z.object({
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

module.exports = {
  cambiarEstadoUsuarioBodySchema,
  cambiarPasswordUsuarioBodySchema,
  createUsuarioBodySchema,
  listUsuariosQuerySchema,
  updateUsuarioBodySchema,
  userIdParamSchema,
};
