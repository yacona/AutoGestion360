const db = require('../../../db');
const repo = require('./parqueadero.repository');
const { withTransaction } = require('../../utils/transaction');
const { ValidationError, NotFoundError } = require('../../utils/errors');
const { normalizarPlaca, limpiarTexto, normalizarServicioParqueadero } = require('../../utils/normalizers');
const { calculateParkingCharge, getParqueaderoConfig } = require('../../../utils/parqueadero-config');
const { METODOS_PAGO_VALIDOS, registrarPagoServicio, toNumber } = require('../../../utils/pagos-servicios');

// ── Helpers internos ──────────────────────────────────────────────────────────
function aplicarTipoServicioAlCobro(cobro, tarifa, tipoServicio) {
  if (tipoServicio === 'MENSUALIDAD') {
    return { valor_total: 0, valor_antes_descuento: 0, porcentaje_descuento: 0, descuento_aplicado: false, minutos_cobrados: 0, tarifa_aplicada: 'Mensualidad activa' };
  }
  if (tipoServicio === 'OCASIONAL_DIA' && tarifa?.valor_dia) {
    const valorDia = Number(tarifa.valor_dia);
    if (Number.isFinite(valorDia) && valorDia > cobro.valor_total) {
      return { ...cobro, valor_total: Math.ceil(valorDia), valor_antes_descuento: Math.ceil(valorDia), tarifa_aplicada: `$${valorDia} dia` };
    }
  }
  return cobro;
}

async function _calcularCobro(empresaId, registro, qbl = db) {
  const configParqueadero = await getParqueaderoConfig(empresaId, qbl);
  const tarifaDb = await repo.findTarifaForVehicle(qbl, empresaId, registro.tipo_vehiculo);
  const tarifa = configParqueadero.vehiculos[registro.tipo_vehiculo] || tarifaDb || {};

  const hora_entrada = new Date(registro.hora_entrada);
  const hora_salida = new Date();
  const minutos_total = Math.ceil((hora_salida - hora_entrada) / 60000);

  let cobro = calculateParkingCharge({ minutosTotal: minutos_total, horaEntrada: hora_entrada, horaSalida: hora_salida, tarifa, reglas: configParqueadero.reglas });
  cobro = aplicarTipoServicioAlCobro(cobro, tarifa, registro.tipo_servicio);

  return { hora_entrada, hora_salida, minutos_total, cobro, tarifa };
}

// ── Lógica de upsert propietario/vehículo ────────────────────────────────────
async function _resolverPropietarioNuevo(client, empresaId, { nombre, documento, telefono, correo }) {
  if (!nombre) return { clienteId: null, propietarioFinal: {} };

  let clienteRow = null;
  if (documento && documento !== 'SIN_DOCUMENTO') {
    clienteRow = await repo.findClientByDocument(client, empresaId, documento);
  }
  if (!clienteRow) {
    clienteRow = await repo.insertClient(client, empresaId, {
      nombre,
      documento: documento && documento !== 'SIN_DOCUMENTO' ? documento : null,
      telefono,
      correo,
    });
  }
  return { clienteId: clienteRow.id, propietarioFinal: clienteRow };
}

async function _resolverPropietarioExistente(client, empresaId, vehiculo, { nombre, documento, telefono, correo, esConductorPropietario }) {
  let clienteId = vehiculo.cliente_id;
  let propietarioFinal = {
    id: clienteId,
    nombre: vehiculo.propietario_nombre_db,
    documento: vehiculo.propietario_documento_db,
    telefono: vehiculo.propietario_telefono_db,
    correo: vehiculo.propietario_correo_db,
  };

  if (!esConductorPropietario || !nombre) return { clienteId, propietarioFinal };

  const nombreNuevo = nombre.trim().toUpperCase();
  const documentoNuevo = documento && documento !== 'SIN_DOCUMENTO' ? documento.trim() : null;
  const nombreActual = (vehiculo.propietario_nombre_db || '').trim().toUpperCase();
  const documentoActual = (vehiculo.propietario_documento_db || '').trim();

  if (nombreNuevo === nombreActual && (!documentoNuevo || documentoNuevo === documentoActual)) {
    return { clienteId, propietarioFinal };
  }

  let clienteRow = null;
  if (documentoNuevo) clienteRow = await repo.findClientByDocument(client, empresaId, documentoNuevo);
  if (!clienteRow) clienteRow = await repo.findClientByName(client, empresaId, nombreNuevo);
  if (!clienteRow) {
    clienteRow = await repo.insertClient(client, empresaId, { nombre, documento: documentoNuevo, telefono, correo });
  }

  if (clienteRow.id !== clienteId) {
    await repo.updateVehicleClient(client, vehiculo.id, clienteRow.id);
    clienteId = clienteRow.id;
  }

  return { clienteId, propietarioFinal: clienteRow };
}

