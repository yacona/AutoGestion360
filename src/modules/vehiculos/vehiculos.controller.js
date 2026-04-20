const service = require('./vehiculos.service');
const { normalizarPlaca } = require('../../lib/helpers');

async function crear(req, res, next) {
  try {
    const vehiculo = await service.crear(req.user.empresa_id, req.body);
    res.json(vehiculo);
  } catch (err) {
    if (err.isOperational && err.vehiculo_existente) {
      return res.status(err.statusCode).json({
        error: err.message,
        vehiculo_existente: err.vehiculo_existente,
      });
    }
    next(err);
  }
}

async function buscarPorPlaca(req, res, next) {
  try {
    const placa = normalizarPlaca(req.params.placa);
    const vehiculo = await service.buscarPorPlaca(req.user.empresa_id, placa);
    if (!vehiculo) return res.json({ existe: false });
    res.json({ existe: true, vehiculo });
  } catch (err) { next(err); }
}

async function perfil360(req, res, next) {
  try {
    const data = await service.perfil360(req.user.empresa_id, req.params.placa);
    res.json(data);
  } catch (err) { next(err); }
}

module.exports = { crear, buscarPorPlaca, perfil360 };
