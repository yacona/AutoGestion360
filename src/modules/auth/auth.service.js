const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const db = require('../../../db');
const repo = require('./auth.repository');
const withTransaction = require('../../lib/withTransaction');
const { getLicenseStatus, isLegacyFallbackEnabled } = require('../../../services/licenseService');
const { recordSecurityEventSafe } = require('../../lib/security/audit');
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} = require('../../utils/errors');

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

const ACCESS_TOKEN_TYPE = 'access';
const DEFAULT_JWT_ISSUER = 'autogestion360';
const DEFAULT_JWT_AUDIENCE = 'autogestion360-clients';

function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function getJwtIssuer() {
  return process.env.JWT_ISSUER || DEFAULT_JWT_ISSUER;
}

function getJwtAudience() {
  return process.env.JWT_AUDIENCE || DEFAULT_JWT_AUDIENCE;
}

function getAccessTokenTtlSeconds() {
  const parsed = Number(process.env.JWT_ACCESS_TTL_SECONDS || 900);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}

function getRefreshTokenTtlSeconds() {
  const parsed = Number(process.env.JWT_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 30);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : (60 * 60 * 24 * 30);
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + (seconds * 1000));
}

function hashOpaqueToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateOpaqueToken(size = 48) {
  return crypto.randomBytes(size).toString('hex');
}

function serializeRefreshToken(sessionUid, secret) {
  return `${sessionUid}.${secret}`;
}

function parseRefreshToken(token) {
  const normalized = String(token || '').trim();
  const [sessionUid, secret] = normalized.split('.', 2);

  if (!sessionUid || !secret) {
    throw new UnauthorizedError('Refresh token inválido.');
  }

  return { sessionUid, secret };
}

function buildAccessToken(user, sessionUid) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = getAccessTokenTtlSeconds();

  const token = jwt.sign(
    {
      id: user.id,
      empresa_id: user.empresa_id ?? null,
      scope: user.scope || 'tenant',
      rol: user.rol,
      sid: sessionUid,
      typ: ACCESS_TOKEN_TYPE,
    },
    process.env.JWT_SECRET,
    {
      expiresIn,
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
    }
  );

  return {
    token,
    expires_in: expiresIn,
    expires_at: new Date((now + expiresIn) * 1000).toISOString(),
  };
}

function buildSessionPayload(session) {
  return {
    id: session.session_uid,
    refresh_expires_at: session.refresh_expires_at instanceof Date
      ? session.refresh_expires_at.toISOString()
      : new Date(session.refresh_expires_at).toISOString(),
    ultimo_login_en: session.ultimo_login_en instanceof Date
      ? session.ultimo_login_en.toISOString()
      : new Date(session.ultimo_login_en).toISOString(),
    ultimo_refresh_en: session.ultimo_refresh_en
      ? new Date(session.ultimo_refresh_en).toISOString()
      : null,
    ultima_actividad_en: session.ultima_actividad_en
      ? new Date(session.ultima_actividad_en).toISOString()
      : null,
  };
}

