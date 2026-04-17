const { z } = require('zod');

const booleanFromString = z.union([
  z.boolean(),
  z.string().transform((v) => v === 'true'),
]);

const entradaSchema = z.object({
  placa: z.string().min(1, 'La placa es obligatoria'),
  tipo_vehiculo: z.string().min(1, 'El tipo de vehículo es obligatorio'),
  es_conductor_propietario: booleanFromString.default(true),
  propietario_nombre: z.string().default(''),
  propietario_documento: z.string().default(''),
  propietario_telefono: z.string().default(''),
  propietario_correo: z.string().default(''),
  conductor_nombre: z.string().default(''),
  conductor_documento: z.string().default(''),
  conductor_telefono: z.string().default(''),
  tipo_servicio: z.string().optional(),
  mensualidad_id: z.coerce.number().int().positive().optional().nullable(),
  observaciones: z.string().default(''),
});

const salidaSchema = z.object({
  metodo_pago: z.string().optional(),
  detalle_pago: z.string().default(''),
  observaciones: z.string().default(''),
  referencia_transaccion: z.string().default(''),
  monto_pago: z.coerce.number().optional().nullable(),
});

const mensualidadSchema = z.object({
  nombre_cliente: z.string().min(1, 'Nombre es obligatorio'),
  documento: z.string().min(1, 'Documento es obligatorio'),
  telefono: z.string().default(''),
  correo: z.string().default(''),
  direccion: z.string().default(''),
  contacto_emergencia: z.string().default(''),
  placa: z.string().min(1, 'La placa es obligatoria'),
  tipo_vehiculo: z.string().min(1, 'El tipo de vehículo es obligatorio'),
  marca: z.string().default(''),
  modelo: z.string().default(''),
  color: z.string().default(''),
  fecha_inicio: z.string().min(1, 'Fecha inicio es obligatoria'),
  fecha_fin: z.string().min(1, 'Fecha fin es obligatoria'),
  valor_mensual: z.coerce.number().nonnegative().default(0),
  observaciones: z.string().default(''),
});

module.exports = { entradaSchema, salidaSchema, mensualidadSchema };
