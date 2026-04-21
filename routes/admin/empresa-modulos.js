'use strict';

/**
 * SHIM de compatibilidad — Sprint 4
 *
 * Este archivo ya no contiene lógica propia.
 * Los overrides de módulos por empresa ahora se sirven desde:
 *   src/modules/admin/admin.routes.js  (rutas /empresa-modulos/*)
 *
 * Se mantiene aquí únicamente para no romper require() externos.
 */
module.exports = require('../../src/modules/admin/admin.routes');