// ── Métodos públicos del servicio ─────────────────────────────────────────────
async function registrarEntrada(empresaId, body, evidenciaUrl) {
  const placa = normalizarPlaca(body.placa);
  const tipo_vehiculo = limpiarTexto(body.tipo_vehiculo).toUpperCase();
  const tipo_servicio = normalizarServicioParqueadero(body.tipo_servicio);
  let mensualidad_id = body.mensualidad_id ? Number(body.mensualidad_id) : null;
  const es_conductor_propietario = Boolean(body.es_conductor_propietario ?? true);

  const propietario = {
    nombre: limpiarTexto(body.propietario_nombre),
    documento: limpiarTexto(body.propietario_documento),
    telefono: limpiarTexto(body.propietario_telefono),
    correo: limpiarTexto(body.propietario_correo),
  };
  let conductor = {
    nombre: limpiarTexto(body.conductor_nombre),
    documento: limpiarTexto(body.conductor_documento),
    telefono: limpiarTexto(body.conductor_telefono),
  };

  return withTransaction(async (client) => {
    await repo.ensureSchema(client);

    // Verificar entrada duplicada
    const abierto = await repo.findOpenEntryByPlaca(client, empresaId, placa);
    if (abierto) throw new ValidationError('Ya existe una entrada activa para esta placa. Debe registrar la salida antes de una nueva entrada.');

    // Resolver mensualidad
    let mensualidadActiva = null;
    if (tipo_servicio === 'MENSUALIDAD') {
      mensualidadActiva = await repo.findActiveMensualidad(client, empresaId, { placa, mensualidadId: mensualidad_id });
      if (!mensualidadActiva) throw new ValidationError('No hay una mensualidad activa y vigente para esta placa.');
      mensualidad_id = mensualidadActiva.id;
      propietario.nombre = mensualidadActiva.nombre_cliente;
      propietario.documento = mensualidadActiva.documento || '';
      propietario.telefono = mensualidadActiva.telefono || '';
      propietario.correo = mensualidadActiva.correo || '';
      conductor.nombre = conductor.nombre || mensualidadActiva.nombre_cliente;
      conductor.telefono = conductor.telefono || mensualidadActiva.telefono || '';
    }

    // Resolver vehículo y propietario
    const vehiculoExistente = await repo.findVehicleWithOwner(client, empresaId, placa);
    let vehiculoId;
    let propietarioClienteId;
    let propietarioFinal;

    if (!vehiculoExistente) {
      const { clienteId, propietarioFinal: pf } = await _resolverPropietarioNuevo(client, empresaId, propietario);
      propietarioClienteId = clienteId;
      propietarioFinal = pf;

      const veh = await repo.insertVehicle(client, empresaId, { clienteId, placa, tipoVehiculo: tipo_vehiculo });
      vehiculoId = veh.id;

      if (mensualidadActiva && !mensualidadActiva.vehiculo_id) {
        await repo.linkMensualidadVehicle(client, mensualidadActiva.id, empresaId, vehiculoId, propietarioClienteId);
      }
    } else {
      vehiculoId = vehiculoExistente.id;
      const { clienteId, propietarioFinal: pf } = await _resolverPropietarioExistente(client, empresaId, vehiculoExistente, { ...propietario, esConductorPropietario: es_conductor_propietario });
      propietarioClienteId = clienteId;
      propietarioFinal = pf;
    }

    if (mensualidadActiva && vehiculoId && !mensualidadActiva.vehiculo_id) {
      await repo.linkMensualidadVehicle(client, mensualidadActiva.id, empresaId, vehiculoId, propietarioClienteId);
    }

    // Resolver conductor
    if (!es_conductor_propietario && tipo_servicio === 'MENSUALIDAD' && (!conductor.nombre || !conductor.documento)) {
      throw new ValidationError('Si el conductor NO es el propietario, debe registrar al menos nombre y documento del conductor.');
    }

    let nombreConductorFinal = es_conductor_propietario
      ? (conductor.nombre || propietario.nombre || propietarioFinal?.nombre)
      : conductor.nombre;

    let telefonoConductorFinal = es_conductor_propietario
      ? (conductor.telefono || propietario.telefono || propietarioFinal?.telefono)
      : conductor.telefono;

    if (!nombreConductorFinal) {
      nombreConductorFinal = tipo_servicio === 'MENSUALIDAD' ? mensualidadActiva.nombre_cliente : 'USUARIO GENERICO';
    }

    const entry = await repo.insertEntry(client, {
      empresa_id: empresaId,
      vehiculo_id: vehiculoId,
      cliente_id: propietarioClienteId,
      placa,
      tipo_vehiculo,
      nombre_cliente: nombreConductorFinal || propietarioFinal?.nombre || null,
      telefono: telefonoConductorFinal || propietarioFinal?.telefono || null,
      conductor_nombre: nombreConductorFinal || propietarioFinal?.nombre || null,
      conductor_documento: conductor.documento || (es_conductor_propietario ? propietario.documento : null) || null,
      conductor_telefono: telefonoConductorFinal || propietarioFinal?.telefono || null,
      es_propietario: es_conductor_propietario,
      observaciones: limpiarTexto(body.observaciones) || null,
      evidencia_url: evidenciaUrl || null,
      tipo_servicio,
      mensualidad_id: mensualidad_id || null,
      estado_pago: tipo_servicio === 'MENSUALIDAD' ? 'MENSUALIDAD' : 'PENDIENTE',
    });

    return {
      mensaje: 'Entrada registrada correctamente.',
      parqueadero: entry,
      propietario: propietarioFinal,
      conductor: {
        nombre: nombreConductorFinal,
        documento: conductor.documento || (es_conductor_propietario ? propietario.documento : null),
        telefono: telefonoConductorFinal,
      },
    };
  });
}

