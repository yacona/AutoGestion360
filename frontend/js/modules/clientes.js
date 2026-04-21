/* =========================================================
   CLIENTES — lista, perfil 360, vehículos, cartera, recibos
   Depende de: ui.js, api.js
   ========================================================= */

let clientesCache = [];
let clientePerfilSeleccionadoId = null;
let clientePerfilActual = null;
let vehiculoPerfilActual = null;
let reciboActual = null;

// ── Helpers de estado ─────────────────────────────────────

function toClientNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatClientDate(value, fallback = "Sin actividad") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });
}

function formatClientDateRange(start, end) {
  return `${formatClientDate(start, "Sin inicio")} a ${formatClientDate(end, "Sin fin")}`;
}

function getClientInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "--";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getClientStatus(cliente = {}) {
  const servicios = toClientNumber(cliente.total_servicios);
  const gasto = toClientNumber(cliente.total_gastado);
  if (servicios >= 10 || gasto >= 500000) return { label: "Frecuente", className: "badge-success" };
  if (servicios > 0) return { label: "Activo", className: "badge-info" };
  return { label: "Nuevo", className: "badge-muted" };
}

function getModuleBadgeClass(tipo) {
  const n = String(tipo || "").toLowerCase();
  if (n.includes("parqueadero")) return "badge-info";
  if (n.includes("lavadero")) return "badge-teal";
  if (n.includes("taller")) return "badge-warning";
  return "badge-muted";
}

function getMensualidadStatus(mensualidad = {}) {
  const estado = String(mensualidad.estado || "").toUpperCase();
  const fin = mensualidad.fecha_fin ? new Date(mensualidad.fecha_fin) : null;
  const vencida = fin && !Number.isNaN(fin.getTime()) && fin < new Date();
  if (estado === "ACTIVA" && !vencida) return { label: "Activa", className: "badge-success" };
  if (vencida) return { label: "Vencida", className: "badge-danger" };
  return { label: estado || "Inactiva", className: "badge-muted" };
}

function getVehicleStatus(data = {}) {
  if (data.estado === "EN_PARQUEADERO") return { label: "En parqueadero", className: "badge-warning" };
  if (data.estado === "MENSUALIDAD_ACTIVA") return { label: "Mensualidad activa", className: "badge-success" };
  if (data.estado === "REGISTRADO") return { label: "Registrado", className: "badge-info" };
  return { label: "Sin registro", className: "badge-muted" };
}

function getWalletStatus(resumen = {}) {
  const pendiente = toClientNumber(resumen.total_pendiente);
  const enCurso = toClientNumber(resumen.total_en_curso);
  const abonado = toClientNumber(resumen.total_abonado);
  if (pendiente > 0) return abonado > 0 ? { label: "Con saldo", className: "badge-warning" } : { label: "Pendiente", className: "badge-danger" };
  if (enCurso > 0) return { label: "En curso", className: "badge-warning" };
  return { label: "Al día", className: "badge-success" };
}

// ── Lista de clientes ─────────────────────────────────────

async function handleNuevoCliente(event) {
  event.preventDefault();
  const nombre = document.getElementById("cli-nombre").value.trim();
  const documento = document.getElementById("cli-documento").value.trim();
  const telefono = document.getElementById("cli-telefono").value.trim();
  const email = document.getElementById("cli-email").value.trim();

  if (!nombre) { showMessage("cli-msg", "El nombre es obligatorio.", true); return; }

  try {
    await apiFetch("/api/clientes", {
      method: "POST",
      body: JSON.stringify({ nombre, documento: documento || null, telefono: telefono || null, correo: email || null }),
    });
    showMessage("cli-msg", "Cliente registrado exitosamente.");
    event.target.reset();
    await cargarListaClientes();
  } catch (err) {
    showMessage("cli-msg", err.message, true);
  }
}

async function cargarListaClientes() {
  try {
    const clientes = await apiFetch("/api/clientes");
    clientesCache = Array.isArray(clientes) ? clientes : [];
    renderClientesResumen(clientesCache);
    filtrarClientes();
  } catch (err) {
    console.error("Error cargando clientes:", err);
    showMessage("cli-msg", err.message || "Error cargando clientes.", true);
  }
}

function renderClientesResumen(clientes) {
  const totalClientes = clientes.length;
  const totalServicios = clientes.reduce((sum, cli) => sum + toClientNumber(cli.total_servicios), 0);
  const totalIngresos = clientes.reduce((sum, cli) => sum + toClientNumber(cli.total_gastado), 0);
  const ticketPromedio = totalServicios > 0 ? totalIngresos / totalServicios : 0;
  setElementText("cli-total-clientes", totalClientes);
  setElementText("cli-total-servicios", totalServicios);
  setElementText("cli-total-ingresos", formatMoney(totalIngresos));
  setElementText("cli-ticket-promedio", formatMoney(ticketPromedio));
}

