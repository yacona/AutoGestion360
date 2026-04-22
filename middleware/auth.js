// middleware/auth.js
const repo = require('../src/modules/auth/auth.repository');
const { ACCESS_TOKEN_TYPE, verifyAccessToken } = require('../src/modules/auth/auth.service');
const {
  recordSecurityEventSafe,
  resolveRequestIp,
  resolveUserAgent,
} = require('../src/lib/security/audit');

async function deny(req, res, payload, audit = {}) {
  await recordSecurityEventSafe({
    empresaId: audit.empresaId ?? null,
    usuarioId: audit.usuarioId ?? null,
    accion: audit.action || 'AUTH_ACCESS_DENIED',
    entidad: 'auth_session',
    entidadId: null,
    detalle: {
      modulo: 'auth',
      path: req.path,
      method: req.method,
      user_agent: resolveUserAgent(req),
      ...(audit.reason ? { razon: audit.reason } : {}),
      ...(audit.detalle || {}),
    },
    ip: resolveRequestIp(req),
  });

  return res.status(payload.status).json({ error: payload.message });
}

/**
 * Verifica el JWT y popula req.user con:
 *   - id
 *   - empresa_id  (null para usuarios de plataforma)
 *   - scope       'platform' | 'tenant'
 *   - rol
 *   - session_uid (si el token pertenece al sistema nuevo)
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return deny(req, res, { status: 401, message: 'Falta encabezado Authorization' }, {
      action: 'AUTH_TOKEN_MISSING',
      reason: 'AUTH_HEADER_MISSING',
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return deny(req, res, { status: 401, message: 'Formato de token inválido' }, {
      action: 'AUTH_TOKEN_INVALID',
      reason: 'INVALID_AUTH_HEADER',
    });
  }

  const token = parts[1];

  try {
    const verification = verifyAccessToken(token);
    const decoded = verification.decoded;
    const sessionUid = decoded.sid || null;
    const tokenType = decoded.typ || (verification.legacy ? 'legacy_access' : null);

    if (!verification.legacy && tokenType !== ACCESS_TOKEN_TYPE) {
      return deny(req, res, { status: 401, message: 'Tipo de token inválido' }, {
        action: 'AUTH_TOKEN_INVALID',
        reason: 'INVALID_TOKEN_TYPE',
        usuarioId: decoded.id || null,
        empresaId: decoded.empresa_id ?? null,
        detalle: { session_uid: sessionUid, token_type: tokenType },
      });
    }

    if (sessionUid) {
      const session = await repo.findSessionAuthContext(sessionUid);
      if (!session) {
        return deny(req, res, { status: 401, message: 'La sesión no existe o fue cerrada' }, {
          action: 'AUTH_SESSION_INVALID',
          reason: 'SESSION_NOT_FOUND',
          usuarioId: decoded.id || null,
          empresaId: decoded.empresa_id ?? null,
          detalle: { session_uid: sessionUid },
        });
      }

      if (session.revocada_en) {
        return deny(req, res, { status: 401, message: 'La sesión fue cerrada o revocada' }, {
          action: 'AUTH_SESSION_REVOKED',
          reason: session.motivo_revocacion || 'SESSION_REVOKED',
          usuarioId: session.user_id,
          empresaId: session.empresa_id,
          detalle: { session_uid: sessionUid },
        });
      }

      if (new Date(session.refresh_expires_at) <= new Date()) {
        return deny(req, res, { status: 401, message: 'La sesión expiró. Inicia sesión nuevamente.' }, {
          action: 'AUTH_SESSION_EXPIRED',
          reason: 'REFRESH_EXPIRED',
          usuarioId: session.user_id,
          empresaId: session.empresa_id,
          detalle: { session_uid: sessionUid },
        });
      }

      if (!session.usuario_activo) {
        return deny(req, res, { status: 401, message: 'El usuario ya no está activo.' }, {
          action: 'AUTH_SESSION_DENIED',
          reason: 'USER_INACTIVE',
          usuarioId: session.user_id,
          empresaId: session.empresa_id,
          detalle: { session_uid: sessionUid },
        });
      }

      if (session.scope === 'tenant' && !session.usuario_empresa_id) {
        return deny(req, res, { status: 401, message: 'La sesión tenant no tiene empresa asociada.' }, {
          action: 'AUTH_SESSION_DENIED',
          reason: 'TENANT_WITHOUT_EMPRESA',
          usuarioId: session.user_id,
          detalle: { session_uid: sessionUid },
        });
      }

      if (session.scope === 'tenant' && session.empresa_activa === false) {
        return deny(req, res, { status: 403, message: 'La empresa está inactiva.' }, {
          action: 'AUTH_SESSION_DENIED',
          reason: 'EMPRESA_INACTIVA',
          usuarioId: session.user_id,
          empresaId: session.empresa_id,
          detalle: { session_uid: sessionUid },
        });
      }

      await repo.touchSessionActivity(sessionUid, resolveRequestIp(req));
    }

    req.user = {
      id: decoded.id,
      empresa_id: decoded.empresa_id ?? null,
      scope: decoded.scope || 'tenant',
      rol: decoded.rol,
      session_uid: sessionUid,
      token_type: tokenType,
      legacy_token: verification.legacy === true,
    };

    return next();
  } catch (err) {
    console.error('Error verificando token:', err.message);
    return deny(req, res, { status: 401, message: 'Token inválido o expirado' }, {
      action: 'AUTH_TOKEN_INVALID',
      reason: err.name || 'JWT_VERIFY_FAILED',
    });
  }
}

module.exports = authMiddleware;
