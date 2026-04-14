// ======================================================
// Autogestión360 - Frontend SPA
// Archivo app.js CORREGIDO
// ======================================================

const API_BASE_URL = window.location.origin;

// Keys usadas en localStorage
const STORAGE = {
  TOKEN: "ag360_token",
  EMAIL: "ag360_user_email",
  EMPRESA: "ag360_empresa_nombre",
  THEME: "ag360_theme",
};

/* ======================================================
   HELPER GENERAL PARA PETICIONES
======================================================*/
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem(STORAGE.TOKEN);
  const headers = options.headers || {};

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }

  const requestOptions = {
    ...options,
    headers,
  };

  if (options.body instanceof FormData) {
    delete requestOptions.headers["Content-Type"];
  }

  const res = await fetch(`${API_BASE_URL}${path}`, requestOptions);

  if (res.status === 401) {
    logout();
    throw new Error("No autorizado. Debe iniciar sesión.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.message || "Error en la petición");
  }

  return data;
}

/* ======================================================
   FUNCIONES DE UTILIDAD
======================================================*/
function showError(message, elementId = 'login-error') {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.hidden = false;
    setTimeout(() => element.hidden = true, 5000);
  }
}

function showSuccess(message, elementId = 'empresa-success') {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.hidden = false;
    setTimeout(() => element.hidden = true, 5000);
  }
}

function applyTheme(theme) {
  const selectedTheme = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("theme-light", selectedTheme === "light");
  document.body.classList.toggle("theme-dark", selectedTheme === "dark");
  localStorage.setItem(STORAGE.THEME, selectedTheme);

  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeOption === selectedTheme);
  });
}

function initTheme() {
  applyTheme(localStorage.getItem(STORAGE.THEME) || "dark");
}

/* ======================================================
   INICIO DE SESIÓN
======================================================*/
async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();
  const errorBox = document.getElementById("login-error");

  errorBox.hidden = true;

  if (!email || !password) {
    errorBox.textContent = "Ingresa correo y contraseña.";
    errorBox.hidden = false;
    return;
  }

  try {
    const data = await apiFetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    localStorage.setItem(STORAGE.TOKEN, data.token);
    localStorage.setItem(STORAGE.EMAIL, email);
    localStorage.setItem(STORAGE.EMPRESA, data.empresa?.nombre || "");
    localStorage.setItem('empresa_logo', data.empresa?.logo_url || '');
    localStorage.setItem('user_info', JSON.stringify(data.usuario));

    showMainView();
    initAfterLogin();
    updateSidebarLogo(data.empresa?.logo_url, data.empresa?.nombre);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

function logout() {
  localStorage.removeItem(STORAGE.TOKEN);
  localStorage.removeItem(STORAGE.EMAIL);
  showLoginView();
}

/* ======================================================
   VISTAS SPA
======================================================*/
function showLoginView() {
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("main-view").classList.add("hidden");
}

function showMainView() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
}

function changeView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("visible"));
  document.getElementById(`view-${view}`).classList.add("visible");

  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  document.getElementById("current-view-title").textContent = view.toUpperCase();

  if (view === "parqueadero") {
    cargarParqueaderoActivo();
    cargarHistorialParqueadero();
    cargarMensualidadesParqueadero();
  }
  if (view === "dashboard") {
    loadDashboard();
  }
  if (view === "lavadero") {
    loadLavaderoEmpleados();
    cargarOrdeneesLavadero();
  }
  if (view === "taller") {
    loadTallerMecanicos();
    cargarOrdensTaller();
  }
  if (view === "clientes") {
    cargarListaClientes();
  }
  if (view === "empleados") {
    cargarListaEmpleados();
  }
  if (view === "reportes") {
    setFechasDefecto();
  }
  if (view === "config") {
    loadConfig();
  }
}

// Función para limpiar el formulario de parqueadero
function limpiarFormularioParqueadero() {
  const placaEl = document.getElementById("pq-placa");
  const servicioEl = document.getElementById("pq-servicio");
  const tipoEl = document.getElementById("pq-tipo");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");
  const propEl = document.getElementById("pq-es-propietario");
  const obsEl = document.getElementById("pq-obs");
  const evidenciaEl = document.getElementById("pq-evidencia");
  const msgEl = document.getElementById("pq-msg");
  const histEl = document.getElementById("pq-historial");

  // Limpiar todos los campos
  if (placaEl) placaEl.value = "";
  if (servicioEl) servicioEl.value = "OCASIONAL_HORA";
  if (tipoEl) tipoEl.value = "CARRO"; // Resetear al valor por defecto
  if (nombreEl) nombreEl.value = "";
  if (telEl) telEl.value = "";
  if (obsEl) obsEl.value = "";
  if (evidenciaEl) evidenciaEl.value = "";
  if (propEl) propEl.checked = true; // Resetear a "es propietario" por defecto

  // Limpiar mensajes
  if (msgEl) {
    msgEl.hidden = true;
    msgEl.textContent = "";
  }
  if (histEl) {
    histEl.hidden = true;
    histEl.textContent = "";
  }
}

