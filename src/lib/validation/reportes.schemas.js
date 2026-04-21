'use strict';

const {
  optionalDateString,
  optionalPositiveIntFromUnknown,
  optionalTrimmedString,
  positiveIntFromUnknown,
  z,
} = require('./common');

const rangoFechasQuerySchema = z.object({
  desde: optionalDateString,
  hasta: optionalDateString,
});

const arqueosListQuerySchema = z.object({
  limit: optionalPositiveIntFromUnknown,
});

const arqueoIdParamSchema = z.object({
  id: positiveIntFromUnknown,
});

const crearArqueoBodySchema = z.object({
  desde: z.string().trim().min(1, 'La fecha desde es obligatoria.').refine(
    (value) => !Number.isNaN(Date.parse(value)),
    'Debe enviar una fecha desde válida.'
  ),
  hasta: z.string().trim().min(1, 'La fecha hasta es obligatoria.').refine(
    (value) => !Number.isNaN(Date.parse(value)),
    'Debe enviar una fecha hasta válida.'
  ),
  fecha_caja: optionalDateString,
  efectivo_contado: z.coerce.number().min(0, 'El efectivo contado debe ser cero o mayor.'),
  observaciones: optionalTrimmedString,
});

module.exports = {
  arqueoIdParamSchema,
  arqueosListQuerySchema,
  crearArqueoBodySchema,
  rangoFechasQuerySchema,
};
