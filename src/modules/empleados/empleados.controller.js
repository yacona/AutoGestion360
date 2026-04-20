const service = require('./empleados.service');

async function listar(req, res, next) {
  try {
    res.json(await service.listar(req.user.empresa_id, req.query));
  } catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try {
    res.json(await service.obtener(req.user.empresa_id, req.params.id));
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    res.json(await service.crear(req.user.empresa_id, req.body));
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    res.json(await service.actualizar(req.user.empresa_id, req.params.id, req.body));
  } catch (err) { next(err); }
}

async function cambiarEstado(req, res, next) {
  try {
    res.json(await service.cambiarEstado(req.user.empresa_id, req.params.id, req.body.activo));
  } catch (err) { next(err); }
}

async function desactivar(req, res, next) {
  try {
    const empleado = await service.desactivar(req.user.empresa_id, req.params.id);
    res.json({ mensaje: 'Empleado desactivado.', empleado });
  } catch (err) { next(err); }
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado, desactivar };