function buildAuthResponse(user, accessTokenData, refreshToken, session) {
  const isPlatform = user.scope === 'platform';

  const response = {
    token: accessTokenData.token,
    access_token: accessTokenData.token,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: accessTokenData.expires_in,
    expires_at: accessTokenData.expires_at,
    refresh_expires_in: getRefreshTokenTtlSeconds(),
    session: buildSessionPayload(session),
    usuario: {
      id: user.id,
      empresa_id: user.empresa_id ?? null,
      scope: user.scope || 'tenant',
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
    },
  };

  response.empresa = isPlatform
    ? null
    : {
        id: user.empresa_id,
        nombre: user.empresa_nombre,
        logo_url: user.logo_url,
        zona_horaria: user.zona_horaria,
        licencia_tipo: user.licencia_tipo,
        licencia_id: user.licencia_id,
        licencia_fin: user.licencia_fin,
      };

  return response;
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
    modulos_detalle: SUPERADMIN_MODULES.map((nombre) => ({
      nombre,
      descripcion: null,
      icono_clave: null,
      limite: null,
      es_addon: false,
    })),
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

function ensureTenantAccess(user) {
  const isPlatform = user.scope === 'platform';
  if (!isPlatform && !user.empresa_activa) {
    throw new ForbiddenError('La empresa está inactiva o sin licencia.');
  }
}

async function auditAuthEvent({
  action,
  user = null,
  sessionUid = null,
  ip = null,
  userAgent = null,
  motivo = null,
  detalle = {},
}) {
  await recordSecurityEventSafe({
    empresaId: user?.empresa_id ?? null,
    usuarioId: user?.id ?? null,
    accion: action,
    entidad: 'auth_session',
    entidadId: null,
    detalle: {
      modulo: 'auth',
      session_uid: sessionUid,
      user_scope: user?.scope ?? null,
      user_role: user?.rol ?? null,
      user_agent: userAgent ?? null,
      ...(motivo ? { razon: motivo } : {}),
      ...detalle,
    },
    ip,
  });
}

async function createSessionForUser(user, context = {}, queryable) {
  const sessionUid = generateOpaqueToken(24);
  const refreshSecret = generateOpaqueToken(32);
  const refreshToken = serializeRefreshToken(sessionUid, refreshSecret);
  const now = new Date();
  const refreshExpiresAt = addSeconds(now, getRefreshTokenTtlSeconds());

  const session = await repo.createSession({
    queryable,
    sessionUid,
    userId: user.id,
    empresaId: user.empresa_id ?? null,
    scope: user.scope || 'tenant',
    refreshTokenHash: hashOpaqueToken(refreshSecret),
    userAgent: context.userAgent || null,
    ipCreacion: context.ip || null,
    ipUltimoUso: context.ip || null,
    refreshExpiresAt,
    metadata: context.metadata || null,
  });

  const accessTokenData = buildAccessToken(user, sessionUid);

  return {
    accessTokenData,
    refreshToken,
    session,
  };
}

function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
    });
    return { decoded, legacy: false };
  } catch (strictError) {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { decoded, legacy: true, strictError };
  }
}

async function login(email, password, context = {}) {
  if (!email || !password) throw new ValidationError('Debe enviar email y contraseña.');

  const user = await repo.findUserWithEmpresa(email);
  if (!user) {
    await auditAuthEvent({
      action: 'AUTH_LOGIN_FAILED',
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      motivo: 'USER_NOT_FOUND',
      detalle: { attempted_email: email },
    });
    throw new UnauthorizedError('Credenciales inválidas.');
  }

  if (!user.activo) {
    await auditAuthEvent({
      action: 'AUTH_LOGIN_DENIED',
      user,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      motivo: 'USER_INACTIVE',
    });
    throw new ForbiddenError('Usuario inactivo.');
  }

  const coincide = await bcrypt.compare(password, user.password_hash);
  if (!coincide) {
    await auditAuthEvent({
      action: 'AUTH_LOGIN_FAILED',
      user,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      motivo: 'INVALID_PASSWORD',
    });
    throw new UnauthorizedError('Credenciales inválidas.');
  }

  try {
    ensureTenantAccess(user);
  } catch (error) {
    await auditAuthEvent({
      action: 'AUTH_LOGIN_DENIED',
      user,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      motivo: 'EMPRESA_INACTIVA',
    });
    throw error;
  }

  const result = await withTransaction(async (client) => {
    const freshUser = await repo.findUserByIdWithEmpresa(user.id, client);
    const sessionBundle = await createSessionForUser(freshUser, context, client);

    await auditAuthEvent({
      action: 'AUTH_LOGIN_SUCCESS',
      user: freshUser,
      sessionUid: sessionBundle.session.session_uid,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      detalle: { scope: freshUser.scope || 'tenant' },
    });

    return buildAuthResponse(
      freshUser,
      sessionBundle.accessTokenData,
      sessionBundle.refreshToken,
      sessionBundle.session
    );
  });

  return result;
}

