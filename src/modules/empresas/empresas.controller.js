const service = require('./empresas.service');
const { isSuperAdmin } = require('../../lib/helpers');

function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Solo un SuperAdmin puede gestionar empresas.' });
  }
  next();
}

async function listar(req, res, next) {
  try {
    res.json(await service.listar());
  } catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try {
    res.json(await service.obtener(req.params.id));
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    const empresa = await service.crear(req.body);
    res.status(201).json({ mensaje: 'Empresa creada exitosamente.', empresa });
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    const empresa = await service.actualizar(
      Number(req.params.id),
      req.user.empresa_id,
      req.body
    );
    res.json({ mensaje: 'Empresa actualizada exitosamente.', empresa });
  } catch (err) { next(err); }
}

async function cambiarEstado(req, res, next) {
  try {
    const activa = req.body.activa !== false;
    const empresa = await service.cambiarEstado(
      Number(req.params.id),
      req.user.empresa_id,
      activa
    );
    res.json({ mensaje: activa ? 'Empresa activada.' : 'Empresa desactivada.', empresa });
  } catch (err) { next(err); }
}

module.exports = { requireSuperAdmin, listar, obtener, crear, actualizar, cambiarEstado };
