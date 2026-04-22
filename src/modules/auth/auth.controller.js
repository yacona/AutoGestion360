const multer = require('multer');
const path = require('path');
const fs = require('fs');
const service = require('./auth.service');

const logoDir = path.join(__dirname, '..', '..', '..', 'uploads', 'empresa');
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `empresa_${req.user.empresa_id}_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype));
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

/**
 * Verifica que el usuario autenticado sea de scope 'tenant' y tenga empresa_id.
 * Devuelve 403 para usuarios de plataforma que intenten usar rutas de empresa.
 */
function requireTenantScope(req, res) {
  if (req.user.scope === 'platform' || !req.user.empresa_id) {
    res.status(403).json({
      error: 'Esta operación no está disponible para usuarios de plataforma.',
    });
    return false;
  }
  return true;
}

async function login(req, res, next) {
  try {
    const result = await service.login(req.body?.email, req.body?.password);
    res.json(result);
  } catch (err) { next(err); }
}

async function setupDemo(req, res, next) {
  try {
    const result = await service.setupDemo();
    res.json({ mensaje: 'Setup demo creado con éxito.', ...result });
  } catch (err) { next(err); }
}

async function getEmpresa(req, res, next) {
  try {
    if (!requireTenantScope(req, res)) return;
    res.json(await service.getEmpresa(req.user.empresa_id));
  } catch (err) { next(err); }
}

async function updateEmpresa(req, res, next) {
  try {
    if (!requireTenantScope(req, res)) return;
    const empresa = await service.updateEmpresa(req.user.empresa_id, req.body);
    res.json({ mensaje: 'Empresa actualizada exitosamente', empresa });
  } catch (err) { next(err); }
}

function uploadLogoMiddleware(req, res, next) {
  upload.single('logo')(req, res, function (err) {
    if (err) {
      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'El archivo excede el tamaño máximo de 2MB.'
          : 'Error al procesar el archivo de logo.';
        return res.status(400).json({ error: message });
      }
      return res.status(400).json({ error: err.message || 'Error al subir el logo.' });
    }
    next();
  });
}

async function uploadLogo(req, res, next) {
  try {
    if (!requireTenantScope(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'Archivo de logo requerido' });
    const logoUrl = `/uploads/empresa/${req.file.filename}`;
    const logo_url = await service.updateEmpresaLogo(req.user.empresa_id, logoUrl);
    res.json({ mensaje: 'Logo actualizado exitosamente', logo_url });
  } catch (err) { next(err); }
}

async function getEmpresaLicencia(req, res, next) {
  try {
    if (!requireTenantScope(req, res)) return;
    res.json(await service.getEmpresaLicencia(req.user.empresa_id));
  } catch (err) { next(err); }
}

async function getLicenciaPermisos(req, res, next) {
  try {
    if (!requireTenantScope(req, res)) return;
    res.json(await service.getEmpresaLicenciaPermisos(req.user.empresa_id, req.user));
  } catch (err) { next(err); }
}

module.exports = { login, setupDemo, getEmpresa, updateEmpresa, uploadLogoMiddleware, uploadLogo, getEmpresaLicencia, getLicenciaPermisos };
