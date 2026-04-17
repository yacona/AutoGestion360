const { z } = require('zod');

const crearTarifaSchema = z.object({
  tipo_vehiculo: z.string().min(1, 'Tipo de vehículo es obligatorio'),
  tarifa_por_hora: z.number({ invalid_type_error: 'Tarifa por hora debe ser un número' }).positive('Tarifa por hora debe ser positiva'),
  tarifa_minima: z.number().nonnegative().optional().nullable(),
  descuento_prolongada_horas: z.number().int().positive().optional().nullable(),
  descuento_prolongada_porcentaje: z.number().min(0).max(100).optional().nullable(),
});

const actualizarTarifaSchema = z.object({
  tarifa_por_hora: z.number().positive().optional(),
  tarifa_minima: z.number().nonnegative().optional().nullable(),
  descuento_prolongada_horas: z.number().int().positive().optional().nullable(),
  descuento_prolongada_porcentaje: z.number().min(0).max(100).optional().nullable(),
  activo: z.boolean().optional(),
});

module.exports = { crearTarifaSchema, actualizarTarifaSchema };
