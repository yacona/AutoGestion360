const multer = require('multer');
const path = require('path');
const fs = require('fs');
const service = require('./parqueadero.service');
const { entradaSchema, salidaSchema, mensualidadSchema } = require('./parqueadero.schemas');
const { ValidationError } = require('../../utils/errors');

// ── Multer ────────────────────────────────────────────────────────────────────
const evidenciaDir = path.join(__dirname, '..', '..', '..', 'uploads', 'parqueadero');
if (!fs.existsSync(evidenciaDir)) fs.mkdirSync(evidenciaDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: evidenciaDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `evidencia-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se permiten imágenes como evidencia.'), false);
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

function parseZod(schema, data, next) {
  const result = schema.safeParse(data);
  if (!result.success) {
    next(new ValidationError(result.error.errors.map((e) => e.message).join('; ')));
    return null;
  }
  return result.data;
}

// ── Handlers ──────────────────────────────────────────────────────────────────
function uploadEvidencia(req, res, next) {
  upload.single('evidencia')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Error procesando imagen de evidencia.' });
    next();
  });
}

async function registrarEntrada(req, res, next) {
  let filePath = req.file?.path;
  try {
    const data = parseZod(entradaSchema, req.body, next);
    if (!data) return;
    const evidenciaUrl = req.file ? `/uploads/parqueadero/${req.file.filename}` : null;
    res.json(await service.registrarEntrada(req.user.empresa_id, data, evidenciaUrl));
    filePath = null;
  } catch (err) {
    if (filePath) try { fs.unlinkSync(filePath); } catch (_) {}
    next(err);
  }
}

async function registrarSalida(req, res, next) {
  try {
    if (!req.params.id || isNaN(req.params.id)) return next(new ValidationError('ID de registro inválido.'));
    const data = parseZod(salidaSchema, req.body, next);
    if (!data) return;
    res.json(await service.registrarSalida(req.user.empresa_id, req.user.id, req.params.id, data));
  } catch (err) { next(err); }
}

async function preSalida(req, res, next) {
  try {
    if (!req.params.id || isNaN(req.params.id)) return next(new ValidationError('ID de registro inválido.'));
    res.json(await service.preSalida(req.user.empresa_id, req.params.id));
  } catch (err) { next(err); }
}

async function getActivos(req, res, next) {
  try { res.json(await service.getActivos(req.user.empresa_id)); }
  catch (err) { next(err); }
}

async function getHistorial(req, res, next) {
  try { res.json(await service.getHistorial(req.user.empresa_id, req.query.limit)); }
  catch (err) { next(err); }
}

async function getMensualidades(req, res, next) {
  try {
    const incluirInactivas = req.query.incluir_inactivas === 'true';
    res.json(await service.getMensualidades(req.user.empresa_id, incluirInactivas));
  } catch (err) { next(err); }
}

async function crearMensualidad(req, res, next) {
  try {
    const data = parseZod(mensualidadSchema, req.body, next);
    if (!data) return;
    res.status(201).json(await service.crearMensualidad(req.user.empresa_id, data));
  } catch (err) { next(err); }
}

async function getHistorialMensualidad(req, res, next) {
  try { res.json(await service.getHistorialMensualidad(req.user.empresa_id, req.params.id)); }
  catch (err) { next(err); }
}

async function getById(req, res, next) {
  try { res.json(await service.getById(req.user.empresa_id, req.params.id)); }
  catch (err) { next(err); }
}

async function preCarga(req, res, next) {
  try { res.json(await service.preCarga(req.user.empresa_id, req.params.placa)); }
  catch (err) { next(err); }
}

async function buscarPorPlaca(req, res, next) {
  try { res.json(await service.buscarPorPlaca(req.user.empresa_id, req.params.placa)); }
  catch (err) { next(err); }
}

async function editarEntrada(req, res, next) {
  try { res.json(await service.editarEntrada(req.user.empresa_id, req.params.id, req.body)); }
  catch (err) { next(err); }
}

module.exports = {
  uploadEvidencia, registrarEntrada, registrarSalida, preSalida,
  getActivos, getHistorial,
  getMensualidades, crearMensualidad, getHistorialMensualidad,
  getById, preCarga, buscarPorPlaca, editarEntrada,
};
