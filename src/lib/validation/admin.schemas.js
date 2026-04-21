'use strict';

const {
  z,
  booleanFromUnknown,
  nullableDateString,
  nullableEmailString,
  nullableTrimmedString,
  optionalBooleanFromUnknown,
  optionalNullableNumberFromUnknown,
  optionalPositiveIntFromUnknown,
  optionalTrimmedString,
  positiveIntFromUnknown,
} = require('./common');

const empresaIdParamSchema = z.object({
  empresaId: positiveIntFromUnknown,
});

const idParamSchema = z.object({
  id: positiveIntFromUnknown,
});

const moduloIdParamSchema = z.object({
  empresaId: positiveIntFromUnknown,
  moduloId: positiveIntFromUnknown,
});

const estadoSuscripcionSchema = z.enum(['TRIAL', 'ACTIVA', 'SUSPENDIDA', 'CANCELADA', 'VENCIDA']);
const cicloSchema = z.enum(['MENSUAL', 'ANUAL']);

const onboardingBodySchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
  nit: nullableTrimmedString.optional(),
  ciudad: nullableTrimmedString.optional(),
  direccion: nullableTrimmedString.optional(),
  telefono: nullableTrimmedString.optional(),
  emailContacto: nullableEmailString.optional(),
  zonaHoraria: optionalTrimmedString,
  planCodigo: optionalTrimmedString,
  adminNombre: nullableTrimmedString.optional(),
  adminEmail: nullableEmailString.optional(),
  adminPassword: z.string().min(6, 'La contraseña del administrador debe tener al menos 6 caracteres.').optional(),
}).superRefine((data, ctx) => {
  if (data.adminEmail && !data.adminPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['adminPassword'],
      message: 'La contraseña es obligatoria cuando se envía adminEmail.',
    });
  }
});

const assignPlanBodySchema = z.object({
  plan_id: positiveIntFromUnknown,
  ciclo: cicloSchema.optional(),
  precio_pactado: optionalNullableNumberFromUnknown,
  moneda: optionalTrimmedString,
  fecha_fin: nullableDateString.optional(),
  estado: estadoSuscripcionSchema.optional(),
  observaciones: nullableTrimmedString.optional(),
  pasarela: optionalTrimmedString,
});

const changeSubscriptionStateBodySchema = z.object({
  estado: estadoSuscripcionSchema,
});

const createAdminTenantBodySchema = z.object({
  nombre: nullableTrimmedString.optional(),
  email: z.string().trim().email('Debe enviar un correo válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  rol: optionalTrimmedString,
});

const moduloOverrideBodySchema = z.object({
  activo: optionalBooleanFromUnknown,
  limite_override: optionalNullableNumberFromUnknown,
  notas: nullableTrimmedString.optional(),
});

const moduloOverrideBulkBodySchema = z.object({
  overrides: z.array(z.object({
    modulo_id: positiveIntFromUnknown,
    activo: optionalBooleanFromUnknown,
    limite_override: optionalNullableNumberFromUnknown,
    notas: nullableTrimmedString.optional(),
    eliminar: optionalBooleanFromUnknown,
  })).min(1, 'Debe enviar al menos un override.'),
});

const moduloPlanSchema = z.object({
  modulo_id: positiveIntFromUnknown,
  limite_registros: optionalNullableNumberFromUnknown,
  activo: optionalBooleanFromUnknown,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const createPlanBodySchema = z.object({
  codigo: z.string().trim().min(1, 'El código es obligatorio.').max(30),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  descripcion: nullableTrimmedString.optional(),
  precio_mensual: z.coerce.number().nonnegative('El precio mensual debe ser mayor o igual a 0.'),
  precio_anual: optionalNullableNumberFromUnknown,
  moneda: optionalTrimmedString,
  trial_dias: optionalPositiveIntFromUnknown,
  max_usuarios: optionalNullableNumberFromUnknown,
  max_vehiculos: optionalNullableNumberFromUnknown,
  max_empleados: optionalNullableNumberFromUnknown,
  es_publico: optionalBooleanFromUnknown,
  activo: optionalBooleanFromUnknown,
  orden: optionalNullableNumberFromUnknown,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  modulos: z.array(moduloPlanSchema).optional(),
});

const updatePlanBodySchema = createPlanBodySchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Debe enviar al menos un campo para actualizar.' }
);

const proximasVencerQuerySchema = z.object({
  dias: optionalPositiveIntFromUnknown,
});

const reactivarBodySchema = z.object({
  fecha_fin:     nullableDateString.optional(),
  observaciones: nullableTrimmedString.optional(),
});

const setPlanModulosBodySchema = z.object({
  modulos: z.array(moduloPlanSchema).min(0, 'modulos debe ser un array (puede estar vacío para limpiar todos).'),
});

module.exports = {
  assignPlanBodySchema,
  changeSubscriptionStateBodySchema,
  createAdminTenantBodySchema,
  createPlanBodySchema,
  empresaIdParamSchema,
  idParamSchema,
  moduloIdParamSchema,
  moduloOverrideBodySchema,
  moduloOverrideBulkBodySchema,
  onboardingBodySchema,
  proximasVencerQuerySchema,
  reactivarBodySchema,
  setPlanModulosBodySchema,
  updatePlanBodySchema,
};