async function refreshSession(refreshToken, context = {}) {
  const { sessionUid, secret } = parseRefreshToken(refreshToken);
  const secretHash = hashOpaqueToken(secret);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const session = await repo.findSessionByUid(sessionUid, client);
    if (!session) {
      await client.query('ROLLBACK');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_FAILED',
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'SESSION_NOT_FOUND',
        detalle: { session_uid: sessionUid },
      });
      throw new UnauthorizedError('Refresh token inválido o revocado.');
    }

    const user = await repo.findUserByIdWithEmpresa(session.user_id, client);
    if (!user) {
      await repo.revokeSessionById(session.id, 'USER_NOT_FOUND', client);
      await client.query('COMMIT');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_FAILED',
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'USER_NOT_FOUND',
        detalle: { session_uid: sessionUid },
      });
      throw new UnauthorizedError('Refresh token inválido o revocado.');
    }

    if (session.revocada_en) {
      await client.query('ROLLBACK');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_FAILED',
        user,
        sessionUid,
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'SESSION_REVOKED',
      });
      throw new UnauthorizedError('Refresh token inválido o revocado.');
    }

    if (new Date(session.refresh_expires_at) <= new Date()) {
      await repo.revokeSessionById(session.id, 'REFRESH_TOKEN_EXPIRED', client);
      await client.query('COMMIT');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_FAILED',
        user,
        sessionUid,
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'REFRESH_TOKEN_EXPIRED',
      });
      throw new UnauthorizedError('Refresh token expirado.');
    }

    if (session.previous_refresh_token_hash && session.previous_refresh_token_hash === secretHash) {
      await repo.revokeSessionById(session.id, 'REFRESH_TOKEN_REUSE_DETECTED', client);
      await client.query('COMMIT');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_REPLAY_DETECTED',
        user,
        sessionUid,
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'REFRESH_TOKEN_REUSE_DETECTED',
      });
      throw new UnauthorizedError('Refresh token inválido o revocado.');
    }

    if (session.refresh_token_hash !== secretHash) {
      await client.query('ROLLBACK');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_FAILED',
        user,
        sessionUid,
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'REFRESH_TOKEN_HASH_MISMATCH',
      });
      throw new UnauthorizedError('Refresh token inválido o revocado.');
    }

    if (!user.activo) {
      await repo.revokeSessionById(session.id, 'USER_INACTIVE', client);
      await client.query('COMMIT');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_DENIED',
        user,
        sessionUid,
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'USER_INACTIVE',
      });
      throw new ForbiddenError('Usuario inactivo.');
    }

    try {
      ensureTenantAccess(user);
    } catch (error) {
      await repo.revokeSessionById(session.id, 'EMPRESA_INACTIVA', client);
      await client.query('COMMIT');
      await auditAuthEvent({
        action: 'AUTH_REFRESH_DENIED',
        user,
        sessionUid,
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        motivo: 'EMPRESA_INACTIVA',
      });
      throw error;
    }

    const newRefreshSecret = generateOpaqueToken(32);
    const rotatedSession = await repo.rotateSessionRefreshToken({
      queryable: client,
      sessionId: session.id,
      previousRefreshTokenHash: session.refresh_token_hash,
      refreshTokenHash: hashOpaqueToken(newRefreshSecret),
      refreshExpiresAt: addSeconds(new Date(), getRefreshTokenTtlSeconds()),
      ipUltimoUso: context.ip || null,
      userAgent: context.userAgent || null,
      metadata: context.metadata || null,
    });

    const nextRefreshToken = serializeRefreshToken(sessionUid, newRefreshSecret);
    const accessTokenData = buildAccessToken(user, sessionUid);

    await client.query('COMMIT');

    await auditAuthEvent({
      action: 'AUTH_REFRESH_SUCCESS',
      user,
      sessionUid,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
    });

    return buildAuthResponse(user, accessTokenData, nextRefreshToken, rotatedSession);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function logoutCurrentSession({ currentUser, sessionUid = null, refreshToken = null, context = {} }) {
  let resolvedSessionUid = sessionUid || null;

  if (!resolvedSessionUid && refreshToken) {
    resolvedSessionUid = parseRefreshToken(refreshToken).sessionUid;
  }

  if (!resolvedSessionUid) {
    throw new ValidationError('Debes enviar la sesión actual o un refresh token para cerrar sesión.');
  }

  return withTransaction(async (client) => {
    const session = await repo.findSessionByUid(resolvedSessionUid, client);
    if (!session) {
      return { revoked: false, message: 'La sesión ya no existe o fue revocada.' };
    }

    if (currentUser && Number(session.user_id) !== Number(currentUser.id)) {
      throw new ForbiddenError('No puedes cerrar una sesión que no te pertenece.');
    }

    const revoked = await repo.revokeSessionByUid(resolvedSessionUid, 'USER_LOGOUT', client);

    await auditAuthEvent({
      action: 'AUTH_LOGOUT',
      user: currentUser || await repo.findUserByIdWithEmpresa(session.user_id, client),
      sessionUid: resolvedSessionUid,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
    });

    return {
      revoked: Boolean(revoked),
      session_uid: resolvedSessionUid,
    };
  });
}

