'use strict';

const rateLimit = require('express-rate-limit');

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildRetryAfter(resetTime) {
  if (!(resetTime instanceof Date)) return null;
  const seconds = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

function createLimiter({
  windowMs,
  max,
  message,
  skipSuccessfulRequests = false,
}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler(req, res) {
      const retryAfter = buildRetryAfter(req.rateLimit?.resetTime);
      if (retryAfter) {
        res.setHeader('Retry-After', String(retryAfter));
      }

      return res.status(429).json({
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retry_after_seconds: retryAfter,
      });
    },
  });
}

const loginLimiter = createLimiter({
  windowMs: toNumber(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60 * 1000),
  max: toNumber(process.env.RATE_LIMIT_LOGIN_MAX, 5),
  message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente en unos minutos.',
  skipSuccessfulRequests: true,
});

const setupDemoLimiter = createLimiter({
  windowMs: toNumber(process.env.RATE_LIMIT_SETUP_DEMO_WINDOW_MS, 60 * 60 * 1000),
  max: toNumber(process.env.RATE_LIMIT_SETUP_DEMO_MAX, 3),
  message: 'Se alcanzó el límite de creación de entorno demo. Intenta más tarde.',
});

const userRegistrationLimiter = createLimiter({
  windowMs: toNumber(process.env.RATE_LIMIT_REGISTRATION_WINDOW_MS, 15 * 60 * 1000),
  max: toNumber(process.env.RATE_LIMIT_REGISTRATION_MAX, 10),
  message: 'Se alcanzó el límite de altas o registros. Intenta nuevamente más tarde.',
});

const adminMutationLimiter = createLimiter({
  windowMs: toNumber(process.env.RATE_LIMIT_ADMIN_WINDOW_MS, 15 * 60 * 1000),
  max: toNumber(process.env.RATE_LIMIT_ADMIN_MAX, 60),
  message: 'Demasiadas operaciones administrativas en un periodo corto. Espera un momento e intenta nuevamente.',
});

module.exports = {
  adminMutationLimiter,
  loginLimiter,
  setupDemoLimiter,
  userRegistrationLimiter,
};
