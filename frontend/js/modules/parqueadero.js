/* =========================================================
   PARQUEADERO — entrada, salida, mensualidades, historial
   Depende de: ui.js, api.js
   ========================================================= */

let datosPreSalida = null;
let registroId = null;

// ── Helpers de UI ─────────────────────────────────────────

function limpiarFormularioParqueadero() {
  const ids = ["pq-placa", "pq-nombre", "pq-telefono", "pq-obs", "pq-evidencia"];
  ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  const servicioEl = document.getElementById("pq-servicio");
  const tipoEl = document.getElementById("pq-tipo");
  const propEl = document.getElementById("pq-es-propietario");
  if (servicioEl) servicioEl.value = "OCASIONAL_HORA";
  if (tipoEl) tipoEl.value = "CARRO";
  if (propEl) propEl.checked = true;
  const msgEl = document.getElementById("pq-msg");
  const histEl = document.getElementById("pq-historial");
  if (msgEl) { msgEl.hidden = true; msgEl.textContent = ""; }
  if (histEl) { histEl.hidden = true; histEl.textContent = ""; }
}

function servicioParqueaderoLabel(servicio) {
  const labels = { OCASIONAL_HORA: "Horas", OCASIONAL_DIA: "Día", MENSUALIDAD: "Mensualidad" };
  return labels[servicio] || "Horas";
}

function actualizarAyudaTipoServicioParqueadero() {
  const servicio = document.getElementById("pq-servicio")?.value || "OCASIONAL_HORA";
  const nombreEl = document.getElementById("pq-nombre");
  const propEl = document.getElementById("pq-es-propietario");
  if (nombreEl) nombreEl.placeholder = servicio === "MENSUALIDAD" ? "Se carga desde la mensualidad" : "Opcional";
  if (propEl && servicio !== "MENSUALIDAD") propEl.checked = true;
}

function setMensualidadFechasDefecto() {
  const inicioEl = document.getElementById("pq-men-inicio");
  const finEl = document.getElementById("pq-men-fin");
  if (!inicioEl || !finEl || inicioEl.value || finEl.value) return;
  const hoy = new Date();
  const fin = new Date(hoy);
  fin.setMonth(fin.getMonth() + 1);
  inicioEl.value = formatDateParam(hoy);
  finEl.value = formatDateParam(fin);
}

function mostrarHistorialVehiculo(element, historial) {
  if (!element) return;
  if (!historial) { element.hidden = true; return; }
  const parqueoCount = Array.isArray(historial.parqueadero) ? historial.parqueadero.length : 0;
  const lavaderoCount = Array.isArray(historial.lavadero) ? historial.lavadero.length : 0;
  const tallerCount = Array.isArray(historial.taller) ? historial.taller.length : 0;
  element.hidden = false;
  element.innerHTML = `Vehículo con historial: ${parqueoCount} parqueadero(s), ${lavaderoCount} lavadero(s), ${tallerCount} taller(es). Si hay un nuevo propietario, habilite la casilla y actualice el nombre.`;
}

// ── Flujo de ingreso ──────────────────────────────────────

