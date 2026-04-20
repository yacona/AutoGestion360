const service = require('./auditoria.service');

async function listar(req, res, next) {
  try {
    const rows = await service.listar(req.user.empresa_id, req.query);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function listarPorRegistro(req, res, next) {
  try {
    const { tabla, id } = req.params;
    const rows = await service.listarPorRegistro(req.user.empresa_id, tabla, id);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, listarPorRegistro };
