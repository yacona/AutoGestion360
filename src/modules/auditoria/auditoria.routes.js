const express = require('express');
const controller = require('./auditoria.controller');

const router = express.Router();

router.get('/', controller.listar);
router.get('/registro/:tabla/:id', controller.listarPorRegistro);

module.exports = router;
