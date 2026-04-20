const express = require('express');
const ctrl = require('./pagos.controller');

const router = express.Router();

// Carteras
router.get('/cartera/cliente/:cliente_id',  ctrl.cartaCliente);
router.get('/cartera/vehiculo/:placa',      ctrl.cartaVehiculo);

// Recibos / comprobantes
router.get('/recibo/servicio/:modulo/:id',  ctrl.reciboServicio);
router.get('/recibo/cliente/:cliente_id',   ctrl.reciboCliente);
router.get('/recibo/vehiculo/:placa',       ctrl.reciboVehiculo);

// Detalle de servicio con historial de pagos
router.get('/servicio/:modulo/:id',         ctrl.detalleServicio);

// Registrar pagos
router.post('/servicio',                    ctrl.registrarPagoGenerico);
router.post('/',                            ctrl.registrarPagoParqueadero);

// Consultas
router.get('/parqueadero/:parqueadero_id',  ctrl.pagosPorParqueadero);
router.get('/pendientes/listado',           ctrl.pendientesListado);

// Endpoint legacy eliminado
router.patch('/:id',                        ctrl.endpointEliminado);

module.exports = router;