async function registrarSalida(empresaId, usuarioId, id, body) {
  const metodo_pago = limpiarTexto(body.metodo_pago);
  const detalle_pago = limpiarTexto(body.detalle_pago);
  const observaciones = limpiarTexto(body.observaciones);
  const referencia_transaccion = limpiarTexto(body.referencia_transaccion);
  const monto_pago = body.monto_pago;

  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    throw new ValidationError(`Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(', ')}`);
  }

  return withTransaction(async (client) => {
    await repo.ensureSchema(client);

    const registro = await repo.findOpenEntryById(client, id, empresaId);
    if (!registro) throw new NotFoundError('Registro no encontrado o ya fue cerrado.');

    const { hora_entrada, hora_salida, minutos_total, cobro, tarifa } = await _calcularCobro(empresaId, registro, client);
    const valor_total = toNumber(cobro.valor_total);
    const esMensualidad = String(registro.tipo_servicio || '').toUpperCase() === 'MENSUALIDAD';
    const requiereCobro = !esMensualidad && valor_total > 0;

    if (requiereCobro && !metodo_pago) throw new ValidationError('Debe especificar el método de pago para registrar la salida.');

    const metodoPagoFinal = !requiereCobro && !metodo_pago && esMensualidad ? 'MENSUALIDAD' : metodo_pago;

    let registroActualizado = await repo.closeEntry(client, id, {
      hora_salida,
      minutos_total,
      valor_total,
      estado_pago: esMensualidad ? 'MENSUALIDAD' : (requiereCobro ? 'PENDIENTE' : 'PAGADO'),
      metodo_pago: requiereCobro ? null : (metodoPagoFinal || null),
      detalle_pago: requiereCobro ? null : (detalle_pago || null),
      observaciones: observaciones || null,
    });

    let pagoResumen = null;
    if (requiereCobro) {
      const resultadoPago = await registrarPagoServicio({
        queryable: client,
        empresaId,
        usuarioId,
        modulo: 'parqueadero',
        referenciaId: id,
        monto: monto_pago,
        metodoPago: metodo_pago,
        referenciaTransaccion: referencia_transaccion,
        detallePago: detalle_pago,
      });
      pagoResumen = resultadoPago.servicio;
      const fresco = await repo.findEntryForRead(client, id, empresaId);
      if (fresco) registroActualizado = fresco;
    }

    const mensaje = pagoResumen
      ? (pagoResumen.estado_cartera === 'PAGADO' ? 'Salida registrada correctamente y pago confirmado.' : 'Salida registrada correctamente. Se registró un abono y quedó saldo pendiente.')
      : esMensualidad ? 'Salida registrada correctamente. Vehículo cubierto por mensualidad.' : 'Salida registrada correctamente.';

    return {
      mensaje,
      parqueadero: registroActualizado,
      pago_resumen: pagoResumen,
      resumen: { tiempo_total_minutos: minutos_total, tiempo_total_horas: (minutos_total / 60).toFixed(2), valor_total, tarifa_aplicada: cobro.tarifa_aplicada },
    };
  });
}

