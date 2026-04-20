const service = require('./suscripciones.service');
const { normalizeRole } = require('../../lib/helpers');

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

function requireSuperAdmin(req, res, next) {
  if (normalizeRole(req.user?.rol) !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado. Solo SuperAdmin.' });
  }
  next();
}

module.exports = {
  resumen: wrap(async (req, res) =>
    res.json(await service.resumen())
  ),

  listar: wrap(async (req, res) =>
    res.json(await service.listar(req.query))
  ),

  obtenerSuscripcion: wrap(async (req, res) => {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) return res.status(400).json({ error: 'Empresa invalida.' });
    res.json(await service.obtenerSuscripcion(empresaId));
  }),

  listarFacturas: wrap(async (req, res) => {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) return res.status(400).json({ error: 'Empresa invalida.' });
    res.json(await service.listarFacturas(empresaId, req.query.limit));
  }),

  crearFactura: wrap(async (req, res) => {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) return res.status(400).json({ error: 'Empresa invalida.' });
    const factura = await service.crearFactura(empresaId, req.body);
    res.status(201).json({ mensaje: 'Factura SaaS registrada correctamente.', factura });
  }),

  upsert: wrap(async (req, res) => {
    const suscripcion = await service.upsert(req.body);
    res.json({ mensaje: 'Suscripcion actualizada correctamente.', suscripcion });
  }),

  renovar: wrap(async (req, res) => {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) return res.status(400).json({ error: 'Empresa invalida.' });
    const result = await service.renovar(empresaId, req.body);
    res.json({ mensaje: 'Suscripcion renovada correctamente.', ...result });
  }),

  cambiarEstado: wrap(async (req, res) => {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) return res.status(400).json({ error: 'Empresa invalida.' });
    const suscripcion = await service.cambiarEstado(empresaId, req.body);
    res.json({ mensaje: 'Estado de suscripcion actualizado correctamente.', suscripcion });
  }),

  requireSuperAdmin,
};
