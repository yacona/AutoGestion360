const service = require('./usuarios.service');

async function listar(req, res, next) {
  try {
    res.json(await service.listar(req.user, req.query));
  } catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    const usuario = await service.crear(req.user, req.body);
    res.status(201).json({ mensaje: 'Usuario creado exitosamente.', usuario });
  } catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try {
    const usuario = await service.actualizar(req.user, Number(req.params.id), req.body);
    res.json({ mensaje: 'Usuario actualizado exitosamente.', usuario });
  } catch (err) { next(err); }
}

async function cambiarEstado(req, res, next) {
  try {
    const activo  = req.body.activo !== false;
    const usuario = await service.cambiarEstado(req.user, Number(req.params.id), activo);
    res.json({ mensaje: activo ? 'Usuario activado.' : 'Usuario desactivado.', usuario });
  } catch (err) { next(err); }
}

async function cambiarPassword(req, res, next) {
  try {
    await service.cambiarPassword(req.user, Number(req.params.id), String(req.body.password || '').trim());
    res.json({ mensaje: 'Contraseña actualizada exitosamente.' });
  } catch (err) { next(err); }
}

module.exports = { listar, crear, actualizar, cambiarEstado, cambiarPassword };
