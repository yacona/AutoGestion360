'use strict';

/**
 * SHIM de compatibilidad — Sprint 4
 *
 * Este archivo ya no contiene lógica propia.
 * Las rutas del panel admin viven en:
 *   src/modules/admin/admin.routes.js
 *
 * Se mantiene aquí únicamente para no romper require() externos
 * que pudieran apuntar a esta ruta.
 */
module.exports = require('../../src/modules/admin/admin.routes');
