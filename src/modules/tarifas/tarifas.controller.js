const service = require('./tarifas.service');
const { crearTarifaSchema, actualizarTarifaSchema } = require('./tarifas.schemas');
const { ValidationError } = require('../../utils/errors');

function parseZod(schema, data, next) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = Array.isArray(result.error?.issues)
      ? result.error.issues
      : Array.isArray(result.error?.errors)
        ? result.error.errors
        : [];
    const message = issues.map((issue) => issue?.message).filter(Boolean).join('; ') || 'Datos inválidos.';
    next(new ValidationError(message));
    return null;
  }
  return result.data;
}

async function getTarifas(req, res, next) {
  try {
    res.json(await service.getTarifas(req.user.empresa_id));
  } catch (err) { next(err); }
}

async function getTarifaPorTipo(req, res, next) {
  try {
    res.json(await service.getTarifaPorTipo(req.user.empresa_id, req.params.tipo_vehiculo));
  } catch (err) { next(err); }
}

async function crearTarifa(req, res, next) {
  try {
    const data = parseZod(crearTarifaSchema, req.body, next);
    if (!data) return;
    res.status(201).json(await service.crearTarifa(req.user.empresa_id, data));
  } catch (err) {
    if (err.code === '23505') return next(new ValidationError('Ya existe tarifa para ese tipo de vehículo.'));
    next(err);
  }
}

async function actualizarTarifa(req, res, next) {
  try {
    const data = parseZod(actualizarTarifaSchema, req.body, next);
    if (!data) return;
    res.json(await service.actualizarTarifa(req.params.id, req.user.empresa_id, data));
  } catch (err) { next(err); }
}

module.exports = { getTarifas, getTarifaPorTipo, crearTarifa, actualizarTarifa };
