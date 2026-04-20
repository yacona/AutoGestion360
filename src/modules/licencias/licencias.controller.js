const service = require('./licencias.service');
const { isSuperAdmin } = require('../../lib/helpers');

function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Acceso denegado. Solo SuperAdmin.' });
  }
  next();
}

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

module.exports = {
  requireSuperAdmin,
  listar:      wrap(async (req, res) => res.json(await service.listar())),
  crear:       wrap(async (req, res) => {
    const licencia = await service.crear(req.body);
    res.status(201).json({ mensaje: 'Licencia creada exitosamente', licencia });
  }),
  actualizar:  wrap(async (req, res) => {
    const licencia = await service.actualizar(req.params.id, req.body);
    res.json({ mensaje: 'Licencia actualizada exitosamente', licencia });
  }),
  asignarModulos: wrap(async (req, res) => {
    await service.asignarModulos(req.params.id, req.body.modulos);
    res.json({ mensaje: 'Módulos asignados exitosamente' });
  }),
  obtenerModulos: wrap(async (req, res) => res.json(await service.obtenerModulos(req.params.id))),
  catalogoCompleto: wrap(async (req, res) => res.json(await service.catalogoCompleto())),
  licenciaEmpresa:  wrap(async (req, res) => res.json(await service.licenciaEmpresa(req.params.empresaId))),
  asignarLicencia:  wrap(async (req, res) => {
    const result = await service.asignarLicencia(req.body);
    res.status(201).json({ mensaje: 'Licencia asignada exitosamente', ...result });
  }),
  asignaciones:    wrap(async (req, res) => res.json(await service.asignaciones())),
  modulosDisponibles: wrap(async (req, res) => res.json(await service.modulosDisponibles())),
  proximasVencer:  wrap(async (req, res) => res.json(await service.proximasVencer(parseInt(req.query.dias) || 30))),
  enviarNotificaciones: wrap(async (req, res) =>
    res.json(await service.enviarNotificaciones(parseInt(req.query.dias) || 30))
  ),
};
