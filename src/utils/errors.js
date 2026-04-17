class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') { super(message, 404); }
}

class ValidationError extends AppError {
  constructor(message) { super(message, 400); }
}

class ConflictError extends AppError {
  constructor(message) { super(message, 409); }
}

class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado') { super(message, 401); }
}

class ForbiddenError extends AppError {
  constructor(message = 'Acceso denegado') { super(message, 403); }
}

module.exports = { AppError, NotFoundError, ValidationError, ConflictError, UnauthorizedError, ForbiddenError };
