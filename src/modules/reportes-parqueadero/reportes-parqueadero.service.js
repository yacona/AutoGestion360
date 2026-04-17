const repo = require('./reportes-parqueadero.repository');
const { ValidationError } = require('../../utils/errors');

async function getResumenDia(empresaId, fecha) {
  const fechaConsulta = fecha || new Date().toISOString().split('T')[0];
  const { totalEntradas, activos, byType } = await repo.getResumenDia(empresaId, fechaConsulta);

  return {
    fecha: fechaConsulta,
    entradas_completadas: parseInt(totalEntradas?.total || 0, 10),
    ingresos_totales: parseFloat(totalEntradas?.ingresos || 0),
    vehiculos_activos: parseInt(activos?.total || 0, 10),
    por_tipo_vehiculo: byType,
  };
}

async function getResumenPeriodo(empresaId, fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) throw new ValidationError('fecha_inicio y fecha_fin son obligatorios.');
  const { totales, byDay } = await repo.getResumenPeriodo(empresaId, fechaInicio, fechaFin);

  return {
    periodo: { desde: fechaInicio, hasta: fechaFin },
    resumen: totales,
    por_dia: byDay,
  };
}

async function getClientesFrecuentes(empresaId, limit = 10) {
  return repo.getClientesFrecuentes(empresaId, limit);
}

async function getEstadoPago(empresaId) {
  return repo.getEstadoPago(empresaId);
}

async function getOcupancia(empresaId) {
  const { capacidad, ocupados } = await repo.getOcupancia(empresaId);
  return {
    capacidad_total: capacidad,
    espacios_ocupados: ocupados,
    espacios_disponibles: Math.max(0, capacidad - ocupados),
    porcentaje_ocupacion: capacidad > 0 ? ((ocupados / capacidad) * 100).toFixed(2) : 0,
  };
}

module.exports = { getResumenDia, getResumenPeriodo, getClientesFrecuentes, getEstadoPago, getOcupancia };