async function logoutAllSessions(currentUser, currentSessionUid = null, context = {}) {
  const revokedSessions = await withTransaction(async (client) => {
    const rows = await repo.revokeAllSessionsForUser(currentUser.id, 'USER_LOGOUT_ALL', client);

    await auditAuthEvent({
      action: 'AUTH_LOGOUT_ALL',
      user: currentUser,
      sessionUid: currentSessionUid,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      detalle: { revoked_sessions: rows.length },
    });

    return rows;
  });

  return {
    revoked_sessions: revokedSessions.length,
  };
}

async function listUserSessions(currentUser, currentSessionUid = null) {
  const rows = await repo.listSessionsByUserId(currentUser.id);
  return rows.map((session) => ({
    id: session.session_uid,
    actual: currentSessionUid ? session.session_uid === currentSessionUid : false,
    scope: session.scope,
    empresa_id: session.empresa_id,
    user_agent: session.user_agent,
    ip_creacion: session.ip_creacion,
    ip_ultimo_uso: session.ip_ultimo_uso,
    ultimo_login_en: session.ultimo_login_en,
    ultimo_refresh_en: session.ultimo_refresh_en,
    ultima_actividad_en: session.ultima_actividad_en,
    refresh_expires_at: session.refresh_expires_at,
    revocada_en: session.revocada_en,
    motivo_revocacion: session.motivo_revocacion,
    creado_en: session.creado_en,
  }));
}

async function revokeOwnedSession(currentUser, targetSessionUid, currentSessionUid = null, context = {}) {
  if (!targetSessionUid) {
    throw new ValidationError('sessionUid es requerido.');
  }

  return withTransaction(async (client) => {
    const session = await repo.findSessionByUid(targetSessionUid, client);
    if (!session) {
      throw new NotFoundError('Sesión no encontrada.');
    }

    if (Number(session.user_id) !== Number(currentUser.id)) {
      throw new ForbiddenError('No puedes cerrar una sesión que no te pertenece.');
    }

    await repo.revokeSessionByUid(targetSessionUid, 'SESSION_REVOKED_BY_USER', client);

    await auditAuthEvent({
      action: 'AUTH_SESSION_REVOKED',
      user: currentUser,
      sessionUid: targetSessionUid,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      detalle: { initiated_from_session_uid: currentSessionUid },
    });

    return {
      session_uid: targetSessionUid,
      current_session_revoked: currentSessionUid === targetSessionUid,
    };
  });
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

  const passwordPlano = String(process.env.SETUP_DEMO_PASSWORD || '123456');
  const hash = await bcrypt.hash(passwordPlano, 10);

  const usuario = await repo.createUsuario(empresa.id, {
    nombre: 'SuperAdmin Demo',
    email: 'admin@demo.com',
    password_hash: hash,
    rol: 'SuperAdmin',
  });

  return { empresa, usuario, credenciales_demo: { email: usuario.email, password: passwordPlano } };
}

module.exports = {
  ACCESS_TOKEN_TYPE,
  verifyAccessToken,
  login,
  refreshSession,
  logoutCurrentSession,
  logoutAllSessions,
  listUserSessions,
  revokeOwnedSession,
  getEmpresaLicenciaPermisos,
  getEmpresaLicencia,
  getEmpresa,
  updateEmpresa,
  updateEmpresaLogo,
  setupDemo,
};
