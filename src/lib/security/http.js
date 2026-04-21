'use strict';

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAllowedOrigins() {
  const defaults = [
    'http://localhost:4000',
    'http://127.0.0.1:4000',
  ];

  const configured = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return new Set(configured.length > 0 ? configured : defaults);
}

function buildCorsOptions() {
  const allowedOrigins = parseAllowedOrigins();
  const allowNoOrigin = toBoolean(
    process.env.CORS_ALLOW_NO_ORIGIN,
    process.env.NODE_ENV !== 'production'
  );

  return {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, allowNoOrigin);
      }

      return callback(null, allowedOrigins.has(origin));
    },
    credentials: toBoolean(process.env.CORS_ALLOW_CREDENTIALS, true),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Origin'],
    optionsSuccessStatus: 204,
  };
}

function getRequestBodyLimit() {
  return process.env.REQUEST_BODY_LIMIT || '256kb';
}

function getTrustProxy() {
  if (process.env.TRUST_PROXY === undefined) return false;

  const raw = String(process.env.TRUST_PROXY).trim().toLowerCase();
  if (['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'].includes(raw)) {
    return toBoolean(raw, false);
  }

  return toNumber(raw, false);
}

module.exports = {
  buildCorsOptions,
  getRequestBodyLimit,
  getTrustProxy,
};
