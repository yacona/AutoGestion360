const SERVICIOS_PARQUEADERO = new Set(['OCASIONAL_HORA', 'OCASIONAL_DIA', 'MENSUALIDAD']);

function normalizarPlaca(placa) {
  return (placa || '').toUpperCase().trim();
}

function limpiarTexto(txt) {
  return (txt || '').trim();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizarServicioParqueadero(value) {
  const servicio = limpiarTexto(value || 'OCASIONAL_HORA').toUpperCase();
  return SERVICIOS_PARQUEADERO.has(servicio) ? servicio : 'OCASIONAL_HORA';
}

module.exports = { normalizarPlaca, limpiarTexto, normalizeText, normalizarServicioParqueadero };
