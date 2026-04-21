'use strict';

const { z } = require('zod');

const trimmedString = z.string().trim();
const optionalTrimmedString = z.preprocess(
  (value) => (value === undefined || value === null ? undefined : String(value).trim()),
  z.string().trim().optional()
);

const nullableTrimmedString = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
  },
  z.string().trim().nullable()
);

const nullableEmailString = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
  },
  z.string().trim().email('Debe enviar un correo válido.').nullable()
);

const positiveIntFromUnknown = z.coerce.number().int().positive();
const optionalPositiveIntFromUnknown = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  z.coerce.number().int().positive().optional()
);

const booleanFromUnknown = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const optionalBooleanFromUnknown = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  booleanFromUnknown.optional()
);

const nullableNumberFromUnknown = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? null : value),
  z.coerce.number().nullable()
);

const optionalNullableNumberFromUnknown = z.preprocess(
  (value) => (value === undefined ? undefined : value),
  nullableNumberFromUnknown.optional()
);

const isoDateString = z.string().trim().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Debe enviar una fecha válida.'
);

const optionalDateString = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  isoDateString.optional()
);

const nullableDateString = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? null : value),
  isoDateString.nullable()
);

module.exports = {
  z,
  booleanFromUnknown,
  nullableDateString,
  nullableEmailString,
  nullableNumberFromUnknown,
  nullableTrimmedString,
  optionalBooleanFromUnknown,
  optionalDateString,
  optionalNullableNumberFromUnknown,
  optionalPositiveIntFromUnknown,
  optionalTrimmedString,
  positiveIntFromUnknown,
  trimmedString,
};
