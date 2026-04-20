const service = require('./lavadero.service');

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

module.exports = {
  crearTipo: wrap(async (req, res) => res.json(await service.crearTipo(req.user.empresa_id, req.body))),
  listarTipos: wrap(async (req, res) => res.json(await service.listarTipos(req.user.empresa_id))),
  actualizarTipo: wrap(async (req, res) => res.json(await service.actualizarTipo(req.user.empresa_id, req.params.id, req.body))),

  crear: wrap(async (req, res) => res.json(await service.crear(req.user.empresa_id, req.body))),
  listar: wrap(async (req, res) => res.json(await service.listar(req.user.empresa_id, req.query))),
  obtener: wrap(async (req, res) => res.json(await service.obtener(req.user.empresa_id, req.params.id))),
  historial: wrap(async (req, res) => res.json(await service.historial(req.user.empresa_id, req.query))),

  actualizar: wrap(async (req, res) =>
    res.json(await service.actualizar(req.user.empresa_id, req.user.id, req.params.id, req.body))
  ),
  actualizarEstado: wrap(async (req, res) =>
    res.json(await service.actualizarEstado(req.user.empresa_id, req.params.id, req.body))
  ),
  registrarPago: wrap(async (req, res) =>
    res.json(await service.registrarPago(req.user.empresa_id, req.params.id, req.body))
  ),
  asignarLavador: wrap(async (req, res) =>
    res.json(await service.asignarLavador(req.user.empresa_id, req.params.id, req.body.lavador_id))
  ),
};
