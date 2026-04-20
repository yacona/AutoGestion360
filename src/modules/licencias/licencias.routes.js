const express = require('express');
const ctrl = require('./licencias.controller');

const router = express.Router();

router.use(ctrl.requireSuperAdmin);

// Catálogo y módulos
router.get('/catalogo/completo',         ctrl.catalogoCompleto);
router.get('/modulos/disponibles',        ctrl.modulosDisponibles);
router.get('/asignaciones',               ctrl.asignaciones);
router.get('/proximas-vencer',            ctrl.proximasVencer);
router.post('/enviar-notificaciones',     ctrl.enviarNotificaciones);
router.get('/empresa/:empresaId',         ctrl.licenciaEmpresa);
router.post('/asignar',                   ctrl.asignarLicencia);

// CRUD licencias
router.post('/',                          ctrl.crear);
router.get('/',                           ctrl.listar);
router.put('/:id',                        ctrl.actualizar);
router.post('/:id/modulos',               ctrl.asignarModulos);
router.get('/:id/modulos',                ctrl.obtenerModulos);

module.exports = router;