function filtrarClientesPorTexto(term) {
  const query = String(term || "").trim().toLowerCase();
  if (!query) return clientesCache;
  return clientesCache.filter((cli) =>
    [cli.nombre, cli.documento, cli.telefono, cli.correo, cli.total_servicios, cli.total_gastado]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function renderClientesTable(clientes) {
  const tbody = document.getElementById("cli-lista-tbody");
  const empty = document.getElementById("cli-lista-empty");
  if (!tbody || !empty) return;

  tbody.innerHTML = clientes.map((cli) => {
    const status = getClientStatus(cli);
    const contacto = [cli.telefono, cli.correo].filter(Boolean).join(" · ") || "Sin contacto";
    return `
      <tr>
        <td>
          <div class="client-table-main">
            <span class="client-table-avatar">${escapeHtml(getClientInitials(cli.nombre))}</span>
            <div>
              <strong>${escapeHtml(cli.nombre || "Sin nombre")}</strong>
              <small>${escapeHtml(cli.documento || "Sin documento")}</small>
            </div>
          </div>
        </td>
        <td>${escapeHtml(contacto)}</td>
        <td>
          <strong>${toClientNumber(cli.total_servicios)}</strong>
          <small class="muted-inline">P ${toClientNumber(cli.total_parqueadero)} · L ${toClientNumber(cli.total_lavadero)} · T ${toClientNumber(cli.total_taller)}</small>
        </td>
        <td>${formatMoney(toClientNumber(cli.total_gastado))}</td>
        <td>${formatClientDate(cli.ultima_actividad || cli.fecha_registro)}</td>
        <td><span class="badge ${status.className}">${status.label}</span></td>
        <td><button type="button" class="btn btn-sm btn-secondary" data-cliente-action="ver-perfil" data-cliente-id="${Number(cli.id)}">Ver perfil</button></td>
      </tr>
    `;
  }).join("");

  empty.hidden = clientes.length > 0;
  setElementText("cli-lista-count", `${clientes.length} cliente(s)`);
}

function filtrarClientes() {
  const buscar = document.getElementById("cli-buscar")?.value || "";
  renderClientesTable(filtrarClientesPorTexto(buscar));
}

// ── Perfil de cliente ─────────────────────────────────────

function cerrarPerfilCliente() {
  clientePerfilSeleccionadoId = null;
  clientePerfilActual = null;
  cerrarVehiculo360();
  cerrarClienteActionPanels();
  const panel = document.getElementById("cli-perfil-panel");
  if (panel) panel.hidden = true;
}

function getClientePerfilActual() {
  return clientePerfilActual?.cliente || null;
}

function setClienteActionMessage(message, isError = false) {
  showMessage("cli-action-msg", message, isError);
}

function cerrarClienteActionPanels() {
  document.querySelectorAll(".client-action-panel").forEach((panel) => (panel.hidden = true));
  document.querySelectorAll(".client-profile-actions .btn").forEach((btn) => btn.classList.remove("active"));
}

function setClienteActionButton(action, active) {
  const buttons = { editar: "cli-action-editar", vehiculo: "cli-action-vehiculo", mensualidad: "cli-action-mensualidad" };
  document.getElementById(buttons[action])?.classList.toggle("active", active);
}

function abrirClienteActionPanel(action) {
  if (!getClientePerfilActual()) {
    setClienteActionMessage("Selecciona un cliente para usar las acciones rápidas.", true);
    return;
  }

  const panels = { editar: "form-cli-editar", vehiculo: "form-cli-vehiculo", mensualidad: "form-cli-mensualidad" };
  const panel = document.getElementById(panels[action]);
  if (!panel) return;

  const alreadyOpen = !panel.hidden;
  cerrarClienteActionPanels();
  if (alreadyOpen) return;

  if (action === "editar") prepararFormularioEditarCliente360();
  if (action === "vehiculo") prepararFormularioVehiculoCliente360();
  if (action === "mensualidad") prepararFormularioMensualidadCliente360();

  panel.hidden = false;
  setClienteActionButton(action, true);
  const msg = document.getElementById("cli-action-msg");
  if (msg) msg.hidden = true;
}

function prepararFormularioEditarCliente360() {
  const cliente = getClientePerfilActual();
  if (!cliente) return;
  document.getElementById("cli-edit-nombre").value = cliente.nombre || "";
  document.getElementById("cli-edit-documento").value = cliente.documento || "";
  document.getElementById("cli-edit-telefono").value = cliente.telefono || "";
  document.getElementById("cli-edit-correo").value = cliente.correo || "";
}

function prepararFormularioVehiculoCliente360() {
  document.getElementById("form-cli-vehiculo")?.reset();
  const tipoEl = document.getElementById("cli-veh-tipo");
  if (tipoEl) tipoEl.value = "CARRO";
}

function prepararFormularioMensualidadCliente360() {
  const cliente = getClientePerfilActual();
  const vehiculos = Array.isArray(clientePerfilActual?.vehiculos) ? clientePerfilActual.vehiculos : [];
  const form = document.getElementById("form-cli-mensualidad");
  const select = document.getElementById("cli-men-vehiculo");
  const hoy = new Date();
  const fin = new Date(hoy);
  fin.setMonth(fin.getMonth() + 1);

  form?.reset();

  if (select) {
    select.innerHTML = `
      <option value="">Ingresar placa manualmente</option>
      ${vehiculos.map((v) => `
        <option value="${escapeHtml(v.placa || "")}" data-tipo="${escapeHtml(v.tipo_vehiculo || "CARRO")}" data-marca="${escapeHtml(v.marca || "")}" data-modelo="${escapeHtml(v.modelo || "")}" data-color="${escapeHtml(v.color || "")}">
          ${escapeHtml(v.placa || "Sin placa")} · ${escapeHtml(v.tipo_vehiculo || "Vehículo")}
        </option>
      `).join("")}
    `;
  }

  document.getElementById("cli-men-documento").value = cliente?.documento || "";
  document.getElementById("cli-men-inicio").value = formatDateParam(hoy);
  document.getElementById("cli-men-fin").value = formatDateParam(fin);
  document.getElementById("cli-men-tipo").value = "CARRO";

  if (vehiculos.length > 0 && select) {
    select.value = vehiculos[0].placa || "";
    sincronizarVehiculoMensualidadCliente();
  }
}

function sincronizarVehiculoMensualidadCliente() {
  const select = document.getElementById("cli-men-vehiculo");
  const option = select?.selectedOptions?.[0];
  if (!select || !option || !select.value) return;
  const placaEl = document.getElementById("cli-men-placa");
  const tipoEl = document.getElementById("cli-men-tipo");
  if (placaEl) placaEl.value = select.value;
  if (tipoEl) tipoEl.value = option.dataset.tipo || "CARRO";
}

async function refrescarCliente360Actual(message) {
  const id = clientePerfilSeleccionadoId || clientePerfilActual?.cliente?.id;
  if (!id) return;
  await cargarListaClientes();
  await verDetallesCliente(id);
  cerrarClienteActionPanels();
  if (message) setClienteActionMessage(message);
}

// ── Acciones sobre el cliente ─────────────────────────────

async function handleEditarCliente360(event) {
  event.preventDefault();
  const cliente = getClientePerfilActual();
  if (!cliente) return;

  const nombre = document.getElementById("cli-edit-nombre").value.trim();
  if (!nombre) { setClienteActionMessage("El nombre es obligatorio.", true); return; }

  try {
    await apiFetch(`/api/clientes/${cliente.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        nombre,
        documento: document.getElementById("cli-edit-documento").value.trim() || null,
        telefono: document.getElementById("cli-edit-telefono").value.trim() || null,
        correo: document.getElementById("cli-edit-correo").value.trim() || null,
      }),
    });
    await refrescarCliente360Actual("Cliente actualizado correctamente.");
  } catch (err) {
    setClienteActionMessage(err.message || "No se pudo actualizar el cliente.", true);
  }
}

async function handleAgregarVehiculoCliente360(event) {
  event.preventDefault();
  const cliente = getClientePerfilActual();
  if (!cliente) return;

  const placa = document.getElementById("cli-veh-placa").value.trim().toUpperCase();
  const tipo = document.getElementById("cli-veh-tipo").value;
  if (!placa || !tipo) { setClienteActionMessage("Placa y tipo son obligatorios.", true); return; }

  try {
    await apiFetch("/api/vehiculos", {
      method: "POST",
      body: JSON.stringify({
        cliente_id: cliente.id, placa, tipo, tipo_vehiculo: tipo,
        marca: document.getElementById("cli-veh-marca").value.trim() || null,
        modelo: document.getElementById("cli-veh-modelo").value.trim() || null,
        color: document.getElementById("cli-veh-color").value.trim() || null,
      }),
    });
    await refrescarCliente360Actual("Vehículo agregado correctamente.");
  } catch (err) {
    setClienteActionMessage(err.message || "No se pudo agregar el vehículo.", true);
  }
}

function getVehiculoMensualidadSeleccionado() {
  const select = document.getElementById("cli-men-vehiculo");
  const option = select?.selectedOptions?.[0];
  if (!select?.value || !option) return {};
  return { marca: option.dataset.marca || null, modelo: option.dataset.modelo || null, color: option.dataset.color || null };
}

async function handleCrearMensualidadCliente360(event) {
  event.preventDefault();
  const cliente = getClientePerfilActual();
  if (!cliente) return;

  const documento = document.getElementById("cli-men-documento").value.trim();
  const placa = document.getElementById("cli-men-placa").value.trim().toUpperCase();
  const tipo_vehiculo = document.getElementById("cli-men-tipo").value;
  const fecha_inicio = document.getElementById("cli-men-inicio").value;
  const fecha_fin = document.getElementById("cli-men-fin").value;
  const valor_mensual = Number(document.getElementById("cli-men-valor").value || 0);

  if (!documento || !placa || !tipo_vehiculo || !fecha_inicio || !fecha_fin) {
    setClienteActionMessage("Documento, placa, tipo, inicio y fin son obligatorios.", true);
    return;
  }
  if (!Number.isFinite(valor_mensual) || valor_mensual < 0) {
    setClienteActionMessage("El valor mensual no es válido.", true);
    return;
  }

  const vehiculoSeleccionado = getVehiculoMensualidadSeleccionado();

  try {
    await apiFetch("/api/parqueadero/mensualidades", {
      method: "POST",
      body: JSON.stringify({
        nombre_cliente: cliente.nombre, documento,
        telefono: cliente.telefono || null, correo: cliente.correo || null,
        direccion: document.getElementById("cli-men-direccion").value.trim() || null,
        contacto_emergencia: document.getElementById("cli-men-contacto").value.trim() || null,
        placa, tipo_vehiculo,
        marca: vehiculoSeleccionado.marca, modelo: vehiculoSeleccionado.modelo, color: vehiculoSeleccionado.color,
        fecha_inicio, fecha_fin, valor_mensual,
        observaciones: document.getElementById("cli-men-obs").value.trim() || null,
      }),
    });
    if (typeof cargarMensualidadesParqueadero === "function") cargarMensualidadesParqueadero();
    await refrescarCliente360Actual("Mensualidad creada correctamente.");
  } catch (err) {
    setClienteActionMessage(err.message || "No se pudo crear la mensualidad.", true);
  }
}

// ── Perfil renderizado ────────────────────────────────────

function renderClientePerfilLoading() {
  clientePerfilActual = null;
  cerrarVehiculo360();
  cerrarClienteActionPanels();
  const panel = document.getElementById("cli-perfil-panel");
  if (!panel) return;
  panel.hidden = false;
  setElementText("cli-perfil-iniciales", "...");
  setElementText("cli-perfil-badge", "Cargando");
  const badge = document.getElementById("cli-perfil-badge");
  if (badge) badge.className = "badge badge-muted";
  setElementText("cli-perfil-nombre", "Cargando perfil");
  setElementText("cli-perfil-contacto", "Consultando información del cliente...");
  setElementText("cli-perfil-total", formatMoney(0));
  setElementText("cli-perfil-servicios", "0");
  setElementText("cli-perfil-vehiculos", "0");
  setElementText("cli-perfil-ultima", "Sin actividad");
  ["cli-vehiculos-grid", "cli-mensualidades-tbody", "cli-historial-tbody"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  renderClienteCarteraLoading();
}

function renderClienteVehiculos(vehiculos = []) {
  const grid = document.getElementById("cli-vehiculos-grid");
  const empty = document.getElementById("cli-vehiculos-empty");
  if (!grid || !empty) return;
  grid.innerHTML = vehiculos.map((v) => {
    const placa = v.placa || "";
    return `
      <article class="client-vehicle-item">
        <div>
          <strong>${escapeHtml(placa || "Sin placa")}</strong>
          <span>${escapeHtml([v.tipo_vehiculo, v.marca, v.modelo].filter(Boolean).join(" · ") || "Sin detalle")}</span>
        </div>
        <div class="client-vehicle-meta">
          <span class="badge badge-muted">${toClientNumber(v.total_servicios)} servicios</span>
          <strong>${formatMoney(toClientNumber(v.total_gastado))}</strong>
          <button type="button" class="btn btn-sm btn-secondary" data-cliente-action="ver-vehiculo" data-vehiculo-placa="${encodeURIComponent(placa)}">Ver 360</button>
        </div>
      </article>
    `;
  }).join("");
  empty.hidden = vehiculos.length > 0;
}

function renderClienteMensualidades(mensualidades = []) {
  const tbody = document.getElementById("cli-mensualidades-tbody");
  const empty = document.getElementById("cli-mensualidades-empty");
  if (!tbody || !empty) return;
  tbody.innerHTML = mensualidades.map((m) => {
    const status = getMensualidadStatus(m);
    return `
      <tr>
        <td>${escapeHtml(m.placa || "Sin placa")}</td>
        <td>${escapeHtml(formatClientDateRange(m.fecha_inicio, m.fecha_fin))}</td>
        <td>${formatMoney(toClientNumber(m.valor_mensual))}</td>
        <td><span class="badge ${status.className}">${escapeHtml(status.label)}</span></td>
      </tr>
    `;
  }).join("");
  empty.hidden = mensualidades.length > 0;
}

function renderClienteHistorial(historial = []) {
  const tbody = document.getElementById("cli-historial-tbody");
  const empty = document.getElementById("cli-historial-empty");
  if (!tbody || !empty) return;
  tbody.innerHTML = historial.map((item) => `
    <tr>
      <td>${formatDateTime(item.fecha)}</td>
      <td><span class="badge ${getModuleBadgeClass(item.tipo)}">${escapeHtml(item.tipo || "Servicio")}</span></td>
      <td>${escapeHtml(item.placa || "N/A")}</td>
      <td>${escapeHtml(item.detalle || "Movimiento registrado")}</td>
      <td>${formatMoney(toClientNumber(item.monto))}</td>
      <td>${escapeHtml(item.metodo_pago || "N/A")}</td>
      <td>${escapeHtml(item.estado || "Registrado")}</td>
    </tr>
  `).join("");
  empty.hidden = historial.length > 0;
}

function renderClientePerfil(data = {}) {
  clientePerfilActual = data;
  const cliente = data.cliente || {};
  const estadisticas = data.estadisticas || {};
  const modulos = estadisticas.modulos || {};
  const vehiculos = Array.isArray(data.vehiculos) ? data.vehiculos : [];
  const historial = Array.isArray(data.historial) ? data.historial : [];
  const mensualidades = Array.isArray(data.mensualidades) ? data.mensualidades : [];
  const status = getClientStatus({ ...cliente, total_servicios: estadisticas.total_servicios, total_gastado: estadisticas.total_gastado });
  const contacto = [
    cliente.documento ? `Doc. ${cliente.documento}` : null,
    cliente.telefono, cliente.correo,
  ].filter(Boolean).join(" · ") || "Sin contacto registrado";

  setElementText("cli-perfil-iniciales", getClientInitials(cliente.nombre));
  setElementText("cli-perfil-badge", status.label);
  const badge = document.getElementById("cli-perfil-badge");
  if (badge) badge.className = `badge ${status.className}`;
  setElementText("cli-perfil-nombre", cliente.nombre || "Cliente sin nombre");
  setElementText("cli-perfil-contacto", contacto);
  setElementText("cli-perfil-total", formatMoney(toClientNumber(estadisticas.total_gastado)));
  setElementText("cli-perfil-servicios", toClientNumber(estadisticas.total_servicios));
  setElementText("cli-perfil-vehiculos", toClientNumber(estadisticas.vehiculos_total));
  setElementText("cli-perfil-ultima", formatClientDate(estadisticas.ultima_visita));
  setElementText("cli-perfil-parqueadero", formatMoney(toClientNumber(modulos.parqueadero?.ingresos)));
  setElementText("cli-perfil-parqueadero-count", `${toClientNumber(modulos.parqueadero?.servicios)} servicios`);
  setElementText("cli-perfil-lavadero", formatMoney(toClientNumber(modulos.lavadero?.ingresos)));
  setElementText("cli-perfil-lavadero-count", `${toClientNumber(modulos.lavadero?.servicios)} servicios`);
  setElementText("cli-perfil-taller", formatMoney(toClientNumber(modulos.taller?.ingresos)));
  setElementText("cli-perfil-taller-count", `${toClientNumber(modulos.taller?.servicios)} servicios`);
  setElementText("cli-perfil-mensualidades", `${toClientNumber(estadisticas.mensualidades_activas)} activas`);
  setElementText("cli-perfil-mensualidades-count", `${toClientNumber(estadisticas.mensualidades_total)} registradas`);

  renderClienteVehiculos(vehiculos);
  renderClienteMensualidades(mensualidades);
  renderClienteHistorial(historial);
  cargarCarteraCliente360(cliente.id);
}

async function verDetallesCliente(id) {
  clientePerfilSeleccionadoId = id;
  renderClientePerfilLoading();
  try {
    const data = await apiFetch(`/api/clientes/${id}`);
    if (clientePerfilSeleccionadoId !== id) return;
    renderClientePerfil(data);
    document.getElementById("cli-perfil-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showMessage("cli-msg", "Error cargando detalles: " + err.message, true);
    cerrarPerfilCliente();
  }
}

// ── Vehículo 360 ──────────────────────────────────────────

function getVehiculoPerfilActual() { return vehiculoPerfilActual || null; }
function getVehiculoPerfilPlaca() {
  const data = getVehiculoPerfilActual();
  return data?.vehiculo?.placa || data?.placa || "";
}

function cerrarVehiculo360() {
  vehiculoPerfilActual = null;
  const panel = document.getElementById("vehiculo-360-panel");
  if (panel) panel.hidden = true;
}

function renderVehiculo360Loading(placa) {
  const panel = document.getElementById("vehiculo-360-panel");
  if (!panel) return;
  panel.hidden = false;
  setElementText("veh360-placa", placa || "---");
  setElementText("veh360-tipo", "Consultando");
  setElementText("veh360-estado", "Cargando");
  const badge = document.getElementById("veh360-estado");
  if (badge) badge.className = "badge badge-muted";
  ["veh360-detalle","veh360-propietario","veh360-contacto","veh360-mensualidad"].forEach((id) =>
    setElementText(id, id === "veh360-mensualidad" ? "Sin plan" : id === "veh360-propietario" ? "Sin propietario" : id === "veh360-contacto" ? "Sin contacto registrado" : "Consultando...")
  );
  [
    "veh360-total","veh360-pagado","veh360-pendiente","veh360-en-curso","veh360-recurrente",
    "veh360-parqueadero","veh360-lavadero","veh360-taller",
  ].forEach((id) => setElementText(id, formatMoney(0)));
  setElementText("veh360-servicios", "0");
  setElementText("veh360-ultima", "Sin actividad");
  setElementText("veh360-parqueadero-count", "0 servicios");
  setElementText("veh360-lavadero-count", "0 servicios");
  setElementText("veh360-taller-count", "0 servicios");
  const tbody = document.getElementById("veh360-historial-tbody");
  if (tbody) tbody.innerHTML = "";
}

function renderVehiculo360Historial(historial = []) {
  const tbody = document.getElementById("veh360-historial-tbody");
  const empty = document.getElementById("veh360-historial-empty");
  if (!tbody || !empty) return;
  tbody.innerHTML = historial.map((item) => `
    <tr>
      <td>${formatDateTime(item.fecha)}</td>
      <td><span class="badge ${getModuleBadgeClass(item.tipo)}">${escapeHtml(item.tipo || "Servicio")}</span></td>
      <td>${escapeHtml(item.detalle || "Movimiento registrado")}</td>
      <td>${formatMoney(toClientNumber(item.monto))}</td>
      <td>${renderBadge(item.estado || "Registrado")}</td>
    </tr>
  `).join("");
  empty.hidden = historial.length > 0;
}

function renderVehiculo360(data = {}) {
  vehiculoPerfilActual = data;
  const vehiculo = data.vehiculo || {};
  const propietario = data.propietario || {};
  const estadisticas = data.estadisticas || {};
  const modulos = estadisticas.modulos || {};
  const mensualidad = data.mensualidad || null;
  const status = getVehicleStatus(data);
  const detalle = [vehiculo.marca, vehiculo.modelo, vehiculo.color].filter(Boolean).join(" · ") || "Sin detalle técnico registrado";
  const contacto = [
    propietario.documento ? `Doc. ${propietario.documento}` : null,
    propietario.telefono, propietario.correo,
  ].filter(Boolean).join(" · ") || "Sin contacto registrado";

  setElementText("veh360-placa", vehiculo.placa || data.placa || "---");
  setElementText("veh360-tipo", vehiculo.tipo_vehiculo || "Vehículo");
  setElementText("veh360-estado", status.label);
  const badge = document.getElementById("veh360-estado");
  if (badge) badge.className = `badge ${status.className}`;
  setElementText("veh360-detalle", detalle);
  setElementText("veh360-total", formatMoney(toClientNumber(estadisticas.total_gastado)));
  setElementText("veh360-servicios", toClientNumber(estadisticas.total_servicios));
  setElementText("veh360-ultima", formatClientDate(estadisticas.ultima_actividad));
  setElementText("veh360-mensualidad",
    mensualidad ? `${formatMoney(toClientNumber(mensualidad.valor_mensual))} · ${toClientNumber(mensualidad.dias_restantes)} día(s)` : "Sin plan"
  );
  setElementText("veh360-propietario", propietario.nombre || "Sin propietario");
  setElementText("veh360-contacto", contacto);
  setElementText("veh360-parqueadero", formatMoney(toClientNumber(modulos.parqueadero?.ingresos)));
  setElementText("veh360-parqueadero-count", `${toClientNumber(modulos.parqueadero?.servicios)} servicios`);
  setElementText("veh360-lavadero", formatMoney(toClientNumber(modulos.lavadero?.ingresos)));
  setElementText("veh360-lavadero-count", `${toClientNumber(modulos.lavadero?.servicios)} servicios`);
  setElementText("veh360-taller", formatMoney(toClientNumber(modulos.taller?.ingresos)));
  setElementText("veh360-taller-count", `${toClientNumber(modulos.taller?.servicios)} servicios`);

  renderVehiculo360Historial(Array.isArray(data.historial) ? data.historial : []);
  cargarCarteraVehiculo360(vehiculo.placa || data.placa);
}

async function verVehiculo360(placaEncoded) {
  const placa = decodeURIComponent(String(placaEncoded || "")).trim().toUpperCase();
  if (!placa) return;
  renderVehiculo360Loading(placa);
  try {
    const data = await apiFetch(`/api/vehiculos/perfil/${encodeURIComponent(placa)}`);
    renderVehiculo360(data);
    document.getElementById("vehiculo-360-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    cerrarVehiculo360();
    setClienteActionMessage(err.message || "No se pudo cargar el vehículo.", true);
  }
}

function iniciarIngresoVehiculo360() {
  const data = getVehiculoPerfilActual();
  const placa = getVehiculoPerfilPlaca();
  if (!data || !placa) return;
  changeView("parqueadero");
  seleccionarFlujoParqueadero(data.mensualidad ? "mensualidad" : "hora");
  const vehiculo = data.vehiculo || {};
  const propietario = data.propietario || {};
  const placaEl = document.getElementById("pq-placa");
  if (placaEl) placaEl.value = placa;
  const tipoEl = document.getElementById("pq-tipo");
  if (tipoEl) tipoEl.value = vehiculo.tipo_vehiculo || "CARRO";
  const nombreEl = document.getElementById("pq-nombre");
  if (nombreEl) nombreEl.value = propietario.nombre || "";
  const telEl = document.getElementById("pq-telefono");
  if (telEl) telEl.value = propietario.telefono || "";
  const propEl = document.getElementById("pq-es-propietario");
  if (propEl) propEl.checked = true;
  placaEl?.focus();
}

function iniciarLavadoVehiculo360() {
  const placa = getVehiculoPerfilPlaca();
  if (!placa) return;
  changeView("lavadero");
  const placaEl = document.getElementById("lav-placa");
  if (placaEl) placaEl.value = placa;
  document.getElementById("lav-tipo")?.focus();
  showMessage("lav-msg", "Placa cargada desde Vehículo 360.");
}

function iniciarTallerVehiculo360() {
  const placa = getVehiculoPerfilPlaca();
  if (!placa) return;
  changeView("taller");
  const placaEl = document.getElementById("tal-placa");
  if (placaEl) placaEl.value = placa;
  document.getElementById("tal-descripcion")?.focus();
  showMessage("tal-msg", "Placa cargada desde Vehículo 360.");
}

function iniciarMensualidadVehiculo360() {
  const data = getVehiculoPerfilActual();
  const placa = getVehiculoPerfilPlaca();
  if (!data || !placa) return;
  abrirClienteActionPanel("mensualidad");
  const select = document.getElementById("cli-men-vehiculo");
  const placaEl = document.getElementById("cli-men-placa");
  const tipoEl = document.getElementById("cli-men-tipo");
  const vehiculo = data.vehiculo || {};
  if (select) select.value = placa;
  if (placaEl) placaEl.value = placa;
  if (tipoEl) tipoEl.value = vehiculo.tipo_vehiculo || "CARRO";
}

// ── Cartera ───────────────────────────────────────────────

function renderCarteraActions(item, mode = "pendientes") {
  const modulo = escapeHtml(item.modulo || "");
  const referenciaId = escapeHtml(item.referencia_id || "");
  const acciones = [];
  if (mode !== "pagos" && ["PENDIENTE", "ABONADO"].includes(item.estado_cartera) && modulo && referenciaId) {
    acciones.push(`<button type="button" class="btn btn-sm btn-primary" data-cartera-action="cobrar" data-cartera-modulo="${modulo}" data-cartera-referencia="${referenciaId}">${item.estado_cartera === "ABONADO" ? "Abonar" : "Cobrar"}</button>`);
  }
  if (modulo && referenciaId) {
    acciones.push(`<button type="button" class="btn btn-sm btn-secondary" data-cartera-action="recibo" data-cartera-modulo="${modulo}" data-cartera-referencia="${referenciaId}">Recibo</button>`);
  }
  return acciones.length ? `<div class="table-actions">${acciones.join("")}</div>` : "—";
}

function renderCarteraRows(tbodyId, emptyId, rows, mode = "pendientes") {
  const tbody = document.getElementById(tbodyId);
  const empty = document.getElementById(emptyId);
  if (!tbody || !empty) return;
  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${formatDateTime(item.fecha)}</td>
      <td><span class="badge ${getModuleBadgeClass(item.tipo)}">${escapeHtml(item.tipo || "Servicio")}</span></td>
      <td>${escapeHtml(item.placa || "N/A")}</td>
      <td>
        <strong>${formatMoney(toClientNumber(mode === "pagos" ? item.monto : (item.saldo_pendiente ?? item.monto)))}</strong>
        ${mode === "pagos" ? "" : `<span class="table-subtext">Total ${formatMoney(toClientNumber(item.monto))} · Pagado ${formatMoney(toClientNumber(item.monto_pagado || 0))}</span>`}
      </td>
      <td>${mode === "pagos" ? renderBadge(item.metodo_pago || item.estado_cartera, "payment") : renderBadge(item.estado_cartera)}</td>
      <td>${renderCarteraActions(item, mode)}</td>
    </tr>
  `).join("");
  empty.hidden = rows.length > 0;
}

function renderClienteCarteraLoading() {
  const status = document.getElementById("cli-cartera-status");
  if (status) status.className = "badge badge-muted";
  setElementText("cli-cartera-status", "Cargando");
  setElementText("cli-cartera-facturado", formatMoney(0));
  setElementText("cli-cartera-pagado", formatMoney(0));
  setElementText("cli-cartera-pendiente", formatMoney(0));
  setElementText("cli-cartera-recurrente", formatMoney(0));
  renderCarteraRows("cli-cartera-pendientes-tbody", "cli-cartera-pendientes-empty", []);
  renderCarteraRows("cli-cartera-pagos-tbody", "cli-cartera-pagos-empty", [], "pagos");
}

function renderClienteCartera(data = {}) {
  const resumen = data.resumen || {};
  const status = getWalletStatus(resumen);
  const statusEl = document.getElementById("cli-cartera-status");
  if (statusEl) statusEl.className = `badge ${status.className}`;
  setElementText("cli-cartera-status", status.label);
  setElementText("cli-cartera-facturado", formatMoney(toClientNumber(resumen.total_facturado)));
  setElementText("cli-cartera-pagado", formatMoney(toClientNumber(resumen.total_pagado)));
  setElementText("cli-cartera-pendiente", formatMoney(toClientNumber(resumen.total_pendiente)));
  setElementText("cli-cartera-recurrente", formatMoney(toClientNumber(resumen.total_recurrente_mensual)));
  renderCarteraRows("cli-cartera-pendientes-tbody", "cli-cartera-pendientes-empty",
    [...(data.pendientes || []), ...(data.en_curso || [])].slice(0, 8)
  );
  renderCarteraRows("cli-cartera-pagos-tbody", "cli-cartera-pagos-empty", (data.pagos || []).slice(0, 8), "pagos");
}

async function cargarCarteraCliente360(clienteId) {
  if (!clienteId) return;
  renderClienteCarteraLoading();
  try {
    const data = await apiFetch(`/api/pagos/cartera/cliente/${clienteId}`);
    if (String(clientePerfilActual?.cliente?.id || "") !== String(clienteId)) return;
    renderClienteCartera(data);
  } catch (err) {
    const status = document.getElementById("cli-cartera-status");
    if (status) status.className = "badge badge-danger";
    setElementText("cli-cartera-status", "Error");
    console.error("Error cargando cartera del cliente:", err);
  }
}

function renderVehiculoCartera(data = {}) {
  const resumen = data.resumen || {};
  setElementText("veh360-pagado", formatMoney(toClientNumber(resumen.total_pagado)));
  setElementText("veh360-pendiente", formatMoney(toClientNumber(resumen.total_pendiente)));
  setElementText("veh360-en-curso", formatMoney(toClientNumber(resumen.total_en_curso)));
  setElementText("veh360-recurrente", formatMoney(toClientNumber(resumen.total_recurrente_mensual)));
}

async function cargarCarteraVehiculo360(placa) {
  if (!placa) return;
  setElementText("veh360-pagado", formatMoney(0));
  setElementText("veh360-pendiente", formatMoney(0));
  setElementText("veh360-en-curso", formatMoney(0));
  setElementText("veh360-recurrente", formatMoney(0));
  try {
    const data = await apiFetch(`/api/pagos/cartera/vehiculo/${encodeURIComponent(placa)}`);
    if (getVehiculoPerfilPlaca() !== placa) return;
    renderVehiculoCartera(data);
  } catch (err) {
    console.error("Error cargando cartera del vehículo:", err);
  }
}

// ── Recibos ───────────────────────────────────────────────

function receiptTitle(data = {}) {
  if (data.tipo === "arqueo") return "Comprobante de cierre de caja";
  if (data.tipo === "cliente") return "Estado de cuenta de cliente";
  if (data.tipo === "vehiculo") return "Estado de cuenta de vehículo";
  return "Comprobante de servicio";
}

function receiptStatusLabel(resumen = {}) {
  const status = getWalletStatus(resumen);
  return `<span class="badge ${status.className}">${escapeHtml(status.label)}</span>`;
}

function buildReceiptContent(data = {}) {
  const empresa = data.empresa || {};
  const sujeto = data.sujeto || {};
  const resumen = data.resumen || {};
  const movimientos = Array.isArray(data.movimientos) ? data.movimientos : [];
  const generado = formatDateTime(data.generado_en);

  if (data.tipo === "arqueo") {
    const arqueo = data.arqueo || {};
    const diferencia = toClientNumber(resumen.diferencia);
    const diffBadgeClass = diferencia === 0 ? "badge-success" : diferencia > 0 ? "badge-info" : "badge-danger";
    const diffBadgeLabel = diferencia === 0 ? "Cuadrado" : diferencia > 0 ? "Sobrante" : "Faltante";
    const metodos = Array.isArray(arqueo.metodos_pago) ? arqueo.metodos_pago : [];
    const modulos = Array.isArray(arqueo.modulos) ? arqueo.modulos : [];
    const responsables = Array.isArray(arqueo.responsables) ? arqueo.responsables : [];
    return `
      <div class="receipt-header-block">
        <div>
          <span class="receipt-eyebrow">AutoGestion360</span>
          <h2>${escapeHtml(receiptTitle(data))}</h2>
          <p>${escapeHtml(empresa.nombre || "Empresa")} ${empresa.nit ? `· NIT ${escapeHtml(empresa.nit)}` : ""}</p>
          <p>${escapeHtml([empresa.direccion, empresa.ciudad, empresa.telefono, empresa.email_contacto].filter(Boolean).join(" · ") || "Datos de empresa no registrados")}</p>
        </div>
        <div class="receipt-number-box">
          <span>No.</span><strong>${escapeHtml(data.numero || "SIN-NUMERO")}</strong><small>${escapeHtml(generado)}</small>
        </div>
      </div>
      <div class="receipt-subject-grid">
        <div>
          <h3>${escapeHtml(arqueo.estado || "CERRADO")}</h3>
          <p><strong>Fecha de caja:</strong> ${escapeHtml(formatDisplayDate(arqueo.fecha_caja))}</p>
          <p><strong>Rango:</strong> ${escapeHtml(`${formatDisplayDate(arqueo.desde)} a ${formatDisplayDate(arqueo.hasta)}`)}</p>
          <p><strong>Usuario:</strong> ${escapeHtml(sujeto.nombre || "Usuario no registrado")}</p>
        </div>
        <div>
          <h3>Validación</h3>
          <p><strong>Estado:</strong> <span class="badge ${diffBadgeClass}">${diffBadgeLabel}</span></p>
          <p><strong>Recaudado:</strong> ${formatMoney(toClientNumber(resumen.total_pagado))}</p>
          <p><strong>Efectivo sistema:</strong> ${formatMoney(toClientNumber(resumen.efectivo_sistema))}</p>
          <p><strong>Efectivo contado:</strong> ${formatMoney(toClientNumber(resumen.efectivo_contado))}</p>
          <p><strong>Diferencia:</strong> ${formatMoney(diferencia)}</p>
        </div>
      </div>
      <table class="receipt-table"><thead><tr><th>Método</th><th>Servicios</th><th>Total</th></tr></thead>
      <tbody>${metodos.length ? metodos.map((m) => `<tr><td>${escapeHtml(formatCashMethod(m.metodo_pago))}</td><td>${toClientNumber(m.cantidad)}</td><td>${formatMoney(toClientNumber(m.total))}</td></tr>`).join("") : `<tr><td colspan="3">Sin recaudo registrado.</td></tr>`}</tbody></table>
      <table class="receipt-table"><thead><tr><th>Módulo</th><th>Servicios</th><th>Recaudado</th><th>Pendiente</th></tr></thead>
      <tbody>${modulos.length ? modulos.map((m) => `<tr><td>${escapeHtml(formatModuleLabel(m.modulo))}</td><td>${toClientNumber(m.cantidad)}</td><td>${formatMoney(toClientNumber(m.recaudado))}</td><td>${formatMoney(toClientNumber(m.pendiente))}</td></tr>`).join("") : `<tr><td colspan="4">Sin módulos registrados.</td></tr>`}</tbody></table>
      <table class="receipt-table"><thead><tr><th>Responsable</th><th>Movimientos</th><th>Recaudado</th><th>Pendiente</th></tr></thead>
      <tbody>${responsables.length ? responsables.map((r) => `<tr><td>${escapeHtml(r.responsable_nombre || "Sin responsable")}</td><td>${toClientNumber(r.cantidad)}</td><td>${formatMoney(toClientNumber(r.recaudado))}</td><td>${formatMoney(toClientNumber(r.pendiente))}</td></tr>`).join("") : `<tr><td colspan="4">Sin responsables.</td></tr>`}</tbody></table>
      <div class="receipt-footer-note"><strong>Observación:</strong> ${escapeHtml(arqueo.observaciones || "Sin observaciones registradas.")}</div>
    `;
  }

  const subjectRows = [
    ["Nombre", sujeto.nombre || "No registrado"],
    ["Documento", sujeto.documento || "N/A"],
    ["Teléfono", sujeto.telefono || "N/A"],
    ["Correo", sujeto.correo || "N/A"],
    ["Placa", sujeto.placa || "N/A"],
    ["Vehículo", sujeto.vehiculo || "N/A"],
  ].filter(([, v]) => v !== "N/A" || sujeto.placa || sujeto.vehiculo || sujeto.documento);

  return `
    <div class="receipt-header-block">
      <div>
        <span class="receipt-eyebrow">AutoGestion360</span>
        <h2>${escapeHtml(receiptTitle(data))}</h2>
        <p>${escapeHtml(empresa.nombre || "Empresa")} ${empresa.nit ? `· NIT ${escapeHtml(empresa.nit)}` : ""}</p>
        <p>${escapeHtml([empresa.direccion, empresa.ciudad, empresa.telefono, empresa.email_contacto].filter(Boolean).join(" · ") || "Datos de empresa no registrados")}</p>
      </div>
      <div class="receipt-number-box"><span>No.</span><strong>${escapeHtml(data.numero || "SIN-NUMERO")}</strong><small>${escapeHtml(generado)}</small></div>
    </div>
    <div class="receipt-subject-grid">
      <div>
        <h3>${escapeHtml(sujeto.titulo || "Detalle")}</h3>
        ${subjectRows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}
      </div>
      <div>
        <h3>Resumen</h3>
        <p><strong>Estado:</strong> ${receiptStatusLabel(resumen)}</p>
        <p><strong>Facturado:</strong> ${formatMoney(toClientNumber(resumen.total_facturado))}</p>
        <p><strong>Pagado:</strong> ${formatMoney(toClientNumber(resumen.total_pagado))}</p>
        <p><strong>Pendiente:</strong> ${formatMoney(toClientNumber(resumen.total_pendiente))}</p>
        <p><strong>Recurrente mensual:</strong> ${formatMoney(toClientNumber(resumen.total_recurrente_mensual))}</p>
      </div>
    </div>
    <table class="receipt-table">
      <thead><tr><th>Fecha</th><th>Módulo</th><th>Placa</th><th>Detalle</th><th>Valor</th><th>Pago</th><th>Estado</th></tr></thead>
      <tbody>
        ${movimientos.length ? movimientos.map((item) => `
          <tr>
            <td>${escapeHtml(formatDateTime(item.fecha))}</td>
            <td>${escapeHtml(item.tipo || item.modulo || "Servicio")}</td>
            <td>${escapeHtml(item.placa || sujeto.placa || "N/A")}</td>
            <td>${escapeHtml(item.detalle || "Movimiento registrado")}</td>
            <td>${formatMoney(toClientNumber(item.monto))}</td>
            <td>${escapeHtml(item.metodo_pago || "N/A")}</td>
            <td>${escapeHtml(item.estado_cartera || item.estado_original || "Registrado")}</td>
          </tr>
        `).join("") : `<tr><td colspan="7">Sin movimientos para este comprobante.</td></tr>`}
      </tbody>
    </table>
    <div class="receipt-footer-note"><strong>Observación:</strong> Este comprobante resume la información registrada en AutoGestion360 al momento de generación.</div>
  `;
}

function buildReceiptHtmlPage(data = {}) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(data.numero || "comprobante")}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 28px; color: #111827; background: #ffffff; }
    h2, h3, p { margin: 0; }
    .receipt-header-block { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #1d4ed8; padding-bottom: 18px; margin-bottom: 18px; }
    .receipt-eyebrow { color: #2563eb; font-weight: 700; font-size: 12px; text-transform: uppercase; }
    .receipt-number-box { min-width: 210px; border: 1px solid #dbe5f0; border-radius: 8px; padding: 14px; text-align: right; }
    .receipt-number-box span, .receipt-number-box small { display: block; color: #64748b; }
    .receipt-subject-grid, .receipt-summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin: 16px 0; }
    .receipt-summary-grid { grid-template-columns: repeat(4, 1fr); }
    .receipt-subject-grid > div, .receipt-summary-grid > div { border: 1px solid #dbe5f0; border-radius: 8px; padding: 12px; }
    .receipt-subject-grid p { margin-top: 8px; color: #334155; }
    .receipt-summary-grid span { display: block; color: #64748b; font-size: 12px; }
    .receipt-summary-grid strong { display: block; margin-top: 6px; font-size: 18px; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; background: #dbeafe; color: #1d4ed8; font-weight: 700; font-size: 12px; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-warning { background: #fef3c7; color: #92400e; }
    .badge-danger { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
    th, td { border-bottom: 1px solid #dbe5f0; text-align: left; padding: 9px; vertical-align: top; }
    th { background: #f8fafc; color: #475569; }
    .receipt-footer-note { margin-top: 18px; padding: 12px; border-left: 4px solid #2563eb; background: #f8fafc; color: #334155; }
    @media print { body { margin: 14px; } }
  </style>
</head>
<body>${buildReceiptContent(data)}</body>
</html>`;
}

function mostrarRecibo(data) {
  reciboActual = data;
  setElementText("recibo-modal-title", receiptTitle(data));
  const area = document.getElementById("recibo-print-area");
  if (area) area.innerHTML = buildReceiptContent(data);
  document.getElementById("modal-recibo")?.classList.remove("hidden");
}

function cerrarModalRecibo() {
  document.getElementById("modal-recibo")?.classList.add("hidden");
}

function sanitizeReceiptFilename(value) {
  return String(value || "comprobante")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "") || "comprobante";
}

function descargarReciboHtml() {
  if (!reciboActual) return;
  const html = buildReceiptHtmlPage(reciboActual);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeReceiptFilename(reciboActual.numero)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function imprimirRecibo() {
  if (!reciboActual) return;
  const popup = window.open("", "_blank", "width=900,height=760");
  if (!popup) { window.print(); return; }
  popup.document.open();
  popup.document.write(buildReceiptHtmlPage(reciboActual));
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 250);
}

async function abrirReciboServicio(modulo, id) {
  try {
    const data = await apiFetch(`/api/pagos/recibo/servicio/${encodeURIComponent(modulo)}/${encodeURIComponent(id)}`);
    mostrarRecibo(data);
  } catch (err) {
    setClienteActionMessage(err.message || "No se pudo generar el recibo.", true);
  }
}

async function abrirReciboCliente360() {
  const cliente = getClientePerfilActual();
  if (!cliente) return;
  try {
    const data = await apiFetch(`/api/pagos/recibo/cliente/${cliente.id}`);
    mostrarRecibo(data);
  } catch (err) {
    setClienteActionMessage(err.message || "No se pudo generar el estado de cuenta.", true);
  }
}

async function abrirReciboVehiculo360() {
  const placa = getVehiculoPerfilPlaca();
  if (!placa) return;
  try {
    const data = await apiFetch(`/api/pagos/recibo/vehiculo/${encodeURIComponent(placa)}`);
    mostrarRecibo(data);
  } catch (err) {
    setClienteActionMessage(err.message || "No se pudo generar el comprobante del vehículo.", true);
  }
}

let clientesEventsBound = false;

function bindClientesEvents() {
  if (clientesEventsBound) return;
  clientesEventsBound = true;

  document.getElementById("form-cliente-nuevo")?.addEventListener("submit", handleNuevoCliente);
  document.getElementById("cli-buscar")?.addEventListener("input", filtrarClientes);
  document.getElementById("cli-perfil-close")?.addEventListener("click", cerrarPerfilCliente);
  document.getElementById("cli-action-editar")?.addEventListener("click", () => abrirClienteActionPanel("editar"));
  document.getElementById("cli-action-vehiculo")?.addEventListener("click", () => abrirClienteActionPanel("vehiculo"));
  document.getElementById("cli-action-mensualidad")?.addEventListener("click", () => abrirClienteActionPanel("mensualidad"));
  document.getElementById("form-cli-editar")?.addEventListener("submit", handleEditarCliente360);
  document.getElementById("form-cli-vehiculo")?.addEventListener("submit", handleAgregarVehiculoCliente360);
  document.getElementById("form-cli-mensualidad")?.addEventListener("submit", handleCrearMensualidadCliente360);
  document.getElementById("cli-men-vehiculo")?.addEventListener("change", sincronizarVehiculoMensualidadCliente);
  document.getElementById("cli-recibo-cliente")?.addEventListener("click", abrirReciboCliente360);
  document.getElementById("veh360-close")?.addEventListener("click", cerrarVehiculo360);
  document.getElementById("veh360-action-parqueadero")?.addEventListener("click", iniciarIngresoVehiculo360);
  document.getElementById("veh360-action-lavadero")?.addEventListener("click", iniciarLavadoVehiculo360);
  document.getElementById("veh360-action-taller")?.addEventListener("click", iniciarTallerVehiculo360);
  document.getElementById("veh360-action-mensualidad")?.addEventListener("click", iniciarMensualidadVehiculo360);
  document.getElementById("veh360-action-recibo")?.addEventListener("click", abrirReciboVehiculo360);
  document.getElementById("btn-recibo-close-top")?.addEventListener("click", cerrarModalRecibo);
  document.getElementById("btn-recibo-close")?.addEventListener("click", cerrarModalRecibo);
  document.getElementById("btn-recibo-download")?.addEventListener("click", descargarReciboHtml);
  document.getElementById("btn-recibo-print")?.addEventListener("click", imprimirRecibo);
  document.getElementById("cli-lista-tbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cliente-action='ver-perfil']");
    if (!button) return;
    verDetallesCliente(button.dataset.clienteId);
  });
  document.getElementById("cli-vehiculos-grid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cliente-action='ver-vehiculo']");
    if (!button) return;
    verVehiculo360(button.dataset.vehiculoPlaca);
  });
  ["cli-cartera-pendientes-tbody", "cli-cartera-pagos-tbody"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cartera-action]");
      if (!button) return;
      const { carteraAction, carteraModulo, carteraReferencia } = button.dataset;
      if (carteraAction === "cobrar") abrirPagoPendiente(carteraModulo, carteraReferencia);
      if (carteraAction === "recibo") abrirReciboServicio(carteraModulo, carteraReferencia);
    });
  });
  document.querySelectorAll("[data-cli-action-cancel]").forEach((button) => {
    button.addEventListener("click", cerrarClienteActionPanels);
  });
}

window.AG360.registerModule({
  id: "clientes",
  title: "Clientes",
  licenseModule: "clientes",
  icon: "👥",
  order: 70,
  bindEvents: bindClientesEvents,
  onEnter: cargarListaClientes,
});