/* ======================================================
   DASHBOARD
======================================================*/
function formatMoney(value) {
  return Number(value).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

function formatDateParam(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateParam(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function getDashboardDate() {
  const input = document.getElementById("dash-fecha");
  const todayParam = formatDateParam(new Date());

  if (!input) return new Date();
  if (!input.value) input.value = todayParam;

  return parseDateParam(input.value);
}

function setElementText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setSegmentWidth(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function renderRevenueSplit(resumenDia = {}) {
  const parqueadero = Number(resumenDia.parqueadero?.total || 0);
  const lavadero = Number(resumenDia.lavadero?.total || 0);
  const taller = Number(resumenDia.taller?.total || 0);
  const total = parqueadero + lavadero + taller;

  setElementText("dash-ing-parqueadero", formatMoney(parqueadero));
  setElementText("dash-ing-lavadero", formatMoney(lavadero));
  setElementText("dash-ing-taller", formatMoney(taller));
  setElementText("dash-ing-total", formatMoney(total));
  setElementText("dash-revenue-total-label", formatMoney(total));
  setElementText("dash-lavados-count", Number(resumenDia.lavadero?.cantidad || 0));
  setElementText("dash-taller-count", Number(resumenDia.taller?.cantidad || 0));
  setElementText("dash-services-total", `${Number(resumenDia.cantidad_total || 0)} servicios cerrados`);

  if (total <= 0) {
    setSegmentWidth("dash-revenue-parqueadero-bar", 33.33);
    setSegmentWidth("dash-revenue-lavadero-bar", 33.33);
    setSegmentWidth("dash-revenue-taller-bar", 33.34);
    return;
  }

  setSegmentWidth("dash-revenue-parqueadero-bar", (parqueadero / total) * 100);
  setSegmentWidth("dash-revenue-lavadero-bar", (lavadero / total) * 100);
  setSegmentWidth("dash-revenue-taller-bar", (taller / total) * 100);
}

function renderOccupancy(ocupancia = {}, activos = []) {
  const capacidad = Number(ocupancia.capacidad_total || 0);
  const ocupados = Number(ocupancia.espacios_ocupados ?? activos.length ?? 0);
  const porcentaje = capacidad > 0 ? Math.min(100, Math.round((ocupados / capacidad) * 100)) : 0;
  const ring = document.getElementById("dash-occupancy-ring");

  if (ring) {
    const circumference = 2 * Math.PI * 46;
    ring.style.strokeDasharray = `${(porcentaje / 100) * circumference} ${circumference}`;
  }

  setElementText("dash-occupancy-percent", `${porcentaje}%`);
  setElementText("dash-occupancy-detail", `${ocupados} de ${capacidad || 0} espacios`);
  setElementText("dash-parqueadero-note", capacidad ? `${Math.max(0, capacidad - ocupados)} espacios disponibles` : "Activos ahora");

  const byType = activos.reduce((acc, item) => {
    const key = item.tipo_vehiculo || "OTRO";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const container = document.getElementById("dash-active-types");
  if (!container) return;

  const entries = Object.entries(byType);
  container.innerHTML = entries.length
    ? entries.map(([tipo, total]) => `<span>${tipo}: <strong>${total}</strong></span>`).join("")
    : "<span>Sin vehículos activos</span>";
}

function renderDashboardChart(dias) {
  const chart = document.getElementById("dash-chart");
  const empty = document.getElementById("dash-chart-empty");
  const line = document.getElementById("dash-trend-line");
  const area = document.getElementById("dash-trend-area");
  const pointsGroup = document.getElementById("dash-trend-points");
  if (!chart || !empty || !line || !area || !pointsGroup) return;

  const maxTotal = Math.max(...dias.map(dia => Number(dia.total_general || 0)), 0);

  chart.innerHTML = "";
  line.setAttribute("points", "");
  area.setAttribute("d", "");
  pointsGroup.innerHTML = "";

  if (!dias.length || maxTotal <= 0) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  const width = 640;
  const height = 220;
  const paddingX = 24;
  const paddingY = 24;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const points = dias.map((dia, index) => {
    const x = dias.length === 1 ? width / 2 : paddingX + (index / (dias.length - 1)) * usableWidth;
    const y = height - paddingY - (Number(dia.total_general || 0) / maxTotal) * usableHeight;
    return { x, y, dia, total: Number(dia.total_general || 0) };
  });

  line.setAttribute("points", points.map(point => `${point.x},${point.y}`).join(" "));
  area.setAttribute(
    "d",
    `M ${points[0].x} ${height - paddingY} L ${points.map(point => `${point.x} ${point.y}`).join(" L ")} L ${points[points.length - 1].x} ${height - paddingY} Z`
  );

  pointsGroup.innerHTML = points.map(point => `
    <circle class="trend-point" cx="${point.x}" cy="${point.y}" r="4"></circle>
  `).join("");

  chart.innerHTML = dias
    .map(dia => {
      const total = Number(dia.total_general || 0);
      const width = total > 0 ? Math.max((total / maxTotal) * 100, 4) : 0;
      return `
        <div class="chart-row">
          <span class="chart-date">${dia.fecha}</span>
          <div class="chart-bar-wrapper">
            <div class="chart-bar" data-width="${width}"></div>
          </div>
          <span class="chart-value">${formatMoney(total)}</span>
        </div>
      `;
    })
    .join("");

  chart.querySelectorAll(".chart-bar").forEach((bar) => {
    bar.style.width = `${bar.dataset.width}%`;
  });
}

let cobroServicioActual = null;

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO");
}

function formatDuration(startValue, endValue = new Date()) {
  if (!startValue) return "—";

  const start = new Date(startValue);
  const end = new Date(endValue);
  const totalMinutes = Math.max(1, Math.round((end - start) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function actualizarCamposPagoServicio(selectId, referenciaGroupId, detalleGroupId) {
  const metodo = document.getElementById(selectId)?.value || "";
  const referenciaGroup = document.getElementById(referenciaGroupId);
  const detalleGroup = document.getElementById(detalleGroupId);

  if (referenciaGroup) {
    referenciaGroup.hidden = !(metodo === "TARJETA" || metodo === "TRANSFERENCIA");
  }

  if (detalleGroup) {
    detalleGroup.hidden = !(metodo === "OTRO" || metodo === "MIXTO");
  }
}

function limpiarModalCobroServicio() {
  ["cobro-metodo-pago", "cobro-referencia", "cobro-detalle-pago", "cobro-observaciones"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

  actualizarCamposPagoServicio(
    "cobro-metodo-pago",
    "cobro-referencia-group",
    "cobro-detalle-pago-group"
  );
}

async function abrirModalCobroServicio(modulo, id) {
  limpiarModalCobroServicio();

  if (modulo === "lavadero") {
    const orden = await apiFetch(`/api/lavadero/${id}`);
    const fin = new Date();

    cobroServicioActual = {
      modulo,
      id,
      estadoFinal: "Completado",
      endpoint: `/api/lavadero/${id}`,
      successMessageId: "lav-msg",
      successMessage: "Lavado completado y cobro registrado.",
      reload: async () => cargarOrdeneesLavadero(),
    };

    setText("cobro-servicio-title", "Completar lavado y registrar pago");
    setText("cobro-servicio-placa", orden.placa || "—");
    setText("cobro-servicio-tipo", orden.tipo_lavado_nombre || orden.tipo_lavado || "Lavado");
    setText("cobro-servicio-responsable", orden.lavador_nombre || orden.empleado_nombre || "Sin asignar");
    setText("cobro-servicio-estado", orden.estado || "—");
    setText("cobro-servicio-cliente", orden.cliente_nombre || "No registrado");
    setText("cobro-servicio-inicio", formatDateTime(orden.hora_inicio));
    setText("cobro-servicio-fin", fin.toLocaleString("es-CO"));
    setText("cobro-servicio-tiempo", formatDuration(orden.hora_inicio, fin));
    setText("cobro-servicio-valor", formatMoney(orden.precio || 0));
  }

  if (modulo === "taller") {
    const data = await apiFetch(`/api/taller/${id}`);
    const orden = data.orden || data;
    const fin = new Date();

    cobroServicioActual = {
      modulo,
      id,
      estadoFinal: "Entregado",
      endpoint: `/api/taller/${id}`,
      successMessageId: "tal-msg",
      successMessage: "Orden entregada y cobro registrado.",
      reload: async () => cargarOrdensTaller(),
    };

    setText("cobro-servicio-title", "Entregar orden de taller y registrar pago");
    setText("cobro-servicio-placa", orden.placa || "—");
    setText("cobro-servicio-tipo", orden.descripcion || orden.descripcion_falla || "Orden de taller");
    setText("cobro-servicio-responsable", orden.mecanico_nombre || orden.empleado_nombre || "Sin asignar");
    setText("cobro-servicio-estado", orden.estado || "—");
    setText("cobro-servicio-cliente", orden.cliente_nombre || "No registrado");
    setText("cobro-servicio-inicio", formatDateTime(orden.fecha_creacion));
    setText("cobro-servicio-fin", fin.toLocaleString("es-CO"));
    setText("cobro-servicio-tiempo", formatDuration(orden.fecha_creacion, fin));
    setText("cobro-servicio-valor", formatMoney(orden.total_general || orden.total_orden || 0));
  }

  document.getElementById("modal-cobro-servicio")?.classList.remove("hidden");
}

function cerrarModalCobroServicio() {
  document.getElementById("modal-cobro-servicio")?.classList.add("hidden");
  cobroServicioActual = null;
}

async function confirmarCobroServicio() {
  if (!cobroServicioActual) {
    alert("No hay un servicio seleccionado para cobrar.");
    return;
  }

  const metodoPago = document.getElementById("cobro-metodo-pago").value.trim();
  if (!metodoPago) {
    alert("Debe seleccionar un método de pago.");
    return;
  }

  const referencia = document.getElementById("cobro-referencia").value.trim();
  const detalle = document.getElementById("cobro-detalle-pago").value.trim();
  const observaciones = document.getElementById("cobro-observaciones").value.trim();

  const detallePago = {};
  if (referencia) detallePago.referencia = referencia;
  if (detalle) detallePago.detalle = detalle;
  if (observaciones) detallePago.observaciones = observaciones;

  try {
    await apiFetch(cobroServicioActual.endpoint, {
      method: "PATCH",
      body: JSON.stringify({
        estado: cobroServicioActual.estadoFinal,
        metodo_pago: metodoPago,
        detalle_pago: Object.keys(detallePago).length ? detallePago : null,
      }),
    });

    const successMessageId = cobroServicioActual.successMessageId;
    const successMessage = cobroServicioActual.successMessage;
    const reload = cobroServicioActual.reload;

    cerrarModalCobroServicio();
    await reload();
    await loadDashboard();
    showMessage(successMessageId, successMessage);
  } catch (err) {
    showMessage(cobroServicioActual.successMessageId, err.message, true);
  }
}

async function loadDashboard() {
  const selectedDate = getDashboardDate();
  const selectedParam = formatDateParam(selectedDate);
  const todayParam = formatDateParam(new Date());

  setElementText("dash-date-eyebrow", selectedParam === todayParam ? "Hoy" : "Consulta");
  setElementText("dash-current-date", selectedDate.toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }));

  let activosDashboard = [];

  try {
    const activos = await apiFetch("/api/parqueadero/activo");
    activosDashboard = Array.isArray(activos) ? activos : [];
    document.getElementById("dash-parqueadero-count").textContent = activosDashboard.length;
  } catch (err) {
    console.error("Error cargando parqueadero dashboard:", err);
  }

  try {
    const ocupancia = await apiFetch("/api/reportes/parqueadero/ocupancia");
    renderOccupancy(ocupancia, activosDashboard);
  } catch (err) {
    console.error("Error cargando ocupación:", err);
    renderOccupancy({}, activosDashboard);
  }

  try {
    const resumenDia = await apiFetch(`/api/reportes/resumen?desde=${selectedParam}&hasta=${selectedParam}`);

    renderRevenueSplit(resumenDia);
  } catch (err) {
    console.error("Error cargando ingresos:", err);
    renderRevenueSplit({});
  }

  try {
    const hasta = new Date(selectedDate);
    const desde = new Date(hasta);
    desde.setDate(hasta.getDate() - 6);
    setElementText("dash-trend-range", `${formatDateParam(desde)} a ${formatDateParam(hasta)}`);

    const diario = await apiFetch(
      `/api/reportes/diario?desde=${formatDateParam(desde)}&hasta=${formatDateParam(hasta)}`
    );

    renderDashboardChart(diario.dias || []);
  } catch (err) {
    console.error("Error cargando gráfica dashboard:", err);
    renderDashboardChart([]);
  }
}
/* ======================================================
Procesar PLACA
======================================================*/
document.getElementById("pq-placa").addEventListener("blur", async function () {
  const placa = this.value.trim().toUpperCase();
  if (!placa) return;

  try {
    const data = await apiFetch(`/api/parqueadero/buscar/${placa}`);
    procesarPlacaParqueadero(data);
  } catch (err) {
    console.error("Error consultando placa:", err);
  }
});

function procesarPlacaParqueadero(data) {
  const existe = data.existe;
  const vehiculo = data.vehiculo;
  const propietario = data.propietario;
  const mensualidad = data.mensualidad;
  const historial = data.historial;
  const msgEl = document.getElementById("pq-msg");
  const histEl = document.getElementById("pq-historial");

  if (msgEl) {
    msgEl.hidden = true;
    msgEl.textContent = "";
  }
  if (histEl) {
    histEl.hidden = true;
    histEl.textContent = "";
  }

  const tipoEl = document.getElementById("pq-tipo");
  const servicioEl = document.getElementById("pq-servicio");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");

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

    if (histEl) {
      mostrarHistorialVehiculo(histEl, historial);
    }

    if (msgEl) {
      msgEl.hidden = false;
      if (mensualidad) {
        seleccionarFlujoParqueadero("mensualidad");
      }
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

function mostrarHistorialVehiculo(element, historial) {
  if (!element) return;
  if (!historial) {
    element.hidden = true;
    return;
  }

  const parqueoCount = Array.isArray(historial.parqueadero)
    ? historial.parqueadero.length
    : 0;
  const lavaderoCount = Array.isArray(historial.lavadero)
    ? historial.lavadero.length
    : 0;
  const tallerCount = Array.isArray(historial.taller)
    ? historial.taller.length
    : 0;

  element.hidden = false;
  element.innerHTML = `Vehículo con historial: ${parqueoCount} parqueadero(s), ${lavaderoCount} lavadero(s), ${tallerCount} taller(es). Si hay un nuevo propietario, habilite la casilla y actualice el nombre.`;
}


function seleccionarFlujoParqueadero(flujo = "ocasional") {
  const ingresoPanel = document.getElementById("pq-panel-ingreso");
  const altaPanel = document.getElementById("pq-panel-alta-mensualidad");
  const servicioEl = document.getElementById("pq-servicio");
  const titleEl = document.getElementById("pq-ingreso-title");
  const helpEl = document.getElementById("pq-ingreso-help");
  const nombreHelpEl = document.getElementById("pq-nombre-help");
  const submitBtn = document.querySelector("#form-parqueadero-entrada button[type='submit']");

  document.querySelectorAll(".module-action-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

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

/* ======================================================
   PARQUEADERO — REGISTRO DE ENTRADA
======================================================*/
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

    if (evidenciaFile) {
      formData.append("evidencia", evidenciaFile);
    }

    await apiFetch("/api/parqueadero/entrada", {
      method: "POST",
      body: formData,
    });

    msgEl.textContent = "Entrada registrada correctamente.";
    msgEl.hidden = false;
    msgEl.classList.remove("error");
    msgEl.classList.add("ok");

    // Limpiar todos los campos del formulario para el siguiente vehículo
    placaEl.value = "";
    if (servicioEl) servicioEl.value = tipo_servicio === "MENSUALIDAD" ? "MENSUALIDAD" : "OCASIONAL_HORA";
    tipoEl.value = "CARRO"; // Resetear al valor por defecto
    nombreEl.value = "";
    telEl.value = "";
    obsEl.value = "";
    if (evidenciaEl) evidenciaEl.value = "";
    propEl.checked = true; // Resetear a "es propietario" por defecto

    // Recargar la tabla de vehículos activos para mostrar el nuevo registro
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

function actualizarAyudaTipoServicioParqueadero() {
  const servicio = document.getElementById("pq-servicio")?.value || "OCASIONAL_HORA";
  const nombreEl = document.getElementById("pq-nombre");
  const propEl = document.getElementById("pq-es-propietario");

  if (nombreEl) {
    nombreEl.placeholder = servicio === "MENSUALIDAD"
      ? "Se carga desde la mensualidad"
      : "Opcional";
  }

  if (propEl && servicio !== "MENSUALIDAD") {
    propEl.checked = true;
  }
}

function servicioParqueaderoLabel(servicio) {
  const labels = {
    OCASIONAL_HORA: "Horas",
    OCASIONAL_DIA: "Día",
    MENSUALIDAD: "Mensualidad",
  };
  return labels[servicio] || "Horas";
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
    await apiFetch("/api/parqueadero/mensualidades", {
      method: "POST",
      body: JSON.stringify(payload),
    });
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
        <td><span class="badge">${item.estado}</span></td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Error cargando mensualidades:", err);
    empty.hidden = false;
    empty.textContent = "Error cargando mensualidades.";
  }
}

/* ======================================================
   PARQUEADERO — CARGAR VEHÍCULOS ACTIVOS
======================================================*/
async function cargarParqueaderoActivo() {
  const tbody = document.getElementById("pq-tbody");
  const empty = document.getElementById("pq-empty");

  if (!tbody || !empty) return;

  try {
    const data = await apiFetch("/api/parqueadero/activo");  // ✅ usa apiFetch

    tbody.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      empty.style.display = "block";
      empty.innerText = "No hay vehículos registrados actualmente.";
      return;
    }

    empty.style.display = "none";

    data.forEach(item => {
      const tr = document.createElement("tr");
      tr.dataset.id = item.id;

      tr.innerHTML = `
        <td>${item.placa}</td>
        <td>${item.tipo_vehiculo}</td>
        <td>${servicioParqueaderoLabel(item.tipo_servicio)}</td>
        <td>${item.nombre_cliente || "-"}</td>
        <td>${new Date(item.hora_entrada).toLocaleString()}</td>
        <td>-</td>
        <td>
          <button class="btn btn-success btn-sm pq-salida">
            Registrar salida
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Error cargando parqueadero:", e);
    empty.style.display = "block";
    empty.innerText = "Error cargando datos del parqueadero.";
  }
}

/* ======================================================
   PARQUEADERO — REGISTRO DE SALIDA (MEJORADO)
   Ahora solicita pago y permite editar datos antes de confirmar
======================================================*/

// Variable global para almacenar datos de pre-salida
let datosPreSalida = null;
let registroId = null;

async function handleSalidaClick(event) {
  const btn = event.target.closest(".pq-salida");
  if (!btn) return;

  const tr = btn.closest("tr");
  registroId = tr?.dataset.id;
  if (!registroId) return;

  try {
    // 1) Obtener pre-cálculo de salida
    const preCalculo = await apiFetch(`/api/parqueadero/${registroId}/pre-salida`, {
      method: "POST",
    });

    datosPreSalida = preCalculo;

    // 2) Llenar modal con datos
    document.getElementById("salida-placa").textContent = preCalculo.placa || "—";
    document.getElementById("salida-tipo").textContent = preCalculo.tipo_vehiculo || "—";
    document.getElementById("salida-cliente").textContent = preCalculo.cliente || "—";
    document.getElementById("salida-hora-entrada").textContent = preCalculo.hora_entrada || "—";
    document.getElementById("salida-hora-salida").textContent = preCalculo.hora_salida || "—";
    document.getElementById("salida-tiempo").textContent = preCalculo.tiempo_estancia || "—";
    document.getElementById("salida-tarifa").textContent = preCalculo.tarifa_aplicada || "—";
    
    // Mostrar descuento si aplica
    if (preCalculo.descuento !== "No aplica") {
      document.getElementById("salida-descuento-info").hidden = false;
      document.getElementById("salida-valor-antes-info").hidden = false;
      document.getElementById("salida-descuento").textContent = preCalculo.descuento;
      document.getElementById("salida-valor-antes").textContent = 
        `$${preCalculo.valor_antes_descuento.toLocaleString("es-CO")} COP`;
    } else {
      document.getElementById("salida-descuento-info").hidden = true;
      document.getElementById("salida-valor-antes-info").hidden = true;
      document.getElementById("salida-descuento").textContent = "";
      document.getElementById("salida-valor-antes").textContent = "";
    }
    
    document.getElementById("salida-valor").textContent = 
      `$${preCalculo.valor_a_cobrar.toLocaleString("es-CO")} COP`;

    // 3) Limpiar campos de pago
    document.getElementById("pq-metodo-pago").value =
      preCalculo.tipo_servicio === "MENSUALIDAD" || Number(preCalculo.valor_a_cobrar || 0) === 0
        ? "MENSUALIDAD"
        : "";
    document.getElementById("pq-referencia").value = "";
    document.getElementById("pq-detalle-pago").value = "";
    document.getElementById("pq-obs-salida").value = "";

    // Limpiar form de edición
    document.getElementById("edit-placa").value = preCalculo.placa || "";
    document.getElementById("edit-cliente").value = preCalculo.cliente || "";
    document.getElementById("edit-tipo").value = preCalculo.tipo_vehiculo || "";
    document.getElementById("salida-editar").hidden = true;

    // 4) Mostrar modal
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
  if (placanueva && placanueva !== datosPreSalida.placa) {
    cambios.placa = placanueva;
  }

  const clientenuevo = document.getElementById("edit-cliente").value.trim();
  if (clientenuevo && clientenuevo !== datosPreSalida.cliente) {
    cambios.nombre_cliente = clientenuevo;
  }

  const tiponuevo = document.getElementById("edit-tipo").value.trim();
  if (tiponuevo && tiponuevo !== datosPreSalida.tipo_vehiculo) {
    cambios.tipo_vehiculo = tiponuevo;
  }

  if (Object.keys(cambios).length === 0) {
    alert("No hay cambios para guardar.");
    return;
  }

  try {
    await apiFetch(`/api/parqueadero/${registroId}`, {
      method: "PATCH",
      body: JSON.stringify(cambios),
    });

    alert("Registro actualizado exitosamente.");
    
    // Recargar pre-salida con nuevos datos
    const preCalculo = await apiFetch(`/api/parqueadero/${registroId}/pre-salida`, {
      method: "POST",
    });
    datosPreSalida = preCalculo;
    
    // Actualizar display
    document.getElementById("salida-placa").textContent = preCalculo.placa || "—";
    document.getElementById("salida-tipo").textContent = preCalculo.tipo_vehiculo || "—";
    document.getElementById("salida-cliente").textContent = preCalculo.cliente || "—";

    document.getElementById("salida-editar").hidden = true;
  } catch (err) {
    console.error("Error actualizando registro:", err);
    alert(err.message || "Error actualizando registro.");
  }
}

async function confirmarSalida() {
  if (!registroId || !datosPreSalida) {
    alert("Error: datos no disponibles.");
    return;
  }

  const metodoPago = document.getElementById("pq-metodo-pago").value.trim();
  if (!metodoPago) {
    alert("Debe seleccionar un método de pago.");
    return;
  }

  const referencia = document.getElementById("pq-referencia").value.trim() || null;
  const detallePago = document.getElementById("pq-detalle-pago").value.trim() || null;
  const observacionesSalida = document.getElementById("pq-obs-salida").value.trim() || null;

  try {
    await apiFetch(`/api/parqueadero/salida/${registroId}`, {
      method: "POST",
      body: JSON.stringify({
        metodo_pago: metodoPago,
        referencia_transaccion: referencia,
        detalle_pago: detallePago,
        observaciones: observacionesSalida,
      }),
    });

    alert("✓ Salida registrada correctamente y pago confirmado.");
    cerrarModalSalida();

    // Recargar tabla de activos
    await cargarParqueaderoActivo();
    await cargarHistorialParqueadero();
    await cargarMensualidadesParqueadero();
    await loadDashboard();
  } catch (err) {
    console.error("Error registrando salida:", err);
    alert(err.message || "Error registrando salida.");
  }
}

// Mostrar/ocultar campos adicionales según método de pago
document.addEventListener("DOMContentLoaded", function() {
  const selectPago = document.getElementById("pq-metodo-pago");
  if (selectPago) {
    selectPago.addEventListener("change", function() {
      actualizarCamposPagoServicio(
        "pq-metodo-pago",
        "pq-referencia-group",
        "pq-detalle-pago-group"
      );
    });
  }

  const selectCobro = document.getElementById("cobro-metodo-pago");
  if (selectCobro) {
    selectCobro.addEventListener("change", function() {
      actualizarCamposPagoServicio(
        "cobro-metodo-pago",
        "cobro-referencia-group",
        "cobro-detalle-pago-group"
      );
    });
  }
});

/* ======================================================
   FORZAR MAYÚSCULAS EN ENTRADAS
======================================================*/
document.addEventListener("input", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type === "text") {
    e.target.value = e.target.value.toUpperCase();
  }
  if (e.target.tagName === "TEXTAREA") {
    e.target.value = e.target.value.toUpperCase();
  }
});

/* ======================================================
   INICIALIZACIÓN GLOBAL
======================================================*/
document.addEventListener("DOMContentLoaded", () => {
  initTheme();

  // Login
  const loginForm = document.getElementById("login-form");
  loginForm?.addEventListener("submit", handleLogin);

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", logout);

  // Navegación
  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.addEventListener("click", () => changeView(btn.dataset.view));
  });

  // Entrada parqueadero
  document
    .getElementById("form-parqueadero-entrada")
    ?.addEventListener("submit", handleEntradaParqueadero);

  document
    .getElementById("form-parqueadero-mensualidad")
    ?.addEventListener("submit", handleNuevaMensualidadParqueadero);

  document
    .getElementById("btn-pq-ingreso-ocasional")
    ?.addEventListener("click", () => seleccionarFlujoParqueadero("ocasional"));

  document
    .getElementById("btn-pq-ingreso-dia")
    ?.addEventListener("click", () => seleccionarFlujoParqueadero("dia"));

  document
    .getElementById("btn-pq-ingreso-mensualidad")
    ?.addEventListener("click", () => seleccionarFlujoParqueadero("mensualidad"));

  document
    .getElementById("btn-pq-alta-mensualidad")
    ?.addEventListener("click", () => seleccionarFlujoParqueadero("alta"));

  // Click en botones de salida
  document
    .getElementById("pq-tbody")
    ?.addEventListener("click", handleSalidaClick);

  // Lavadero
  document
    .getElementById("form-lavadero-nueva")
    ?.addEventListener("submit", handleNovaLavado);

  document
    .getElementById("lav-buscar")
    ?.addEventListener("input", () => cargarOrdeneesLavadero());

  // Historial lavadero
  document
    .getElementById("lav-historial-buscar")
    ?.addEventListener("input", () => cargarOrdeneesLavadero());

  // Taller
  document
    .getElementById("form-taller-nueva")
    ?.addEventListener("submit", handleNuevaOrdenTaller);

  // Clientes
  document
    .getElementById("form-cliente-nuevo")
    ?.addEventListener("submit", handleNuevoCliente);

  document
    .getElementById("cli-buscar")
    ?.addEventListener("input", filtrarClientes);

  // Empleados
  document
    .getElementById("form-empleado-nuevo")
    ?.addEventListener("submit", handleNuevoEmpleado);

  document
    .getElementById("emp-filtro-rol")
    ?.addEventListener("change", filtrarEmpleadosPorRol);

  // Historial parqueadero
  document
    .getElementById("pq-historial-buscar")
    ?.addEventListener("input", () => cargarHistorialParqueadero());

  // Historial taller
  document
    .getElementById("tal-historial-buscar")
    ?.addEventListener("input", () => cargarOrdensTaller());

  // Reportes
  document
    .getElementById("form-rep-filtro")
    ?.addEventListener("submit", handleGenerarReportes);

  // Configuración
  document
    .getElementById("form-empresa")
    ?.addEventListener("submit", handleActualizarEmpresa);

  document
    .getElementById("btn-ver-licencias")
    ?.addEventListener("click", handleVerLicencias);

  document
    .getElementById("btn-asignar-licencia")
    ?.addEventListener("click", handleAsignarLicencia);

  document
    .getElementById("btn-notificar-vencimientos")
    ?.addEventListener("click", handleNotificarVencimientos);

  document
    .getElementById("empresa-logo-file")
    ?.addEventListener("change", handleLogoFileChange);

  document
    .getElementById("form-parqueadero-config")
    ?.addEventListener("submit", handleGuardarParqueaderoConfig);

  document
    .getElementById("btn-toggle-parqueadero-config")
    ?.addEventListener("click", toggleParqueaderoConfig);

  document.querySelectorAll(".config-tab").forEach((button) => {
    button.addEventListener("click", () => setConfigTab(button.dataset.configTab));
  });

  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeOption));
  });

  document
    .getElementById("dash-fecha")
    ?.addEventListener("change", loadDashboard);

  document
    .getElementById("btn-dash-hoy")
    ?.addEventListener("click", () => {
      const input = document.getElementById("dash-fecha");
      if (input) input.value = formatDateParam(new Date());
      loadDashboard();
    });

  const token = localStorage.getItem(STORAGE.TOKEN);
  if (token) {
    showMainView();
    initAfterLogin();
  } else {
    showLoginView();
  }
});

function initAfterLogin() {
  const empresa = localStorage.getItem(STORAGE.EMPRESA);
  if (empresa) document.getElementById("sidebar-empresa").textContent = empresa;

  const email = localStorage.getItem(STORAGE.EMAIL);
  if (email) document.getElementById("user-info-label").textContent = email;

  const empresaLogo = localStorage.getItem('empresa_logo');
  updateSidebarLogo(empresaLogo, empresa);

  changeView("dashboard");
}

/* ======================================================
   MÓDULO CONFIGURACIÓN
======================================================*/
function userIsAdmin() {
  const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  const rol = String(userInfo.rol || "").toLowerCase();
  return rol === "admin" || rol === "administrador";
}

function setConfigTab(tab = "empresa") {
  const selectedTab = tab || "empresa";

  document.querySelectorAll(".config-tab").forEach((button) => {
    const active = button.dataset.configTab === selectedTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll("[data-config-panel]").forEach((panel) => {
    const samePanel = panel.dataset.configPanel === selectedTab;
    const adminOnly = panel.dataset.adminOnly === "true";
    panel.classList.toggle("hidden", !samePanel || (adminOnly && !userIsAdmin()));
  });

  if (selectedTab === "parqueadero") {
    loadParqueaderoConfig();
  }
}

async function loadConfig() {
  try {
    // Cargar información de la empresa
    const empresa = await apiFetch('/api/empresa');
    document.getElementById('empresa-nombre').value = empresa.nombre || '';
    document.getElementById('empresa-nit').value = empresa.nit || '';
    document.getElementById('empresa-ciudad').value = empresa.ciudad || '';
    document.getElementById('empresa-direccion').value = empresa.direccion || '';
    document.getElementById('empresa-telefono').value = empresa.telefono || '';
    document.getElementById('empresa-email').value = empresa.email_contacto || '';
    document.getElementById('empresa-zona-horaria').value = empresa.zona_horaria || 'America/Bogota';
    document.getElementById('empresa-logo-file').value = '';
    updateLogoPreview(empresa.logo_url, empresa.nombre);

    // Cargar información de la licencia
    await loadLicenciaInfo();
    await loadParqueaderoConfig();

    const activeTab = document.querySelector(".config-tab.active")?.dataset.configTab || "empresa";
    setConfigTab(activeTab);

  } catch (error) {
    console.error('Error cargando configuración:', error);
    showError('Error al cargar la configuración');
  }
}

async function loadLicenciaInfo() {
  try {
    const licencia = await apiFetch('/api/empresa/licencia');

    if (licencia.mensaje) {
      // No hay licencia
      document.getElementById('licencia-nombre').textContent = 'Sin licencia';
      document.getElementById('licencia-inicio').textContent = '-';
      document.getElementById('licencia-fin').textContent = '-';
      document.getElementById('licencia-estado').textContent = 'Inactiva';
      document.getElementById('modulos-lista').innerHTML = '<li>Ninguno</li>';
      document.getElementById('btn-renovar-licencia')?.classList.add('hidden');
      return;
    }

    document.getElementById('licencia-nombre').textContent = licencia.licencia_nombre;
    document.getElementById('licencia-inicio').textContent = new Date(licencia.fecha_inicio).toLocaleDateString('es-ES');
    document.getElementById('licencia-fin').textContent = licencia.fecha_fin ? new Date(licencia.fecha_fin).toLocaleDateString('es-ES') : 'Sin vencimiento';
    document.getElementById('licencia-estado').textContent = licencia.activa ? 'Activa' : 'Inactiva';

    const modulosLista = document.getElementById('modulos-lista');
    modulosLista.innerHTML = '';
    if (licencia.modulos && licencia.modulos.length > 0) {
      licencia.modulos.forEach(modulo => {
        const li = document.createElement('li');
        li.textContent = modulo.nombre;
        modulosLista.appendChild(li);
      });
    } else {
      modulosLista.innerHTML = '<li>Ninguno</li>';
    }

    // Mostrar botón de renovar si está próxima a vencer (30 días)
    const hoy = new Date();
    const fechaFin = new Date(licencia.fecha_fin);
    const diasRestantes = Math.ceil((fechaFin - hoy) / (1000 * 60 * 60 * 24));
    document.getElementById('btn-renovar-licencia')?.classList.toggle('hidden', diasRestantes > 30);

  } catch (error) {
    console.error('Error cargando licencia:', error);
  }
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? "";
}

function getNumberValue(id) {
  const value = Number(document.getElementById(id)?.value || 0);
  return Number.isFinite(value) ? value : 0;
}

function setVehicleConfig(prefix, data = {}) {
  setInputValue(`cfg-${prefix}-bahias`, data.bahias);
  setInputValue(`cfg-${prefix}-valor-dia`, data.valor_dia);
  setInputValue(`cfg-${prefix}-fraccion-dia`, data.fraccion_dia_minutos);
  setInputValue(`cfg-${prefix}-valor-primera`, data.valor_primera_fraccion);
  setInputValue(`cfg-${prefix}-tiempo-primera`, data.tiempo_primera_fraccion);
  setInputValue(`cfg-${prefix}-valor-segunda`, data.valor_segunda_fraccion);
  setInputValue(`cfg-${prefix}-tiempo-segunda`, data.tiempo_segunda_fraccion);
}

function getVehicleConfig(prefix) {
  return {
    bahias: getNumberValue(`cfg-${prefix}-bahias`),
    valor_dia: getNumberValue(`cfg-${prefix}-valor-dia`),
    fraccion_dia_minutos: getNumberValue(`cfg-${prefix}-fraccion-dia`),
    valor_primera_fraccion: getNumberValue(`cfg-${prefix}-valor-primera`),
    tiempo_primera_fraccion: getNumberValue(`cfg-${prefix}-tiempo-primera`),
    valor_segunda_fraccion: getNumberValue(`cfg-${prefix}-valor-segunda`),
    tiempo_segunda_fraccion: getNumberValue(`cfg-${prefix}-tiempo-segunda`),
  };
}

function parseHoraCompletaInput(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minutes = match[2] || "00";
  const suffix = match[3];

  if (minutes !== "00") return null;

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "AM") hour = hour === 12 ? 0 : hour;
    if (suffix === "PM") hour = hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return hour;
}

function formatHoraCompleta(value) {
  const hour = parseHoraCompletaInput(value);
  if (hour === null) return "";
  return `${String(hour).padStart(2, "0")}:00`;
}

function renderParqueaderoReglas(reglas = []) {
  const tbody = document.getElementById("cfg-reglas-tbody");
  if (!tbody) return;

  tbody.innerHTML = reglas.map((regla) => `
    <tr data-dia="${regla.dia_codigo}">
      <td>
        <select data-field="aplica">
          <option value="false"${regla.aplica ? "" : " selected"}>NO</option>
          <option value="true"${regla.aplica ? " selected" : ""}>SI</option>
        </select>
      </td>
      <td>
        <input type="text" data-field="dia_nombre" value="${regla.dia_codigo}" readonly />
      </td>
      <td>
        <input type="text" data-field="hora_inicio_gratis" value="${formatHoraCompleta(regla.hora_inicio_gratis)}" placeholder="07:00 / 7 AM" title="Use horas completas: 7, 07:00, 7 AM, 7:00 AM o 19:00" />
      </td>
      <td>
        <input type="text" data-field="hora_fin_gratis" value="${formatHoraCompleta(regla.hora_fin_gratis)}" placeholder="11:00 / 11 AM" title="Use horas completas: 11, 11:00, 11 AM, 7 PM o 19:00" />
      </td>
      <td>
        <input type="number" data-field="minutos_gracia" min="0" value="${regla.minutos_gracia}" />
      </td>
    </tr>
  `).join("");
}

function collectParqueaderoReglas() {
  return Array.from(document.querySelectorAll("#cfg-reglas-tbody tr")).map((row) => ({
    row,
    dia_codigo: row.dataset.dia,
    aplica: row.querySelector('[data-field="aplica"]').value === "true",
    hora_inicio_gratis: row.querySelector('[data-field="hora_inicio_gratis"]').value,
    hora_fin_gratis: row.querySelector('[data-field="hora_fin_gratis"]').value,
    minutos_gracia: Number(row.querySelector('[data-field="minutos_gracia"]').value || 0),
  })).map((rule) => {
    const inicio = parseHoraCompletaInput(rule.hora_inicio_gratis);
    const fin = parseHoraCompletaInput(rule.hora_fin_gratis);

    if (inicio === null || fin === null) {
      throw new Error(`Revise las horas del día ${rule.dia_codigo}. Use horas completas como 7, 07:00, 7 AM o 7:00 PM.`);
    }

    return {
      dia_codigo: rule.dia_codigo,
      aplica: rule.aplica,
      hora_inicio_gratis: inicio,
      hora_fin_gratis: fin,
      minutos_gracia: rule.minutos_gracia,
    };
  });
}

async function loadParqueaderoConfig() {
  try {
    const config = await apiFetch('/api/configuracion/parqueadero');
    document.getElementById('cfg-pq-modulo-activo').checked = Boolean(config.general?.modulo_activo);
    document.getElementById('cfg-pq-solo-facturacion').checked = Boolean(config.general?.solo_facturacion);
    setInputValue('cfg-pq-valet', config.general?.valor_valet_parking || 0);
    setVehicleConfig('carro', config.vehiculos?.CARRO);
    setVehicleConfig('moto', config.vehiculos?.MOTO);
    renderParqueaderoReglas(config.reglas || []);
  } catch (error) {
    console.error('Error cargando configuración de parqueadero:', error);
    showError(error.message || 'Error al cargar la configuración de parqueadero', 'pq-config-error');
  }
}

async function handleGuardarParqueaderoConfig(event) {
  event.preventDefault();

  const payload = {
    general: {
      modulo_activo: document.getElementById('cfg-pq-modulo-activo')?.checked || false,
      solo_facturacion: document.getElementById('cfg-pq-solo-facturacion')?.checked || false,
      valor_valet_parking: getNumberValue('cfg-pq-valet'),
    },
    vehiculos: {
      CARRO: getVehicleConfig('carro'),
      MOTO: getVehicleConfig('moto'),
    },
    reglas: collectParqueaderoReglas(),
  };

  try {
    const response = await apiFetch('/api/configuracion/parqueadero', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const config = response.config || response;
    setVehicleConfig('carro', config.vehiculos?.CARRO);
    setVehicleConfig('moto', config.vehiculos?.MOTO);
    renderParqueaderoReglas(config.reglas || []);
    showSuccess('Configuración de parqueadero actualizada', 'pq-config-success');
  } catch (error) {
    showError(error.message, 'pq-config-error');
  }
}

function toggleParqueaderoConfig() {
  const body = document.getElementById('form-parqueadero-config');
  const chevron = document.getElementById('parqueadero-config-chevron');
  if (!body) return;

  body.classList.toggle('hidden');
  if (chevron) chevron.textContent = body.classList.contains('hidden') ? '›' : '▾';
}

async function handleActualizarEmpresa(event) {
  event.preventDefault();

  const logoFile = document.getElementById('empresa-logo-file')?.files?.[0];
  const data = {
    nombre: document.getElementById('empresa-nombre').value,
    nit: document.getElementById('empresa-nit').value,
    ciudad: document.getElementById('empresa-ciudad').value,
    direccion: document.getElementById('empresa-direccion').value,
    telefono: document.getElementById('empresa-telefono').value,
    email_contacto: document.getElementById('empresa-email').value,
    zona_horaria: document.getElementById('empresa-zona-horaria').value,
  };

  try {
    if (logoFile) {
      await uploadEmpresaLogo(logoFile);
    }

    await apiFetch('/api/empresa', {
      method: 'PUT',
      body: JSON.stringify(data),
    });

    showSuccess('Empresa actualizada exitosamente', 'empresa-success');
    // Actualizar sidebar
    document.getElementById('sidebar-empresa').textContent = data.nombre;
    localStorage.setItem(STORAGE.EMPRESA, data.nombre);
    await loadConfig();

  } catch (error) {
    showError(error.message, 'empresa-error');
  }
}

function updateLogoPreview(logoUrl, empresaNombre) {
  const preview = document.getElementById('logo-preview');
  if (!preview) return;
  preview.innerHTML = '';

  if (logoUrl) {
    const img = document.createElement('img');
    img.src = logoUrl;
    img.alt = 'Logo de la empresa';
    preview.appendChild(img);
  } else {
    preview.textContent = 'Sin logo';
  }

  const logoCircle = document.querySelector('.sidebar-logo-circle');
  if (logoCircle) {
    if (logoUrl) {
      logoCircle.style.backgroundImage = `url(${logoUrl})`;
      logoCircle.style.backgroundSize = 'cover';
      logoCircle.style.backgroundPosition = 'center';
      logoCircle.textContent = '';
    } else {
      logoCircle.style.backgroundImage = 'none';
      logoCircle.textContent = empresaNombre ? empresaNombre.slice(0, 1).toUpperCase() : 'A';
    }
  }
}

function updateSidebarLogo(logoUrl, empresaNombre) {
  const logoCircle = document.querySelector('.sidebar-logo-circle');
  if (!logoCircle) return;

  if (logoUrl) {
    logoCircle.style.backgroundImage = `url(${logoUrl})`;
    logoCircle.style.backgroundSize = 'cover';
    logoCircle.style.backgroundPosition = 'center';
    logoCircle.textContent = '';
  } else {
    logoCircle.style.backgroundImage = 'none';
    logoCircle.textContent = empresaNombre ? empresaNombre.slice(0, 1).toUpperCase() : 'A';
  }
}

async function handleLogoFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    updateLogoPreview('', document.getElementById('empresa-nombre').value);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const preview = document.getElementById('logo-preview');
    if (!preview) return;
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = reader.result;
    img.alt = 'Vista previa del logo';
    preview.appendChild(img);
  };
  reader.readAsDataURL(file);
}

async function uploadEmpresaLogo(file) {
  const formData = new FormData();
  formData.append('logo', file);

  const result = await apiFetch('/api/empresa/logo', {
    method: 'POST',
    body: formData,
  });

  if (result.logo_url) {
    updateLogoPreview(result.logo_url, document.getElementById('empresa-nombre').value);
  }

  return result;
}

async function handleVerLicencias() {
  try {
    const licencias = await apiFetch('/api/licencias');
    const grid = document.getElementById('licencias-grid');
    grid.innerHTML = '';

    licencias.forEach(licencia => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h4>${licencia.nombre}</h4>
        <p>${licencia.descripcion || 'Sin descripción'}</p>
        <p><strong>Precio:</strong> $${licencia.precio || 0}</p>
      `;
      grid.appendChild(card);
    });

    document.getElementById('licencias-lista').hidden = false;
  } catch (error) {
    showError('Error al cargar licencias');
  }
}

async function handleAsignarLicencia() {
  // Por simplicidad, mostrar un prompt o modal simple
  const licenciaId = prompt('ID de la licencia a asignar:');
  const fechaInicio = prompt('Fecha de inicio (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
  const fechaFin = prompt('Fecha de fin (YYYY-MM-DD, opcional):');

  if (!licenciaId || !fechaInicio) return;

  try {
    await apiFetch('/api/licencias/asignar', {
      method: 'POST',
      body: JSON.stringify({
        empresa_id: JSON.parse(localStorage.getItem('user_info')).empresa_id,
        licencia_id: parseInt(licenciaId),
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin || null,
      }),
    });

    showSuccess('Licencia asignada exitosamente');
    loadLicenciaInfo();
  } catch (error) {
    showError(error.message);
  }
}

async function handleNotificarVencimientos() {
  try {
    const result = await apiFetch('/api/licencias/enviar-notificaciones', {
      method: 'POST',
    });
    showSuccess(`Notificaciones enviadas: ${result.enviados}, Errores: ${result.errores}`);
  } catch (error) {
    showError(error.message);
  }
}

/* ======================================================
   MÓDULO LAVADERO
======================================================*/
async function loadLavaderoEmpleados() {
  try {
    const empleados = await apiFetch("/api/empleados?rol=Lavador");
    const select = document.getElementById("lav-lavador");
    if (select) {
      select.innerHTML = '<option value="">Seleccione...</option>';
      empleados.forEach(emp => {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.nombre;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error cargando lavadores:", err);
  }
}

async function handleNovaLavado(event) {
  event.preventDefault();
  const placa = document.getElementById("lav-placa").value.trim();
  const tipo = document.getElementById("lav-tipo").value;
  const lavador_id = document.getElementById("lav-lavador").value;
  const obs = document.getElementById("lav-obs").value;
  
  if (!placa || !tipo || !lavador_id) {
    showMessage("lav-msg", "Todos los campos obligatorios deben estar completos.", true);
    return;
  }

  try {
    await apiFetch("/api/lavadero", {
      method: "POST",
      body: JSON.stringify({ placa, tipo_lavado: tipo, empleado_id: lavador_id, notas: obs }),
    });
    showMessage("lav-msg", "Orden de lavado registrada exitosamente.");
    event.target.reset();
    cargarOrdeneesLavadero();
  } catch (err) {
    showMessage("lav-msg", err.message, true);
  }
}

async function cargarOrdeneesLavadero() {
  try {
    const ordenes = await apiFetch("/api/lavadero");
    const historial = await apiFetch("/api/lavadero/historial");
    const busqueda = document.getElementById("lav-buscar")?.value.trim().toLowerCase() || "";
    const ordenesFiltradas = busqueda
      ? ordenes.filter(o =>
          `${o.placa || ""} ${o.empleado_nombre || ""} ${o.lavador_nombre || ""}`
            .toLowerCase()
            .includes(busqueda)
        )
      : ordenes;
    const activos = ordenesFiltradas.filter(o => o.estado !== "Completado");
    const completados = historial.filter(o => o.estado === "Completado");

    // Tabla activos
    const tbodyActivos = document.getElementById("lav-activos-tbody");
    const emptyActivos = document.getElementById("lav-empty");
    if (tbodyActivos) {
      tbodyActivos.innerHTML = activos.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.tipo_lavado}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${new Date(ord.hora_inicio).toLocaleString()}</td>
          <td><span class="badge">${ord.estado}</span></td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="marcarLavadoCompleto(${ord.id})">Completar y cobrar</button>
          </td>
        </tr>
      `).join("");
      emptyActivos.hidden = activos.length > 0;
    }

    // Tabla completados
    const tbodyCompletados = document.getElementById("lav-completados-tbody");
    const emptyCompletados = document.getElementById("lav-completados-empty");
    const busquedaHistorial = document.getElementById("lav-historial-buscar")?.value.trim().toLowerCase() || "";
    const completadosFiltrados = busquedaHistorial
      ? completados.filter(o =>
          `${o.placa || ""} ${o.tipo_lavado || ""} ${o.tipo_lavado_nombre || ""} ${o.lavador_nombre || ""} ${o.empleado_nombre || ""}`
            .toLowerCase()
            .includes(busquedaHistorial)
        )
      : completados;
    if (tbodyCompletados) {
      tbodyCompletados.innerHTML = completadosFiltrados.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.tipo_lavado_nombre || ord.tipo_lavado}</td>
          <td>${ord.lavador_nombre || ord.empleado_nombre || "Sin asignar"}</td>
          <td>${ord.hora_fin ? Math.max(1, Math.round((new Date(ord.hora_fin) - new Date(ord.hora_inicio)) / 60000)) : "N/A"} min</td>
          <td>${formatMoney(ord.precio)}</td>
          <td>${ord.metodo_pago || "No registrado"}</td>
        </tr>
      `).join("");
      emptyCompletados.hidden = completadosFiltrados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando órdenes de lavadero:", err);
  }
}

async function marcarLavadoCompleto(id) {
  try {
    await abrirModalCobroServicio("lavadero", id);
  } catch (err) {
    showMessage("lav-msg", err.message, true);
  }
}

async function cargarHistorialParqueadero() {
  const tbody = document.getElementById("pq-historial-tbody");
  const empty = document.getElementById("pq-historial-empty");

  if (!tbody || !empty) return;

  try {
    const data = await apiFetch("/api/parqueadero/historial?limit=50");
    const busqueda = document.getElementById("pq-historial-buscar")?.value.trim().toLowerCase() || "";
    const dataFiltrada = busqueda
      ? data.filter(item =>
          `${item.placa || ""} ${item.tipo_vehiculo || ""} ${item.nombre_cliente || ""}`
            .toLowerCase()
            .includes(busqueda)
        )
      : data;
    tbody.innerHTML = "";

    if (!Array.isArray(dataFiltrada) || dataFiltrada.length === 0) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;

    tbody.innerHTML = dataFiltrada.map(item => `
      <tr>
        <td>${item.placa}</td>
        <td>${item.tipo_vehiculo}</td>
        <td>${servicioParqueaderoLabel(item.tipo_servicio)}</td>
        <td>${item.nombre_cliente || "-"}</td>
        <td>${formatDateTime(item.hora_entrada)}</td>
        <td>${formatDateTime(item.hora_salida)}</td>
        <td>${item.minutos_total ? formatDuration(item.hora_entrada, item.hora_salida) : "-"}</td>
        <td>${formatMoney(item.valor_total || 0)}</td>
        <td>${item.metodo_pago || "No registrado"}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Error cargando historial de parqueadero:", err);
    empty.hidden = false;
    empty.textContent = "Error cargando historial de parqueadero.";
  }
}

/* ======================================================
   MÓDULO TALLER
======================================================*/
async function loadTallerMecanicos() {
  try {
    const empleados = await apiFetch("/api/empleados?rol=Mecánico");
    const select = document.getElementById("tal-mecanico");
    if (select) {
      select.innerHTML = '<option value="">Seleccione...</option>';
      empleados.forEach(emp => {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.nombre;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error cargando mecánicos:", err);
  }
}

async function handleNuevaOrdenTaller(event) {
  event.preventDefault();
  const placa = document.getElementById("tal-placa").value.trim();
  const descripcion = document.getElementById("tal-descripcion").value;
  const mecanico_id = document.getElementById("tal-mecanico").value;
  const valor = parseFloat(document.getElementById("tal-valor").value);
  const notas = document.getElementById("tal-notas").value;

  if (!placa || !descripcion || !mecanico_id || !valor) {
    showMessage("tal-msg", "Todos los campos obligatorios deben estar completos.", true);
    return;
  }

  try {
    await apiFetch("/api/taller", {
      method: "POST",
      body: JSON.stringify({ placa, descripcion, empleado_id: mecanico_id, total_general: valor, notas }),
    });
    showMessage("tal-msg", "Orden de taller registrada exitosamente.");
    event.target.reset();
    cargarOrdensTaller();
  } catch (err) {
    showMessage("tal-msg", err.message, true);
  }
}

async function cargarOrdensTaller() {
  try {
    const ordenes = await apiFetch("/api/taller");
    const activos = ordenes.filter(o => o.estado !== "Entregado");
    const completados = ordenes.filter(o => o.estado === "Entregado");

    // Tabla activos
    const tbodyActivos = document.getElementById("tal-activos-tbody");
    const emptyActivos = document.getElementById("tal-empty");
    if (tbodyActivos) {
      tbodyActivos.innerHTML = activos.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.descripcion}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${formatMoney(ord.total_general)}</td>
          <td><span class="badge">${ord.estado}</span></td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="completarOrdenTaller(${ord.id})">Entregar y cobrar</button>
          </td>
        </tr>
      `).join("");
      emptyActivos.hidden = activos.length > 0;
    }

    // Tabla completados
    const tbodyCompletados = document.getElementById("tal-completados-tbody");
    const emptyCompletados = document.getElementById("tal-completados-empty");
    const busquedaHistorial = document.getElementById("tal-historial-buscar")?.value.trim().toLowerCase() || "";
    const completadosFiltrados = busquedaHistorial
      ? completados.filter(o =>
          `${o.placa || ""} ${o.empleado_nombre || ""} ${o.descripcion || ""}`
            .toLowerCase()
            .includes(busquedaHistorial)
        )
      : completados;
    if (tbodyCompletados) {
      tbodyCompletados.innerHTML = completadosFiltrados.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.descripcion}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${formatMoney(ord.total_general)}</td>
          <td>${new Date(ord.fecha_entrega).toLocaleDateString()}</td>
          <td>${ord.metodo_pago || "No registrado"}</td>
        </tr>
      `).join("");
      emptyCompletados.hidden = completadosFiltrados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando órdenes de taller:", err);
  }
}

async function completarOrdenTaller(id) {
  try {
    await abrirModalCobroServicio("taller", id);
  } catch (err) {
    showMessage("tal-msg", err.message, true);
  }
}

/* ======================================================
   MÓDULO CLIENTES
======================================================*/
async function handleNuevoCliente(event) {
  event.preventDefault();
  const nombre = document.getElementById("cli-nombre").value.trim();
  const documento = document.getElementById("cli-documento").value.trim();
  const telefono = document.getElementById("cli-telefono").value.trim();
  const email = document.getElementById("cli-email").value.trim();

  if (!nombre) {
    showMessage("cli-msg", "El nombre es obligatorio.", true);
    return;
  }

  try {
    await apiFetch("/api/clientes", {
      method: "POST",
      body: JSON.stringify({ nombre, documento: documento || null, telefono: telefono || null, correo: email || null }),
    });
    showMessage("cli-msg", "Cliente registrado exitosamente.");
    event.target.reset();
    cargarListaClientes();
  } catch (err) {
    showMessage("cli-msg", err.message, true);
  }
}

async function cargarListaClientes() {
  try {
    const clientes = await apiFetch("/api/clientes");
    const tbody = document.getElementById("cli-lista-tbody");
    const empty = document.getElementById("cli-lista-empty");

    if (tbody) {
      tbody.innerHTML = clientes.map(cli => `
        <tr>
          <td>${cli.nombre}</td>
          <td>${cli.documento || "N/A"}</td>
          <td>${cli.telefono || "N/A"}</td>
          <td>${cli.correo || "N/A"}</td>
          <td>${cli.total_servicios || 0}</td>
          <td>${new Date(cli.fecha_registro).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm btn-secondary" onclick="verDetallesCliente(${cli.id})">Ver</button>
          </td>
        </tr>
      `).join("");
      empty.hidden = clientes.length > 0;
    }
  } catch (err) {
    console.error("Error cargando clientes:", err);
  }
}

function filtrarClientes() {
  const buscar = document.getElementById("cli-buscar").value.toLowerCase();
  const filas = document.querySelectorAll("#cli-lista-tbody tr");
  filas.forEach(fila => {
    const texto = fila.textContent.toLowerCase();
    fila.style.display = texto.includes(buscar) ? "" : "none";
  });
}

async function verDetallesCliente(id) {
  try {
    const cliente = await apiFetch(`/api/clientes/${id}`);
    alert(`Cliente: ${cliente.cliente.nombre}\nTeléfono: ${cliente.cliente.telefono}\nEmail: ${cliente.cliente.correo}\nTotal gastado: ${formatMoney(cliente.estadisticas.total_gastado)}`);
  } catch (err) {
    alert("Error cargando detalles: " + err.message);
  }
}

/* ======================================================
   MÓDULO EMPLEADOS
======================================================*/
async function handleNuevoEmpleado(event) {
  event.preventDefault();
  const nombre = document.getElementById("emp-nombre").value.trim();
  const rol = document.getElementById("emp-rol").value;
  const telefono = document.getElementById("emp-telefono").value.trim();
  const email = document.getElementById("emp-email").value.trim();

  if (!nombre || !rol) {
    showMessage("emp-msg", "Nombre y rol son obligatorios.", true);
    return;
  }

  try {
    await apiFetch("/api/empleados", {
      method: "POST",
      body: JSON.stringify({ nombre, rol, telefono: telefono || null, email: email || null }),
    });
    showMessage("emp-msg", "Empleado registrado exitosamente.");
    event.target.reset();
    cargarListaEmpleados();
    loadLavaderoEmpleados();
    loadTallerMecanicos();
  } catch (err) {
    showMessage("emp-msg", err.message, true);
  }
}

async function cargarListaEmpleados() {
  try {
    const empleados = await apiFetch("/api/empleados");
    const tbody = document.getElementById("emp-lista-tbody");
    const empty = document.getElementById("emp-lista-empty");

    if (tbody) {
      tbody.innerHTML = empleados.map(emp => `
        <tr>
          <td>${emp.nombre}</td>
          <td>${emp.rol}</td>
          <td>${emp.telefono || "N/A"}</td>
          <td>${emp.email || "N/A"}</td>
          <td>${new Date(emp.fecha_registro || emp.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="desactivarEmpleado(${emp.id})">Desactivar</button>
          </td>
        </tr>
      `).join("");
      empty.hidden = empleados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando empleados:", err);
  }
}

function filtrarEmpleadosPorRol() {
  const rol = document.getElementById("emp-filtro-rol").value;
  const filas = document.querySelectorAll("#emp-lista-tbody tr");
  filas.forEach(fila => {
    const texto = fila.cells[1].textContent.toLowerCase();
    fila.style.display = !rol || texto.includes(rol.toLowerCase()) ? "" : "none";
  });
}

async function desactivarEmpleado(id) {
  if (!confirm("¿Desactivar este empleado?")) return;
  try {
    await apiFetch(`/api/empleados/${id}`, {
      method: "DELETE",
    });
    cargarListaEmpleados();
    showMessage("emp-msg", "Empleado desactivado.");
  } catch (err) {
    showMessage("emp-msg", err.message, true);
  }
}

/* ======================================================
   MÓDULO REPORTES
======================================================*/
function setFechasDefecto() {
  const hoy = new Date();
  const hace30 = new Date(hoy);
  hace30.setDate(hace30.getDate() - 30);

  document.getElementById("rep-desde").valueAsDate = hace30;
  document.getElementById("rep-hasta").valueAsDate = hoy;
}

async function handleGenerarReportes(event) {
  event.preventDefault();
  const desde = document.getElementById("rep-desde").value;
  const hasta = document.getElementById("rep-hasta").value;

  if (!desde || !hasta) {
    alert("Seleccione rango de fechas.");
    return;
  }

  try {
    const resumen = await apiFetch(`/api/reportes/resumen?desde=${desde}&hasta=${hasta}`);
    const diario = await apiFetch(`/api/reportes/diario?desde=${desde}&hasta=${hasta}`);
    const clientes = await apiFetch(`/api/reportes/clientes?desde=${desde}&hasta=${hasta}`);
    const empleados = await apiFetch(`/api/reportes/empleados?desde=${desde}&hasta=${hasta}`);

    // Mostrar resumen
    document.getElementById("rep-pq-total").textContent = formatMoney(resumen.parqueadero.total);
    document.getElementById("rep-pq-cant").textContent = `${resumen.parqueadero.cantidad} servicios`;
    document.getElementById("rep-lav-total").textContent = formatMoney(resumen.lavadero.total);
    document.getElementById("rep-lav-cant").textContent = `${resumen.lavadero.cantidad} servicios`;
    document.getElementById("rep-tal-total").textContent = formatMoney(resumen.taller.total);
    document.getElementById("rep-tal-cant").textContent = `${resumen.taller.cantidad} servicios`;
    document.getElementById("rep-total").textContent = formatMoney(resumen.total_general);
    document.getElementById("rep-cant-total").textContent = `${resumen.cantidad_total} servicios`;

    // Mostrar diario
    const tbodyDiario = document.getElementById("rep-diario-tbody");
    if (tbodyDiario) {
      tbodyDiario.innerHTML = diario.dias.map(dia => `
        <tr>
          <td>${dia.fecha}</td>
          <td>${formatMoney(dia.parqueadero.total)}</td>
          <td>${formatMoney(dia.lavadero.total)}</td>
          <td>${formatMoney(dia.taller.total)}</td>
          <td><strong>${formatMoney(dia.total_general)}</strong></td>
        </tr>
      `).join("");
      document.getElementById("rep-diario-empty").hidden = diario.dias.length > 0;
    }

    // Mostrar clientes
    const tbodyClientes = document.getElementById("rep-clientes-tbody");
    if (tbodyClientes) {
      tbodyClientes.innerHTML = clientes.clientes.map(cli => `
        <tr>
          <td>${cli.nombre}</td>
          <td>${cli.total_servicios}</td>
          <td>${formatMoney(cli.total_gastado)}</td>
        </tr>
      `).join("");
      document.getElementById("rep-clientes-empty").hidden = clientes.clientes.length > 0;
    }

    // Mostrar empleados
    const tbodyEmpleados = document.getElementById("rep-empleados-tbody");
    if (tbodyEmpleados) {
      tbodyEmpleados.innerHTML = empleados.empleados.map(emp => `
        <tr>
          <td>${emp.nombre}</td>
          <td>${emp.rol}</td>
          <td>${Math.max(emp.lavados_realizados || 0, emp.ordenes_taller || 0)}</td>
          <td>${formatMoney(emp.total_general)}</td>
        </tr>
      `).join("");
      document.getElementById("rep-empleados-empty").hidden = empleados.empleados.length > 0;
    }
  } catch (err) {
    alert("Error generando reportes: " + err.message);
  }
}

/* ======================================================
   UTILIDADES
======================================================*/
function showMessage(elementId, message, isError = false) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.className = "small-message " + (isError ? "error" : "ok");
    el.hidden = false;
    setTimeout(() => (el.hidden = true), 4000);
  }
}
