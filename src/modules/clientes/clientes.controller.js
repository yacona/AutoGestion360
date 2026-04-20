const service = require('./clientes.service');

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
    const cliente = await service.crear(req.user.empresa_id, req.body);
    res.status(201).json({ mensaje: 'Cliente creado exitosamente.', cliente });
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    const result = await service.actualizar(req.user.empresa_id, req.params.id, req.body);
    if (result?.mensaje) return res.json(result);
    res.json({ mensaje: 'Cliente actualizado exitosamente.', cliente: result });
  } catch (err) { next(err); }
}

async function eliminar(req, res, next) {
  try {
    await service.eliminar(req.user.empresa_id, req.params.id);
    res.json({ mensaje: 'Cliente eliminado exitosamente.' });
  } catch (err) { next(err); }
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
