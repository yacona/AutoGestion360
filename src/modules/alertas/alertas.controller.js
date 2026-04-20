const service = require('./alertas.service');

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

module.exports = {
  inteligentes: wrap(async (req, res) =>
    res.json(await service.generarInteligentes(req.user.empresa_id))
  ),
  resumen: wrap(async (req, res) => {
    const data = await service.generarInteligentes(req.user.empresa_id);
    res.json({ generado_en: data.generado_en, resumen: data.resumen, alertas_destacadas: data.alertas.slice(0, 5) });
  }),
  noLeidas: wrap(async (req, res) => res.json(await service.noLeidas(req.user.empresa_id))),
  listar:   wrap(async (req, res) => res.json(await service.listar(req.user.empresa_id, req.query))),
  marcarLeida: wrap(async (req, res) => res.json(await service.marcarLeida(req.user.empresa_id, req.params.id))),
  crear: wrap(async (req, res) => res.status(201).json(await service.crear(req.user.empresa_id, req.body))),
};
