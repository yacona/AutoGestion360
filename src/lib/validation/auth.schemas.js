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
  updateEmpresaBodySchema,
};