function seleccionarFlujoParqueadero(flujo = "ocasional") {
  const ingresoPanel = document.getElementById("pq-panel-ingreso");
  const altaPanel = document.getElementById("pq-panel-alta-mensualidad");
  const servicioEl = document.getElementById("pq-servicio");
  const titleEl = document.getElementById("pq-ingreso-title");
  const helpEl = document.getElementById("pq-ingreso-help");
  const nombreHelpEl = document.getElementById("pq-nombre-help");
  const submitBtn = document.querySelector("#form-parqueadero-entrada button[type='submit']");

  document.querySelectorAll(".module-action-btn").forEach((btn) => btn.classList.remove("active"));

  if (flujo === "alta") {
    ingresoPanel?.classList.add("hidden");
    altaPanel?.classList.remove("hidden");
    document.getElementById("btn-pq-alta-mensualidad")?.classList.add("active");
    setMensualidadFechasDefecto();
    cargarMensualidadesParqueadero();
    return;
  }

  ingresoPanel?.classList.remove("hidden");
  altaPanel?.classList.add("hidden");

  if (flujo === "mensualidad") {
    if (servicioEl) servicioEl.value = "MENSUALIDAD";
    if (titleEl) titleEl.textContent = "Registrar ingreso de mensualidad";
    if (helpEl) helpEl.textContent = "Ingresa la placa de un cliente con mensualidad activa. El sistema cargará sus datos y la salida quedará cobrada contra la mensualidad.";
    if (nombreHelpEl) nombreHelpEl.textContent = "Se carga desde la mensualidad activa asociada a la placa.";
    if (submitBtn) submitBtn.textContent = "Registrar ingreso mensualidad";
    document.getElementById("btn-pq-ingreso-mensualidad")?.classList.add("active");
  } else if (flujo === "dia") {
    if (servicioEl) servicioEl.value = "OCASIONAL_DIA";
    if (titleEl) titleEl.textContent = "Registrar ingreso por día";
    if (helpEl) helpEl.textContent = "Registra vehículos ocasionales con cobro mínimo de día completo según la configuración de tarifas.";
    if (nombreHelpEl) nombreHelpEl.textContent = "Puede quedar vacío; se registrará como usuario genérico.";
    if (submitBtn) submitBtn.textContent = "Registrar ingreso por día";
    document.getElementById("btn-pq-ingreso-dia")?.classList.add("active");
  } else {
    if (servicioEl) servicioEl.value = "OCASIONAL_HORA";
    if (titleEl) titleEl.textContent = "Registrar ingreso por horas";
    if (helpEl) helpEl.textContent = "Registra vehículos ocasionales por fracciones u horas. El nombre puede quedar vacío y se guardará como usuario genérico.";
    if (nombreHelpEl) nombreHelpEl.textContent = "Para usuarios ocasionales puede quedar vacío; se registrará como usuario genérico.";
    if (submitBtn) submitBtn.textContent = "Registrar ingreso por horas";
    document.getElementById("btn-pq-ingreso-ocasional")?.classList.add("active");
  }

  actualizarAyudaTipoServicioParqueadero();
}

function procesarPlacaParqueadero(data) {
  const { existe, vehiculo, propietario, mensualidad, historial } = data;
  const msgEl = document.getElementById("pq-msg");
  const histEl = document.getElementById("pq-historial");
  const tipoEl = document.getElementById("pq-tipo");
  const servicioEl = document.getElementById("pq-servicio");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");

  if (msgEl) { msgEl.hidden = true; msgEl.textContent = ""; }
  if (histEl) { histEl.hidden = true; histEl.textContent = ""; }
  if (tipoEl) tipoEl.value = "";
  if (nombreEl) nombreEl.value = "";
  if (telEl) telEl.value = "";

  if (existe) {
    if (tipoEl) tipoEl.value = vehiculo.tipo_vehiculo || "";
    if (servicioEl && mensualidad) servicioEl.value = "MENSUALIDAD";
    if (propietario) {
      if (nombreEl) nombreEl.value = propietario.nombre || "";
      if (telEl) telEl.value = propietario.telefono || "";
    }
    if (histEl) mostrarHistorialVehiculo(histEl, historial);
    if (msgEl) {
      msgEl.hidden = false;
      if (mensualidad) seleccionarFlujoParqueadero("mensualidad");
      msgEl.textContent = mensualidad
        ? "Mensualidad activa encontrada. El ingreso quedará asociado a ese cliente."
        : "Vehículo existente. El sistema cargó datos previos y el historial.";
      msgEl.classList.remove("error");
      msgEl.classList.add("ok");
    }
    actualizarAyudaTipoServicioParqueadero();
  } else {
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.textContent = "Vehículo nuevo. Complete los datos y registre la entrada.";
      msgEl.classList.remove("error");
      msgEl.classList.add("ok");
    }
  }
}

// ── Registro de entrada ───────────────────────────────────

