'use strict';

const {
  z,
  nullableDateString,
  nullableTrimmedString,
  optionalBooleanFromUnknown,
  optionalNullableNumberFromUnknown,
  optionalPositiveIntFromUnknown,
  optionalTrimmedString,
  positiveIntFromUnknown,
} = require('./common');

const estadosFacturaSchema = z.enum(['PENDIENTE', 'PAGADA', 'VENCIDA', 'ANULADA']);
const estadosSuscripcionSchema = z.enum(['TRIAL', 'ACTIVA', 'VENCIDA', 'SUSPENDIDA', 'CANCELADA']);

const empresaIdParamSchema = z.object({
  empresaId: positiveIntFromUnknown,
});

const listSuscripcionesQuerySchema = z.object({
  estado: optionalTrimmedString,
  empresa_id: optionalPositiveIntFromUnknown,
});

const listFacturasQuerySchema = z.object({
  limit: optionalPositiveIntFromUnknown,
});

const upsertSuscripcionBodySchema = z.object({
  empresa_id: positiveIntFromUnknown,
  licencia_id: positiveIntFromUnknown,
  estado: estadosSuscripcionSchema.optional(),
  fecha_inicio: nullableDateString.optional(),
  fecha_fin: nullableDateString.optional(),
  renovacion_automatica: optionalBooleanFromUnknown,
  pasarela: optionalTrimmedString,
  referencia_externa: nullableTrimmedString.optional(),
  observaciones: nullableTrimmedString.optional(),
  moneda: optionalTrimmedString,
  precio_plan: optionalNullableNumberFromUnknown,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const cambiarEstadoBodySchema = z.object({
  estado: estadosSuscripcionSchema,
  fecha_fin: nullableDateString.optional(),
  observaciones: nullableTrimmedString.optional(),
});

const renovarSuscripcionBodySchema = z.object({
  dias: optionalPositiveIntFromUnknown,
  licencia_id: optionalPositiveIntFromUnknown,
  renovacion_automatica: optionalBooleanFromUnknown,
  pasarela: optionalTrimmedString,
  referencia_externa: nullableTrimmedString.optional(),
  observaciones: nullableTrimmedString.optional(),
  moneda: optionalTrimmedString,
  precio_plan: optionalNullableNumberFromUnknown,
  generar_factura: optionalBooleanFromUnknown,
  concepto: nullableTrimmedString.optional(),
  total: optionalNullableNumberFromUnknown,
  impuestos: optionalNullableNumberFromUnknown,
  estado_factura: estadosFacturaSchema.optional(),
  fecha_vencimiento: nullableDateString.optional(),
  fecha_pago: nullableDateString.optional(),
  metodo_pago: optionalTrimmedString,
  referencia_pago: nullableTrimmedString.optional(),
});

const crearFacturaBodySchema = z.object({
  licencia_id: optionalPositiveIntFromUnknown,
  numero_factura: nullableTrimmedString.optional(),
  concepto: optionalTrimmedString,
  periodo_inicio: nullableDateString.optional(),
  periodo_fin: nullableDateString.optional(),
  subtotal: optionalNullableNumberFromUnknown,
  impuestos: optionalNullableNumberFromUnknown,
  total: optionalNullableNumberFromUnknown,
  moneda: optionalTrimmedString,
  estado: estadosFacturaSchema.optional(),
  fecha_emision: nullableDateString.optional(),
  fecha_vencimiento: nullableDateString.optional(),
  fecha_pago: nullableDateString.optional(),
  metodo_pago: optionalTrimmedString,
  referencia_pago: nullableTrimmedString.optional(),
  pasarela: optionalTrimmedString,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

module.exports = {
  cambiarEstadoBodySchema,
  crearFacturaBodySchema,
  empresaIdParamSchema,
  listFacturasQuerySchema,
  listSuscripcionesQuerySchema,
  renovarSuscripcionBodySchema,
  upsertSuscripcionBodySchema,
};