async function preSalida(empresaId, id) {
  await repo.ensureSchema();
  const registro = await repo.findOpenEntryById(db, id, empresaId);
  if (!registro) throw new NotFoundError('Registro no encontrado o ya fue cerrado.');

  const { hora_entrada, hora_salida, minutos_total, cobro, tarifa } = await _calcularCobro(empresaId, registro);
  const horas_total = minutos_total / 60;

  return {
    registro_id: id,
    placa: registro.placa,
    tipo_vehiculo: registro.tipo_vehiculo,
    tipo_servicio: registro.tipo_servicio,
    hora_entrada: hora_entrada.toLocaleString('es-CO'),
    hora_salida: hora_salida.toLocaleString('es-CO'),
    tiempo_estancia: `${Math.floor(horas_total)}h ${minutos_total % 60}m`,
    minutos_total,
    horas_total: horas_total.toFixed(2),
    tarifa_aplicada: cobro.tarifa_aplicada,
    tarifa_minima: tarifa.tarifa_minima ? `$${tarifa.tarifa_minima} COP` : 'No aplica',
    descuento: cobro.descuento_aplicado ? `${cobro.porcentaje_descuento}%` : 'No aplica',
    valor_antes_descuento: cobro.valor_antes_descuento,
    valor_a_cobrar: cobro.valor_total,
    metodos_pago: ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'],
  };
}

async function getActivos(empresaId) {
  await repo.ensureSchema();
  return repo.findActiveEntries(db, empresaId);
}

async function getHistorial(empresaId, limit) {
  await repo.ensureSchema();
  return repo.findHistorial(db, empresaId, Math.min(Number(limit) || 50, 200));
}

async function getMensualidades(empresaId, incluirInactivas) {
  await repo.ensureSchema();
  return repo.findMensualidades(db, empresaId, incluirInactivas);
}

async function crearMensualidad(empresaId, body) {
  return withTransaction(async (client) => {
    await repo.ensureSchema(client);

    const placa = normalizarPlaca(body.placa);
    const nombre_cliente = limpiarTexto(body.nombre_cliente).toUpperCase();
    const tipo_vehiculo = limpiarTexto(body.tipo_vehiculo).toUpperCase();

    // Upsert cliente
    let clienteRow = await repo.findClientByDocument(client, empresaId, body.documento);
    if (clienteRow) {
      clienteRow = await repo.updateClientData(client, clienteRow.id, empresaId, { nombre: nombre_cliente, telefono: body.telefono || null, correo: body.correo || null });
    } else {
      clienteRow = await repo.insertClient(client, empresaId, { nombre: nombre_cliente, documento: body.documento, telefono: body.telefono || null, correo: body.correo || null });
    }

    // Upsert vehículo
    let vehiculoRow = await repo.findVehicleWithOwner(client, empresaId, placa);
    if (vehiculoRow) {
      vehiculoRow = await repo.updateVehicleOwner(client, vehiculoRow.id, empresaId, {
        clienteId: clienteRow.id, tipoVehiculo: tipo_vehiculo,
        marca: limpiarTexto(body.marca).toUpperCase() || null,
        modelo: limpiarTexto(body.modelo).toUpperCase() || null,
        color: limpiarTexto(body.color).toUpperCase() || null,
      });
    } else {
      vehiculoRow = await repo.insertVehicle(client, empresaId, {
        clienteId: clienteRow.id, placa, tipoVehiculo: tipo_vehiculo,
        marca: limpiarTexto(body.marca).toUpperCase() || null,
        modelo: limpiarTexto(body.modelo).toUpperCase() || null,
        color: limpiarTexto(body.color).toUpperCase() || null,
      });
    }

    await repo.deactivateMensualidadesByPlaca(client, empresaId, placa);

    const mensualidad = await repo.insertMensualidad(client, {
      empresa_id: empresaId,
      cliente_id: clienteRow.id,
      vehiculo_id: vehiculoRow.id,
      placa,
      tipo_vehiculo,
      nombre_cliente,
      documento: body.documento,
      telefono: body.telefono || null,
      correo: body.correo || null,
      direccion: limpiarTexto(body.direccion) || null,
      contacto_emergencia: limpiarTexto(body.contacto_emergencia) || null,
      fecha_inicio: body.fecha_inicio,
      fecha_fin: body.fecha_fin,
      valor_mensual: Number(body.valor_mensual || 0),
      observaciones: limpiarTexto(body.observaciones) || null,
    });

    return { mensaje: 'Mensualidad registrada correctamente.', mensualidad, cliente: clienteRow, vehiculo: vehiculoRow };
  });
}