async function handleEntradaParqueadero(event) {
  event.preventDefault();

  const placaEl = document.getElementById("pq-placa");
  const servicioEl = document.getElementById("pq-servicio");
  const tipoEl = document.getElementById("pq-tipo");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");
  const propEl = document.getElementById("pq-es-propietario");
  const obsEl = document.getElementById("pq-obs");
  const msgEl = document.getElementById("pq-msg");

  msgEl.hidden = true;
  msgEl.textContent = "";

  const placa = placaEl.value.trim().toUpperCase().replace(/\s+/g, "");
  const tipo_servicio = servicioEl?.value || "OCASIONAL_HORA";
  const tipo_vehiculo = tipoEl.value.trim().toUpperCase();
  const nombre_cliente = nombreEl.value.trim().toUpperCase();
  const telefono = telEl.value.trim();
  const es_propietario = propEl.checked;
  const observaciones = obsEl.value.trim().toUpperCase();

  if (!placa || !tipo_vehiculo) {
    msgEl.textContent = "Placa y tipo de vehículo son obligatorios.";
    msgEl.hidden = false;
    msgEl.classList.remove("ok");
    msgEl.classList.add("error");
    return;
  }

  const evidenciaEl = document.getElementById("pq-evidencia");
  const evidenciaFile = evidenciaEl?.files?.[0] || null;

  try {
    const formData = new FormData();
    formData.append("placa", placa);
    formData.append("tipo_vehiculo", tipo_vehiculo);
    formData.append("tipo_servicio", tipo_servicio);
    formData.append("es_conductor_propietario", String(es_propietario));
    formData.append("observaciones", observaciones || "");
    formData.append("propietario_nombre", nombre_cliente);
    formData.append("propietario_telefono", telefono || "");
    formData.append("propietario_documento", "SIN_DOCUMENTO");

    if (!es_propietario) {
      formData.append("conductor_nombre", nombre_cliente);
      formData.append("conductor_telefono", telefono || "");
      formData.append("conductor_documento", "SIN_DOCUMENTO");
    }
    if (evidenciaFile) formData.append("evidencia", evidenciaFile);

    await apiFetch("/api/parqueadero/entrada", { method: "POST", body: formData });

    msgEl.textContent = "Entrada registrada correctamente.";
    msgEl.hidden = false;
    msgEl.classList.remove("error");
    msgEl.classList.add("ok");

    placaEl.value = "";
    if (servicioEl) servicioEl.value = tipo_servicio === "MENSUALIDAD" ? "MENSUALIDAD" : "OCASIONAL_HORA";
    tipoEl.value = "CARRO";
    nombreEl.value = "";
    telEl.value = "";
    obsEl.value = "";
    if (evidenciaEl) evidenciaEl.value = "";
    propEl.checked = true;

    await cargarParqueaderoActivo();
    await cargarMensualidadesParqueadero();
  } catch (err) {
    console.error("Error en handleEntradaParqueadero:", err);
    msgEl.textContent = err.message || "Error registrando entrada.";
    msgEl.hidden = false;
    msgEl.classList.remove("ok");
    msgEl.classList.add("error");
  }
}

// ── Cargar activos ────────────────────────────────────────

