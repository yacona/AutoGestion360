const service = require('./reportes-parqueadero.service');

async function getResumenDia(req, res, next) {
  try { res.json(await service.getResumenDia(req.user.empresa_id, req.query.fecha)); }
  catch (err) { next(err); }
}

async function getResumenPeriodo(req, res, next) {
  try { res.json(await service.getResumenPeriodo(req.user.empresa_id, req.query.fecha_inicio, req.query.fecha_fin)); }
  catch (err) { next(err); }
}

async function getClientesFrecuentes(req, res, next) {
  try { res.json(await service.getClientesFrecuentes(req.user.empresa_id, req.query.limit)); }
  catch (err) { next(err); }
}

async function getEstadoPago(req, res, next) {
  try { res.json(await service.getEstadoPago(req.user.empresa_id)); }
  catch (err) { next(err); }
}

async function getOcupancia(req, res, next) {
  try { res.json(await service.getOcupancia(req.user.empresa_id)); }
  catch (err) { next(err); }
}

module.exports = { getResumenDia, getResumenPeriodo, getClientesFrecuentes, getEstadoPago, getOcupancia };