async function getHistorialMensualidad(empresaId, id) {
  await repo.ensureSchema();
  const mensualidad = await repo.findMensualidadById(db, id, empresaId);
  if (!mensualidad) throw new NotFoundError('Mensualidad no encontrada.');

  const historial = await repo.findHistorialByMensualidad(db, empresaId, id, mensualidad.placa);
  return { mensualidad, historial };
}

async function getById(empresaId, id) {
  if (!id || isNaN(id)) throw new ValidationError('ID de registro inválido.');
  await repo.ensureSchema();
  const registro = await repo.findEntryById(db, id, empresaId);
  if (!registro) throw new NotFoundError('Registro no encontrado.');
  return registro;
}

async function preCarga(empresaId, placaRaw) {
  const placa = normalizarPlaca(placaRaw);
  if (!placa) throw new ValidationError('Debe enviar una placa.');

  const row = await repo.findVehicleInfoByPlaca(db, empresaId, placa);
  if (!row) return { existe: false };

  return {
    existe: true,
    vehiculo: { id: row.vehiculo_id, placa: row.placa, tipo_vehiculo: row.tipo_vehiculo, marca: row.marca, modelo: row.modelo, color: row.color },
    propietario: row.propietario_id ? { id: row.propietario_id, nombre: row.propietario_nombre, documento: row.propietario_documento, telefono: row.propietario_telefono, correo: row.propietario_correo } : null,
  };
}

async function buscarPorPlaca(empresaId, placaRaw) {
  const placa = normalizarPlaca(placaRaw);
  if (!placa) throw new ValidationError('Debe enviar una placa.');
  await repo.ensureSchema();

  const [vehiculo, mensualidadActiva, historial] = await Promise.all([
    repo.findVehicleInfoByPlaca(db, empresaId, placa),
    repo.findActiveMensualidad(db, empresaId, { placa, mensualidadId: null }),
    repo.findHistorialMultimodalByPlaca(db, empresaId, placa),
  ]);

  return {
    placa,
    existe: !!vehiculo || !!mensualidadActiva,
    vehiculo: vehiculo
      ? { id: vehiculo.vehiculo_id, placa: vehiculo.placa, tipo_vehiculo: vehiculo.tipo_vehiculo, marca: vehiculo.marca, modelo: vehiculo.modelo, color: vehiculo.color }
      : mensualidadActiva
        ? { id: mensualidadActiva.vehiculo_id, placa: mensualidadActiva.placa, tipo_vehiculo: mensualidadActiva.tipo_vehiculo, marca: null, modelo: null, color: null }
        : null,
    propietario: vehiculo
      ? { id: vehiculo.propietario_id, nombre: vehiculo.propietario_nombre, documento: vehiculo.propietario_documento, telefono: vehiculo.propietario_telefono, correo: vehiculo.propietario_correo }
      : mensualidadActiva
        ? { id: mensualidadActiva.cliente_id, nombre: mensualidadActiva.nombre_cliente, documento: mensualidadActiva.documento, telefono: mensualidadActiva.telefono, correo: mensualidadActiva.correo }
        : null,
    mensualidad: mensualidadActiva,
    historial,
  };
}

async function editarEntrada(empresaId, id, body) {
  if (!id || isNaN(id)) throw new ValidationError('ID de registro inválido.');

  const abierto = await repo.findOpenEntryById(db, id, empresaId);
  if (!abierto) throw new NotFoundError('Registro no encontrado o ya fue cerrado.');

  const actualizado = await repo.updateEntryFields(db, id, empresaId, body);
  if (!actualizado) return { mensaje: 'No hay cambios para aplicar.', registro_id: id };

  return { mensaje: 'Registro actualizado exitosamente.', registro: actualizado };
}

module.exports = {
  registrarEntrada, registrarSalida, preSalida,
  getActivos, getHistorial,
  getMensualidades, crearMensualidad, getHistorialMensualidad,
  getById, preCarga, buscarPorPlaca, editarEntrada,
};