async function cargarParqueaderoActivo() {
  const tbody = document.getElementById("pq-tbody");
  const empty = document.getElementById("pq-empty");
  if (!tbody || !empty) return;

  try {
    const data = await apiFetch("/api/parqueadero/activo");
    tbody.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      empty.style.display = "block";
      empty.innerText = "No hay vehículos registrados actualmente.";
      return;
    }

    empty.style.display = "none";
    data.forEach((item) => {
      const tr = document.createElement("tr");
      tr.dataset.id = item.id;
      tr.innerHTML = `
        <td>${item.placa}</td>
        <td>${item.tipo_vehiculo}</td>
        <td>${servicioParqueaderoLabel(item.tipo_servicio)}</td>
        <td>${item.nombre_cliente || "-"}</td>
        <td>${new Date(item.hora_entrada).toLocaleString()}</td>
        <td>-</td>
        <td><button class="btn btn-success btn-sm pq-salida">Registrar salida</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Error cargando parqueadero:", e);
    empty.style.display = "block";
    empty.innerText = "Error cargando datos del parqueadero.";
  }
}

// ── Historial ─────────────────────────────────────────────

async function cargarHistorialParqueadero() {
  const tbody = document.getElementById("pq-historial-tbody");
  const empty = document.getElementById("pq-historial-empty");
  if (!tbody || !empty) return;

  try {
    const data = await apiFetch("/api/parqueadero/historial?limit=50");
    const busqueda = document.getElementById("pq-historial-buscar")?.value.trim().toLowerCase() || "";
    const dataFiltrada = busqueda
      ? data.filter((item) =>
          `${item.placa || ""} ${item.tipo_vehiculo || ""} ${item.nombre_cliente || ""}`.toLowerCase().includes(busqueda)
        )
      : data;

    tbody.innerHTML = "";
    if (!Array.isArray(dataFiltrada) || dataFiltrada.length === 0) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    tbody.innerHTML = dataFiltrada.map((item) => `
      <tr>
        <td>${item.placa}</td>
        <td>${item.tipo_vehiculo}</td>
        <td>${servicioParqueaderoLabel(item.tipo_servicio)}</td>
        <td>${item.nombre_cliente || "-"}</td>
        <td>${formatDateTime(item.hora_entrada)}</td>
        <td>${formatDateTime(item.hora_salida)}</td>
        <td>${item.minutos_total ? formatDuration(item.hora_entrada, item.hora_salida) : "-"}</td>
        <td>${formatMoney(item.valor_total || 0)}</td>
        <td>${renderBadge(item.metodo_pago, "payment")}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Error cargando historial de parqueadero:", err);
    empty.hidden = false;
    empty.textContent = "Error cargando historial de parqueadero.";
  }
}

// ── Mensualidades ─────────────────────────────────────────

async function handleNuevaMensualidadParqueadero(event) {
  event.preventDefault();

  const payload = {
    nombre_cliente: document.getElementById("pq-men-nombre").value.trim(),
    documento: document.getElementById("pq-men-documento").value.trim(),
    telefono: document.getElementById("pq-men-telefono").value.trim(),
    correo: document.getElementById("pq-men-correo").value.trim(),
    direccion: document.getElementById("pq-men-direccion").value.trim(),
    contacto_emergencia: document.getElementById("pq-men-emergencia").value.trim(),
    placa: document.getElementById("pq-men-placa").value.trim().toUpperCase().replace(/\s+/g, ""),
    tipo_vehiculo: document.getElementById("pq-men-tipo").value,
    marca: document.getElementById("pq-men-marca").value.trim(),
    modelo: document.getElementById("pq-men-modelo").value.trim(),
    color: document.getElementById("pq-men-color").value.trim(),
    fecha_inicio: document.getElementById("pq-men-inicio").value,
    fecha_fin: document.getElementById("pq-men-fin").value,
    valor_mensual: Number(document.getElementById("pq-men-valor").value || 0),
    observaciones: document.getElementById("pq-men-obs").value.trim(),
  };

  if (!payload.nombre_cliente || !payload.documento || !payload.placa || !payload.fecha_inicio || !payload.fecha_fin) {
    showMessage("pq-men-msg", "Complete nombre, documento, placa e intervalo de la mensualidad.", true);
    return;
  }

  try {
    await apiFetch("/api/parqueadero/mensualidades", { method: "POST", body: JSON.stringify(payload) });
    showMessage("pq-men-msg", "Mensualidad registrada correctamente.");
    event.target.reset();
    setMensualidadFechasDefecto();
    await cargarMensualidadesParqueadero();
  } catch (err) {
    showMessage("pq-men-msg", err.message, true);
  }
}

async function cargarMensualidadesParqueadero() {
  const tbody = document.getElementById("pq-mensualidades-tbody");
  const empty = document.getElementById("pq-mensualidades-empty");
  if (!tbody || !empty) return;

  setMensualidadFechasDefecto();

  try {
    const data = await apiFetch("/api/parqueadero/mensualidades?incluir_inactivas=true");
    tbody.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    tbody.innerHTML = data.map((item) => `
      <tr>
        <td>${item.nombre_cliente || "-"}</td>
        <td>${item.placa}</td>
        <td>${item.tipo_vehiculo}</td>
        <td>${new Date(item.fecha_inicio).toLocaleDateString()} - ${new Date(item.fecha_fin).toLocaleDateString()}</td>
        <td>${formatMoney(item.valor_mensual || 0)}</td>
        <td>${item.ingresos_registrados || 0}</td>
        <td>${renderBadge(item.estado)}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Error cargando mensualidades:", err);
    empty.hidden = false;
    empty.textContent = "Error cargando mensualidades.";
  }
}

// ── Modal de salida ───────────────────────────────────────

async function handleSalidaClick(event) {
  const btn = event.target.closest(".pq-salida");
  if (!btn) return;

  const tr = btn.closest("tr");
  registroId = tr?.dataset.id;
  if (!registroId) return;

  try {
    const preCalculo = await apiFetch(`/api/parqueadero/${registroId}/pre-salida`, { method: "POST" });
    datosPreSalida = preCalculo;

    document.getElementById("salida-placa").textContent = preCalculo.placa || "—";
    document.getElementById("salida-tipo").textContent = preCalculo.tipo_vehiculo || "—";
    document.getElementById("salida-cliente").textContent = preCalculo.cliente || "—";
    document.getElementById("salida-hora-entrada").textContent = preCalculo.hora_entrada || "—";
    document.getElementById("salida-hora-salida").textContent = preCalculo.hora_salida || "—";
    document.getElementById("salida-tiempo").textContent = preCalculo.tiempo_estancia || "—";
    document.getElementById("salida-tarifa").textContent = preCalculo.tarifa_aplicada || "—";

    if (preCalculo.descuento !== "No aplica") {
      document.getElementById("salida-descuento-info").hidden = false;
      document.getElementById("salida-valor-antes-info").hidden = false;
      document.getElementById("salida-descuento").textContent = preCalculo.descuento;
      document.getElementById("salida-valor-antes").textContent = `$${preCalculo.valor_antes_descuento.toLocaleString("es-CO")} COP`;
    } else {
      document.getElementById("salida-descuento-info").hidden = true;
      document.getElementById("salida-valor-antes-info").hidden = true;
    }

    document.getElementById("salida-valor").textContent = `$${preCalculo.valor_a_cobrar.toLocaleString("es-CO")} COP`;
    document.getElementById("pq-metodo-pago").value = preCalculo.tipo_servicio === "MENSUALIDAD" ? "MENSUALIDAD" : "";
    document.getElementById("pq-referencia").value = "";
    document.getElementById("pq-detalle-pago").value = "";
    document.getElementById("pq-obs-salida").value = "";

    configureSalidaMonto({
      total: Number(preCalculo.valor_a_cobrar || 0),
      esMensualidad: preCalculo.tipo_servicio === "MENSUALIDAD",
    });
    actualizarCamposPagoServicio("pq-metodo-pago", "pq-referencia-group", "pq-detalle-pago-group");

    document.getElementById("edit-placa").value = preCalculo.placa || "";
    document.getElementById("edit-cliente").value = preCalculo.cliente || "";
    document.getElementById("edit-tipo").value = preCalculo.tipo_vehiculo || "";
    document.getElementById("salida-editar").hidden = true;

    document.getElementById("modal-salida").classList.remove("hidden");
  } catch (err) {
    console.error("Error obteniendo pre-salida:", err);
    alert(err.message || "Error calculando salida.");
  }
}

function cerrarModalSalida() {
  document.getElementById("modal-salida").classList.add("hidden");
  datosPreSalida = null;
  registroId = null;
}

function toggleEditarRegistro() {
  const seccionEditar = document.getElementById("salida-editar");
  seccionEditar.hidden = !seccionEditar.hidden;
}

async function guardarEdicionRegistro() {
  if (!registroId) return;

  const cambios = {};
  const placanueva = document.getElementById("edit-placa").value.trim();
  if (placanueva && placanueva !== datosPreSalida.placa) cambios.placa = placanueva;
  const clientenuevo = document.getElementById("edit-cliente").value.trim();
  if (clientenuevo && clientenuevo !== datosPreSalida.cliente) cambios.nombre_cliente = clientenuevo;
  const tiponuevo = document.getElementById("edit-tipo").value.trim();
  if (tiponuevo && tiponuevo !== datosPreSalida.tipo_vehiculo) cambios.tipo_vehiculo = tiponuevo;

  if (Object.keys(cambios).length === 0) { alert("No hay cambios para guardar."); return; }

  try {
    await apiFetch(`/api/parqueadero/${registroId}`, { method: "PATCH", body: JSON.stringify(cambios) });
    alert("Registro actualizado exitosamente.");

    const preCalculo = await apiFetch(`/api/parqueadero/${registroId}/pre-salida`, { method: "POST" });
    datosPreSalida = preCalculo;

    document.getElementById("salida-placa").textContent = preCalculo.placa || "—";
    document.getElementById("salida-tipo").textContent = preCalculo.tipo_vehiculo || "—";
    document.getElementById("salida-cliente").textContent = preCalculo.cliente || "—";
    document.getElementById("salida-valor").textContent = `$${Number(preCalculo.valor_a_cobrar || 0).toLocaleString("es-CO")} COP`;
    configureSalidaMonto({
      total: Number(preCalculo.valor_a_cobrar || 0),
      esMensualidad: preCalculo.tipo_servicio === "MENSUALIDAD",
    });
    document.getElementById("salida-editar").hidden = true;
  } catch (err) {
    console.error("Error actualizando registro:", err);
    alert(err.message || "Error actualizando registro.");
  }
}

async function confirmarSalida() {
  if (!registroId || !datosPreSalida) { alert("Error: datos no disponibles."); return; }

  const metodoPago = document.getElementById("pq-metodo-pago").value.trim();
  const totalCobro = Number(datosPreSalida.valor_a_cobrar || 0);
  const esMensualidad = String(datosPreSalida.tipo_servicio || "").toUpperCase() === "MENSUALIDAD";
  const requiereCobro = !esMensualidad && totalCobro > 0;
  const montoPago = Number(document.getElementById("pq-monto-pago")?.value || 0);

  if (requiereCobro && !metodoPago) { alert("Debe seleccionar un método de pago."); return; }
  if (requiereCobro && (!Number.isFinite(montoPago) || montoPago <= 0)) {
    alert("Debe ingresar un monto válido para registrar el cobro.");
    return;
  }
  if (requiereCobro && montoPago - totalCobro > 0.01) {
    alert("El monto a registrar no puede superar el valor pendiente.");
    return;
  }

  const referencia = document.getElementById("pq-referencia").value.trim() || null;
  const detallePago = document.getElementById("pq-detalle-pago").value.trim() || null;
  const observacionesSalida = document.getElementById("pq-obs-salida").value.trim() || null;

  try {
    const payload = { referencia_transaccion: referencia, detalle_pago: detallePago, observaciones: observacionesSalida };
    if (metodoPago) payload.metodo_pago = metodoPago;
    if (requiereCobro) payload.monto_pago = montoPago;

    const response = await apiFetch(`/api/parqueadero/salida/${registroId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    alert(response?.mensaje || "✓ Salida registrada correctamente.");
    cerrarModalSalida();
    await cargarParqueaderoActivo();
    await cargarHistorialParqueadero();
    await cargarMensualidadesParqueadero();
    await loadDashboard();
  } catch (err) {
    console.error("Error registrando salida:", err);
    alert(err.message || "Error registrando salida.");
  }
}
