'use strict';

const AppError = require('../lib/AppError');

function formatIssues(issues = []) {
  return issues
    .map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length > 0
        ? issue.path.join('.')
        : 'payload';
      return { path, message: issue.message };
    });
}

function validate(schemas = {}) {
  return (req, res, next) => {
    try {
      const targets = [
        ['body', schemas.body],
        ['query', schemas.query],
        ['params', schemas.params],
      ];

      for (const [target, schema] of targets) {
        if (!schema) continue;

        const result = schema.safeParse(req[target]);
        if (!result.success) {
          const details = formatIssues(result.error?.issues || []);
          const message = details.map((item) => `${item.path}: ${item.message}`).join('; ') || 'Datos inválidos.';
          const error = new AppError(message, 400);
          error.details = details;
          throw error;
        }

        req[target] = result.data;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = validate;
