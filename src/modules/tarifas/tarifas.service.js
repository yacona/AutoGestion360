const repo = require('./tarifas.repository');
const { NotFoundError, ValidationError } = require('../../utils/errors');

async function getTarifas(empresaId) {
  return repo.findAllByEmpresa(empresaId);
}

async function getTarifaPorTipo(empresaId, tipoVehiculo) {
  const tarifa = await repo.findByTipoVehiculo(empresaId, tipoVehiculo.toUpperCase());
  if (!tarifa) throw new NotFoundError('Tarifa no encontrada.');
  return tarifa;
}

async function crearTarifa(empresaId, data) {
  return repo.create(empresaId, { ...data, tipo_vehiculo: data.tipo_vehiculo.toUpperCase() });
}

async function actualizarTarifa(id, empresaId, data) {
  const tarifa = await repo.update(id, empresaId, data);
  if (!tarifa) throw new NotFoundError('Tarifa no encontrada.');
  return tarifa;
}

module.exports = { getTarifas, getTarifaPorTipo, crearTarifa, actualizarTarifa };
