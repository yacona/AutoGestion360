const service = require('./taller.service');

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

module.exports = {
  crear:         wrap(async (req, res) => res.json(await service.crear(req.user.empresa_id, req.body))),
  listar:        wrap(async (req, res) => res.json(await service.listar(req.user.empresa_id, req.query))),
  obtener:       wrap(async (req, res) => res.json(await service.obtener(req.user.empresa_id, req.params.id))),
  historial:     wrap(async (req, res) => res.json(await service.historial(req.user.empresa_id, req.query))),
  cambiarEstado: wrap(async (req, res) => res.json(await service.cambiarEstado(req.user.empresa_id, req.params.id, req.body))),
  actualizar:    wrap(async (req, res) =>
    res.json(await service.actualizar(req.user.empresa_id, req.user.id, req.params.id, req.body))
  ),
  agregarItem:   wrap(async (req, res) => res.json(await service.agregarItem(req.user.empresa_id, req.params.id, req.body))),
  eliminarItem:  wrap(async (req, res) => {
    await service.eliminarItem(req.params.itemId);
    res.json({ mensaje: 'Ítem eliminado correctamente.' });
  }),
  registrarPago: wrap(async (req, res) => res.json(await service.registrarPago(req.user.empresa_id, req.params.id, req.body))),
};
