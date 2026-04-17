const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repo = require('./auth.repository');
const db = require('../../../db');
const { ensureLicenciasSchema } = require('../../../utils/licencias-schema');
const { getSuscripcionEmpresa } = require('../../../utils/suscripciones-schema');
const { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } = require('../../utils/errors');
const { normalizeText } = require('../../utils/normalizers');

const LEGACY_LICENSE_MODULES = {
  demo:    ['dashboard', 'parqueadero', 'clientes'],
  basica:  ['dashboard', 'parqueadero', 'clientes', 'reportes', 'configuracion'],
  pro:     ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion'],
  premium: ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion', 'empresas'],
};

function isExpired(dateValue) {
  return Boolean(dateValue && new Date(dateValue) < new Date());
}

function buildToken(usuario) {
  return jwt.sign(
    { id: usuario.id, empresa_id: usuario.empresa_id, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function buildPermisos(licencia, modulos, bloqueada, suscripcion) {
  return {
    licencia: {
      id: licencia.licencia_id,
      nombre: licencia.licencia_nombre,
      descripcion: licencia.descripcion,
      precio: licencia.precio,
      fecha_inicio: licencia.fecha_inicio,
      fecha_fin: licencia.fecha_fin,
      activa: licencia.activa && !bloqueada,
    },
    suscripcion,
    expirada: bloqueada,
    modulos: bloqueada ? [] : modulos.map((m) => m.nombre),
    modulos_detalle: bloqueada ? [] : modulos,
  };
}

async function login(email, password) {
  if (!email || !password) throw new ValidationError('Debe enviar email y contraseña.');

  await ensureLicenciasSchema();
  const user = await repo.findUserWithEmpresa(email);

  if (!user) throw new UnauthorizedError('Credenciales inválidas.');
  if (!user.activo) throw new ForbiddenError('Usuario inactivo.');
  if (!user.empresa_activa) throw new ForbiddenError('La empresa está inactiva o sin licencia.');

  const coincide = await bcrypt.compare(password, user.password_hash);
  if (!coincide) throw new UnauthorizedError('Credenciales inválidas.');

  return {
    token: buildToken(user),
    usuario: { id: user.id, empresa_id: user.empresa_id, nombre: user.nombre, email: user.email, rol: user.rol },
    empresa: {
      id: user.empresa_id,
      nombre: user.empresa_nombre,
      logo_url: user.logo_url,
      zona_horaria: user.zona_horaria,
      licencia_tipo: user.licencia_tipo,
      licencia_id: user.licencia_id,
      licencia_fin: user.licencia_fin,
    },
  };
}

async function getEmpresaLicenciaPermisos(empresaId) {
  await ensureLicenciasSchema();
  const suscripcion = await getSuscripcionEmpresa(db, empresaId).catch(() => null);
  const suscripcionBloqueada = suscripcion
    ? ['VENCIDA', 'SUSPENDIDA', 'CANCELADA'].includes(suscripcion.estado_real)
    : false;

  const licenciaActiva = await repo.findEmpresaLicenciaActiva(empresaId);
  if (licenciaActiva) {
    const expirada = isExpired(licenciaActiva.fecha_fin);
    const modulos = await repo.findModulosByLicenciaId(licenciaActiva.licencia_id);
    return buildPermisos(licenciaActiva, modulos, expirada || suscripcionBloqueada, suscripcion);
  }

  const licenciaDirecta = await repo.findEmpresaLicenciaDirecta(empresaId);
  if (licenciaDirecta) {
    const expirada = isExpired(licenciaDirecta.fecha_fin);
    const modulos = await repo.findModulosByLicenciaId(licenciaDirecta.licencia_id);
    return buildPermisos(licenciaDirecta, modulos, expirada || suscripcionBloqueada, suscripcion);
  }

  const empresaLegacy = await repo.findEmpresaLegacy(empresaId);
  if (!empresaLegacy) {
    return { licencia: null, suscripcion, expirada: suscripcionBloqueada, modulos: [], modulos_detalle: [] };
  }

  const licenciaKey = normalizeText(empresaLegacy.licencia_tipo || 'demo');
  const expirada = isExpired(empresaLegacy.licencia_fin);
  const modulos = expirada ? [] : (LEGACY_LICENSE_MODULES[licenciaKey] || LEGACY_LICENSE_MODULES.demo);

  return {
    licencia: {
      id: null,
      nombre: empresaLegacy.licencia_tipo || 'Demo',
      descripcion: 'Licencia heredada de empresa',
      precio: null,
      fecha_inicio: empresaLegacy.licencia_inicio,
      fecha_fin: empresaLegacy.licencia_fin,
      activa: empresaLegacy.activa && !expirada,
    },
    suscripcion,
    expirada: expirada || suscripcionBloqueada,
    modulos: expirada || suscripcionBloqueada ? [] : modulos,
    modulos_detalle: expirada || suscripcionBloqueada ? [] : modulos.map((nombre) => ({ nombre, descripcion: '' })),
  };
}

async function getEmpresaLicencia(empresaId) {
  await ensureLicenciasSchema();
  let licencia = await repo.findEmpresaLicenciaActiva(empresaId);
  if (!licencia) licencia = await repo.findEmpresaLicenciaDirecta(empresaId);
  if (!licencia) return { mensaje: 'No hay licencia asignada' };

  const modulos = await repo.findModulosByLicenciaId(licencia.licencia_id);
  return { ...licencia, modulos };
}

async function getEmpresa(empresaId) {
  const empresa = await repo.findEmpresaById(empresaId);
  if (!empresa) throw new NotFoundError('Empresa no encontrada.');
  return empresa;
}

async function updateEmpresa(empresaId, data) {
  const empresa = await repo.updateEmpresa(empresaId, data);
  if (!empresa) throw new NotFoundError('Empresa no encontrada.');
  return empresa;
}

async function updateEmpresaLogo(empresaId, logoUrl) {
  const result = await repo.updateEmpresaLogo(empresaId, logoUrl);
  if (!result) throw new NotFoundError('Empresa no encontrada.');
  return result.logo_url;
}

async function setupDemo() {
  const count = await repo.countEmpresas();
  if (count > 0) throw new ValidationError('Ya existen empresas. Setup demo no disponible.');

  const empresa = await repo.createEmpresaDemo({
    nombre: 'Lavadero Demo AutoGestión360',
    nit: '900000000-1',
    ciudad: 'Quibdó',
    direccion: 'Calle 1 # 2-3',
    telefono: '3000000000',
    email_contacto: 'admin@demo.com',
    licencia_tipo: 'demo',
  });

  const passwordPlano = '123456';
  const hash = await bcrypt.hash(passwordPlano, 10);
  const usuario = await repo.createUsuario(empresa.id, {
    nombre: 'SuperAdmin Demo',
    email: 'admin@demo.com',
    password_hash: hash,
    rol: 'SuperAdmin',
  });

  return { empresa, usuario, credenciales_demo: { email: usuario.email, password: passwordPlano } };
}

module.exports = { login, getEmpresaLicenciaPermisos, getEmpresaLicencia, getEmpresa, updateEmpresa, updateEmpresaLogo, setupDemo };
