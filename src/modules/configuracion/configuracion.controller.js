const service = require('./configuracion.service');

async function getParqueadero(req, res, next) {
  try {
    const config = await service.getConfig(req.user.empresa_id);
    res.json(config);
  } catch (err) {
    next(err);
  }
}

async function updateParqueadero(req, res, next) {
  try {
    const config = await service.updateConfig(req.user.empresa_id, req.body);
    res.json({ mensaje: 'Configuracion de parqueadero actualizada exitosamente.', config });
  } catch (err) {
    next(err);
  }
}

module.exports = { getParqueadero, updateParqueadero };
