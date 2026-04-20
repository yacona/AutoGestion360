const service = require('./pagos.service');

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

module.exports = {
  cartaCliente: wrap(async (req, res) =>
    res.json(await service.cartaCliente(req.user.empresa_id, Number(req.params.cliente_id)))
  ),
  cartaVehiculo: wrap(async (req, res) =>
    res.json(await service.cartaVehiculo(req.user.empresa_id, req.params.placa))
  ),
  reciboServicio: wrap(async (req, res) =>
    res.json(await service.reciboServicio(req.user.empresa_id, req.params.modulo.toLowerCase(), req.params.id))
  ),
  reciboCliente: wrap(async (req, res) =>
    res.json(await service.reciboCliente(req.user.empresa_id, Number(req.params.cliente_id)))
  ),
  reciboVehiculo: wrap(async (req, res) =>
    res.json(await service.reciboVehiculo(req.user.empresa_id, req.params.placa))
  ),
  detalleServicio: wrap(async (req, res) =>
    res.json(await service.detalleServicio(req.user.empresa_id, req.params.modulo, Number(req.params.id)))
  ),
  registrarPagoGenerico: wrap(async (req, res) => {
    const resultado = await service.registrarPagoGenerico(req.user.empresa_id, req.user.id, req.body);
    res.status(201).json({
      mensaje: resultado.servicio.estado_cartera === 'PAGADO'
        ? 'Pago registrado correctamente.'
        : 'Abono registrado correctamente.',
      ...resultado,
    });
  }),
  registrarPagoParqueadero: wrap(async (req, res) => {
    const resultado = await service.registrarPagoParqueadero(req.user.empresa_id, req.user.id, req.body);
    res.status(201).json({
      mensaje: resultado.servicio.estado_cartera === 'PAGADO'
        ? 'Pago registrado correctamente.'
        : 'Abono registrado correctamente.',
      ...resultado,
    });
  }),
  pagosPorParqueadero: wrap(async (req, res) =>
    res.json(await service.pagosPorParqueadero(req.user.empresa_id, req.params.parqueadero_id))
  ),
  pendientesListado: wrap(async (req, res) =>
    res.json(await service.pendientesListado(req.user.empresa_id))
  ),
  endpointEliminado: (req, res) =>
    res.status(410).json({ error: 'Endpoint eliminado. Use POST /api/pagos/servicio para registrar pagos.' }),
};
