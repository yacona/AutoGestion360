// middleware/auth.js
const jwt = require('jsonwebtoken');

/**
 * Verifica el JWT y popula req.user con:
 *   - id
 *   - empresa_id  (null para usuarios de plataforma)
 *   - scope       'platform' | 'tenant'  (default: 'tenant' para tokens legacy)
 *   - rol
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Falta encabezado Authorization' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Formato de token inválido' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id:         decoded.id,
      empresa_id: decoded.empresa_id ?? null,
      scope:      decoded.scope || 'tenant',
      rol:        decoded.rol,
    };
    next();
  } catch (err) {
    console.error('Error verificando token:', err);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = authMiddleware;
