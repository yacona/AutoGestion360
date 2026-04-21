const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repo = require('./auth.repository');
const { getLicenseStatus, isLegacyFallbackEnabled } = require('../../../services/licenseService');
const { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } = require('../../utils/errors');

const SUPERADMIN_MODULES = [
  'dashboard',
  'parqueadero',
  'lavadero',
  'taller',
  'clientes',
  'empleados',
  'reportes',
  'configuracion',
  'usuarios',
  'empresas',
];

function buildToken(usuario) {
  return jwt.sign(
    { id: usuario.id, empresa_id: usuario.empresa_id, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function buildSuperAdminPermisos() {
  return {
    licencia: {
      id: 'superadmin',
      codigo: 'superadmin',
      nombre: 'SuperAdmin',
      descripcion: 'Acceso total por rol de sistema',
      precio: null,
      fecha_inicio: null,
      fecha_fin: null,
      activa: true,
      fuente: 'rol',
      oficial: true,
      transicional: false,
    },
    suscripcion: null,
    expirada: false,
    estado: 'ACTIVA',
    fuente: 'rol',
    legacy_fallback_enabled: false,
    legacy_fallback_used: false,
    modulos: [...SUPERADMIN_MODULES],
    modulos_detalle: SUPERADMIN_MODULES.map((nombre) => ({ nombre, descripcion: null, icono_clave: null, limite: null, es_addon: false })),
  };
}

function buildPermisos(status) {
  const licencia = status.licencia || {};
  const bloqueada = !status.vigente;

  return {
    licencia: {
      id: licencia.id ?? null,
      codigo: licencia.codigo ?? null,
      nombre: licencia.nombre ?? null,
      descripcion: licencia.descripcion ?? null,
      precio: licencia.precio ?? status.suscripcion?.precio_pactado ?? null,
      fecha_inicio: licencia.fecha_inicio ?? status.suscripcion?.fecha_inicio ?? null,
      fecha_fin: licencia.fecha_fin ?? status.suscripcion?.fecha_fin ?? status.suscripcion?.trial_hasta ?? null,
      activa: Boolean(licencia.activa) && !bloqueada,
      fuente: status.fuente,
      oficial: status.oficial === true,
      transicional: status.transicional === true,
    },
    suscripcion: status.suscripcion
      ? { ...status.suscripcion, estado_real: status.estado, fuente: 'suscripciones' }
      : null,
    expirada: bloqueada,
    estado: status.estado,
    fuente: status.fuente,
    legacy_fallback_enabled: status.metadata?.legacy_fallback_enabled === true,
    legacy_fallback_used: status.metadata?.legacy_fallback_used === true,
    modulos: bloqueada ? [] : status.modulos,
    modulos_detalle: bloqueada ? [] : status.modulos_detalle,
  };
}

async function login(email, password) {
  if (!email || !password) throw new ValidationError('Debe enviar email y contraseña.');

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

async function getEmpresaLicenciaPermisos(empresaId, user = null) {
  if (normalizeRole(user?.rol) === 'superadmin') {
    return buildSuperAdminPermisos();
  }

  const status = await getLicenseStatus(empresaId, {
    allowLegacyFallback: isLegacyFallbackEnabled(),
  });
  return buildPermisos(status);
}

async function getEmpresaLicencia(empresaId) {
  const status = await getLicenseStatus(empresaId, {
    allowLegacyFallback: isLegacyFallbackEnabled(),
  });

  if (!status.fuente || !status.licencia) {
    return { mensaje: 'No hay licencia asignada' };
  }

  return {
    ...status.licencia,
    estado: status.estado,
    vigente: status.vigente,
    fuente: status.fuente,
    oficial: status.oficial === true,
    transicional: status.transicional === true,
    modulos: status.modulos_detalle,
    plan: status.plan,
    suscripcion: status.suscripcion,
  };
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
