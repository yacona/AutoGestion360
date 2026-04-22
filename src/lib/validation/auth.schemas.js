'use strict';

const {
  z,
  nullableEmailString,
  nullableTrimmedString,
  optionalTrimmedString,
} = require('./common');

const loginBodySchema = z.object({
  email: z.string().trim().email('Debe enviar un correo válido.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
});

const refreshBodySchema = z.object({
  refresh_token: z.string().trim().min(1, 'El refresh token es obligatorio.'),
});

const logoutBodySchema = z.object({
  refresh_token: z.string().trim().min(1, 'El refresh token debe ser válido.').optional(),
}).default({});

const sessionUidParamSchema = z.object({
  sessionUid: z.string().trim().min(16, 'sessionUid inválido.').max(64, 'sessionUid inválido.'),
});

const updateEmpresaBodySchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre de la empresa es obligatorio.'),
  nit: nullableTrimmedString.optional(),
  ciudad: nullableTrimmedString.optional(),
  direccion: nullableTrimmedString.optional(),
  telefono: nullableTrimmedString.optional(),
  email_contacto: nullableEmailString.optional(),
  zona_horaria: optionalTrimmedString,
});

module.exports = {
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
  sessionUidParamSchema,
  updateEmpresaBodySchema,
};
