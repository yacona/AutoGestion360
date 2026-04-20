const express = require('express');
const controller = require('./configuracion.controller');

const router = express.Router();

router.get('/parqueadero', controller.getParqueadero);
router.put('/parqueadero', controller.updateParqueadero);

module.exports = router;
