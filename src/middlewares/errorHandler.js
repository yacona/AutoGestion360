function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.isOperational ? err.message : 'Error interno del servidor';

  if (!err.isOperational) {
    console.error('[ERROR]', {
      message: err.message,
      stack: err.stack,
      method: req.method,
      path: req.path,
    });
  }

  const payload = { error: message };
  if (err.isOperational && Array.isArray(err.details) && err.details.length > 0) {
    payload.details = err.details;
  }

  res.status(statusCode).json(payload);
}

module.exports = errorHandler;
