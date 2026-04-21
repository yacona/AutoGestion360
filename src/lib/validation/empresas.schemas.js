'use strict';

const {
  z,
  booleanFromUnknown,
  nullableDateString,
  nullableEmailString,
  nullableTrimmedString,
  optionalBooleanFromUnknown,
  optionalTrimmedString,
  positiveIntFromUnknown,
} = require('./common');

const empresaIdParamSchema = z.object({
  id: positiveIntFromUnknown,
});

const empresaBodyBaseSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre de la empresa es obligatorio.'),
  nit: nullableTrimmedString.optional(),
  ciudad: nullableTrimmedString.optional(),
  direccion: nullableTrimmedString.optional(),
  telefono: nullableTrimmedString.optional(),
  email_contacto: nullableEmailString.optional(),
  zona_horaria: optionalTrimmedString,
  licencia_tipo: optionalTrimmedString,
  licencia_fin: nullableDateString.optional(),
  activa: optionalBooleanFromUnknown,
  admin_nombre: nullableTrimmedString.optional(),
  admin_email: nullableEmailString.optional(),
  admin_password: z.string().min(6, 'La contraseña del administrador debe tener al menos 6 caracteres.').optional(),
});

const createEmpresaBodySchema = empresaBodyBaseSchema.superRefine((data, ctx) => {
  if (data.admin_email && !data.admin_password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['admin_password'],
      message: 'La contraseña es obligatoria cuando se envía admin_email.',
    });
  }
});

const updateEmpresaBodySchema = empresaBodyBaseSchema.partial().extend({
  nombre: z.string().trim().min(1, 'El nombre de la empresa es obligatorio.'),
});

const cambiarEstadoEmpresaBodySchema = z.object({
  activa: booleanFromUnknown,
});

module.exports = {
  cambiarEstadoEmpresaBodySchema,
  createEmpresaBodySchema,
  empresaIdParamSchema,
  updateEmpresaBodySchema,
};
