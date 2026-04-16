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
  LICENSE: "ag360_license_permissions",
  THEME: "ag360_theme",
};

const VIEW_TITLES = {
  dashboard: "Dashboard",
  modulos: "Módulos",
  empresas: "Empresas",
  usuarios: "Usuarios",
  parqueadero: "Parqueadero",
  lavadero: "Lavadero",
  taller: "Taller",
  clientes: "Clientes",
  empleados: "Empleados",
  reportes: "Reportes",
  config: "Configuración",
};

const VIEW_LICENSE_MODULES = {
  dashboard: "dashboard",
  empresas: "empresas",
  parqueadero: "parqueadero",
  lavadero: "lavadero",
  taller: "taller",
  clientes: "clientes",
  empleados: "empleados",
  usuarios: "usuarios",
  reportes: "reportes",
  config: "configuracion",
};

const ALWAYS_AVAILABLE_MODULES = new Set(["dashboard"]);

let licensePermissionsState = {
  loaded: false,
  modules: null,
  license: null,
  expired: false,
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
  setElementText("config-theme-status", selectedTheme === "light" ? "Modo claro" : "Modo oscuro");

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
    await initAfterLogin();
    updateSidebarLogo(data.empresa?.logo_url, data.empresa?.nombre);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

function logout() {
  localStorage.removeItem(STORAGE.TOKEN);
  localStorage.removeItem(STORAGE.EMAIL);
  localStorage.removeItem(STORAGE.EMPRESA);
  localStorage.removeItem(STORAGE.LICENSE);
  localStorage.removeItem("empresa_logo");
  localStorage.removeItem("user_info");
  licensePermissionsState = {
    loaded: false,
    modules: null,
    license: null,
    expired: false,
  };
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

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("user_info") || "{}");
  } catch {
    return {};
  }
}

function normalizeRole(role) {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function userIsSuperAdmin() {
  return normalizeRole(getCurrentUser().rol) === "superadmin";
}

function userIsAdmin() {
  return ["admin", "administrador", "superadmin"].includes(normalizeRole(getCurrentUser().rol));
}

function userCanManageUsers() {
  return userIsAdmin();
}

function setLicensePermissions(data = {}) {
  const moduleNames = Array.isArray(data.modulos)
    ? data.modulos.map((modulo) => normalizeRole(typeof modulo === "string" ? modulo : modulo?.nombre))
    : null;

  licensePermissionsState = {
    loaded: true,
    modules: moduleNames ? new Set(moduleNames) : null,
    license: data.licencia || null,
    expired: Boolean(data.expirada),
  };

  localStorage.setItem(
    STORAGE.LICENSE,
    JSON.stringify({
      modulos: moduleNames || null,
      licencia: licensePermissionsState.license,
      expirada: licensePermissionsState.expired,
    })
  );
}

function restoreCachedLicensePermissions() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE.LICENSE) || "{}");
    if (Array.isArray(cached.modulos)) {
      setLicensePermissions({
        modulos: cached.modulos,
        licencia: cached.licencia,
        expirada: cached.expirada,
      });
      return true;
    }
  } catch {
    localStorage.removeItem(STORAGE.LICENSE);
  }
  return false;
}

async function loadLicensePermissions() {
  try {
    const data = await apiFetch("/api/empresa/licencia/permisos");
    setLicensePermissions(data);
  } catch (error) {
    console.warn("No se pudieron cargar permisos de licencia:", error);
    if (!restoreCachedLicensePermissions()) {
      licensePermissionsState = {
        loaded: true,
        modules: null,
        license: null,
        expired: false,
      };
    }
  }
}

function isModuleAllowed(moduleName) {
  const moduleKey = normalizeRole(moduleName);
  if (!moduleKey || ALWAYS_AVAILABLE_MODULES.has(moduleKey)) return true;
  if (moduleKey === "empresas" && userIsSuperAdmin()) return true;
  if (!licensePermissionsState.loaded || !licensePermissionsState.modules) return true;
  return licensePermissionsState.modules.has(moduleKey);
}

function getModuleBlockedMessage(moduleName) {
  const moduleLabel = moduleName === "configuracion"
    ? "Configuración"
    : VIEW_TITLES[moduleName] || String(moduleName || "Este módulo");

  if (licensePermissionsState.expired) {
    return `La licencia actual está vencida. Renueva el plan para abrir ${moduleLabel}.`;
  }

  const licenseName = licensePermissionsState.license?.nombre || "actual";
  return `${moduleLabel} no está incluido en la licencia ${licenseName}.`;
}

function showModuleBlockedMessage(moduleName) {
  alert(getModuleBlockedMessage(moduleName));
}

function applyPermissionVisibility() {
  const canManageCompanies = userIsSuperAdmin();
  document.querySelectorAll("[data-superadmin-only]").forEach((element) => {
    element.classList.toggle("hidden", !canManageCompanies);
  });

  const canManageUsers = userCanManageUsers();
  document.querySelectorAll("[data-useradmin-only]").forEach((element) => {
    element.classList.toggle("hidden", !canManageUsers);
  });

  document.querySelectorAll("[data-license-module]").forEach((element) => {
    const moduleName = element.dataset.licenseModule;
    const allowed = isModuleAllowed(moduleName);
    element.classList.toggle("module-locked", !allowed);
    element.classList.toggle("module-included", allowed);
    element.setAttribute("aria-disabled", String(!allowed));
    element.title = allowed ? "" : getModuleBlockedMessage(moduleName);

    if (element.classList.contains("module-tile-enabled")) {
      element.tabIndex = allowed ? 0 : -1;
    }
  });
}

function changeView(view) {
  const targetView = document.getElementById(`view-${view}`);
  if (!targetView) return false;

  if (view === "empresas" && !userIsSuperAdmin()) {
    changeView("dashboard");
    return false;
  }

  if (view === "usuarios" && !userCanManageUsers()) {
    changeView("dashboard");
    return false;
  }

  const licenseModule = VIEW_LICENSE_MODULES[view];
  if (!isModuleAllowed(licenseModule)) {
    showModuleBlockedMessage(licenseModule);
    changeView("modulos");
    return false;
  }

  document.querySelectorAll(".view").forEach(v => v.classList.remove("visible"));
  targetView.classList.add("visible");

  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  document.getElementById("current-view-title").textContent = VIEW_TITLES[view] || view.toUpperCase();

  if (view === "parqueadero") {
    cargarParqueaderoActivo();
    cargarHistorialParqueadero();
    cargarMensualidadesParqueadero();
  }
  if (view === "dashboard") {
    loadDashboard();
  }
  if (view === "empresas") {
    cargarEmpresas();
  }
  if (view === "usuarios") {
    cargarUsuariosSistema();
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
    handleGenerarReportes();
  }
  if (view === "config") {
    loadConfig();
  }

  return true;
}

function openModuleTile(tile) {
  const view = tile.dataset.openView;
  if (!view) return;

  if (tile.classList.contains("module-locked")) {
    showModuleBlockedMessage(tile.dataset.licenseModule);
    return;
  }

  const changed = changeView(view);
  if (!changed) return;

  if (view === "config" && tile.dataset.openConfigTab) {
    setConfigTab(tile.dataset.openConfigTab);
  }

  if (view === "parqueadero" && tile.dataset.parkingFlow) {
    seleccionarFlujoParqueadero(tile.dataset.parkingFlow);
  }
}

function initModuleCatalog() {
  document.querySelectorAll(".module-tile-enabled").forEach((tile) => {
    tile.addEventListener("click", () => openModuleTile(tile));
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openModuleTile(tile);
      }
    });
  });
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
  ["cobro-metodo-pago", "cobro-referencia", "cobro-detalle-pago", "cobro-observaciones", "cobro-monto-pago"]
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

function configureCobroMonto({
  total = 0,
  pagado = 0,
  saldo = 0,
  montoSugerido = null,
  allowPartial = false,
  requireAmount = true,
}) {
  const montoInput = document.getElementById("cobro-monto-pago");
  const montoHelp = document.getElementById("cobro-monto-help");
  if (!montoInput) return;

  const totalNum = Number(total || 0);
  const pagadoNum = Number(pagado || 0);
  const saldoNum = Number(saldo || 0);
  const sugerido = montoSugerido === null || montoSugerido === undefined
    ? (saldoNum > 0 ? saldoNum : totalNum)
    : Number(montoSugerido || 0);

  if (!requireAmount && saldoNum <= 0 && totalNum <= 0) {
    montoInput.value = "0";
    montoInput.max = "0";
    montoInput.disabled = true;
    if (montoHelp) {
      montoHelp.textContent = "Este cierre no requiere cobro adicional.";
    }
    return;
  }

  montoInput.value = sugerido > 0 ? String(Math.round(sugerido)) : "";
  montoInput.max = saldoNum > 0 ? String(Math.round(saldoNum)) : "";
  montoInput.disabled = !allowPartial;

  if (montoHelp) {
    montoHelp.textContent = allowPartial
      ? `Saldo disponible: ${formatMoney(saldoNum)}. Puedes registrar el pago completo o un abono.`
      : `Este flujo registra el pago completo del servicio por ${formatMoney(Math.max(totalNum - pagadoNum, 0))}.`;
  }
}

function getActiveViewName() {
  return document.querySelector(".view.visible")?.id?.replace(/^view-/, "") || "";
}

function setCobroServicioActionLabel(label) {
  const button = document.getElementById("btn-confirmar-cobro-servicio");
  if (button) {
    button.textContent = label || "✓ Confirmar servicio y pago";
  }
}

function showCobroServicioMessage(messageId, message, isError = false) {
  if (messageId && document.getElementById(messageId)) {
    showMessage(messageId, message, isError);
    return;
  }

  alert(message);
}

function resolvePendingPaymentMessageId(modulo) {
  const activeView = getActiveViewName();
  if (activeView === "reportes") return "rep-caja-msg";
  if (activeView === "clientes") return "cli-action-msg";
  if (activeView === "parqueadero") return "pq-msg";
  if (modulo === "lavadero") return "lav-msg";
  if (modulo === "taller") return "tal-msg";
  return "cli-msg";
}

function buildCobroDetallePayload({ referencia, detalle, observaciones }) {
  const payload = {};
  if (referencia) payload.referencia = referencia;
  if (detalle) payload.detalle = detalle;
  if (observaciones) payload.observaciones = observaciones;
  return Object.keys(payload).length ? payload : null;
}

function populateCobroServicioModal({
  title,
  placa,
  tipo,
  responsable,
  estado,
  cliente,
  inicio,
  fin,
  tiempo,
  valor,
  pagado = 0,
  saldo = null,
  montoSugerido = null,
  allowPartial = false,
  requireAmount = true,
  actionLabel = "✓ Confirmar servicio y pago",
}) {
  const total = Number(valor || 0);
  const pagadoNum = Number(pagado || 0);
  const saldoNum = saldo === null || saldo === undefined
    ? Math.max(total - pagadoNum, 0)
    : Number(saldo || 0);

  setText("cobro-servicio-title", title || "Confirmar servicio y registrar pago");
  setText("cobro-servicio-placa", placa || "—");
  setText("cobro-servicio-tipo", tipo || "Servicio");
  setText("cobro-servicio-responsable", responsable || "Sin asignar");
  setText("cobro-servicio-estado", estado || "—");
  setText("cobro-servicio-cliente", cliente || "No registrado");
  setText("cobro-servicio-inicio", inicio || "—");
  setText("cobro-servicio-fin", fin || "—");
  setText("cobro-servicio-tiempo", tiempo || "—");
  setText("cobro-servicio-valor", formatMoney(total));
  setText("cobro-servicio-pagado", formatMoney(pagadoNum));
  setText("cobro-servicio-saldo", formatMoney(saldoNum));
  configureCobroMonto({
    total,
    pagado: pagadoNum,
    saldo: saldoNum,
    montoSugerido,
    allowPartial,
    requireAmount,
  });
  setCobroServicioActionLabel(actionLabel);
  document.getElementById("modal-cobro-servicio")?.classList.remove("hidden");
}

function configureSalidaMonto({ total = 0, esMensualidad = false }) {
  const montoInput = document.getElementById("pq-monto-pago");
  const montoHelp = document.getElementById("pq-monto-help");
  if (!montoInput) return;

  const totalNum = Number(total || 0);
  const requiereCobro = !esMensualidad && totalNum > 0;

  if (!requiereCobro) {
    montoInput.value = "0";
    montoInput.max = "0";
    montoInput.disabled = true;
    if (montoHelp) {
      montoHelp.textContent = esMensualidad
        ? "Esta salida está cubierta por mensualidad."
        : "Esta salida no requiere cobro adicional.";
    }
    return;
  }

  montoInput.value = String(Math.round(totalNum));
  montoInput.max = String(Math.round(totalNum));
  montoInput.disabled = false;
  if (montoHelp) {
    montoHelp.textContent = `Valor pendiente: ${formatMoney(totalNum)}. Puedes registrar el pago completo o un abono.`;
  }
}

async function refrescarContextoDespuesDeCobro() {
  const tareas = [loadDashboard()];
  const activeView = getActiveViewName();

  if (activeView === "parqueadero") {
    tareas.push(cargarParqueaderoActivo());
    tareas.push(cargarHistorialParqueadero());
    tareas.push(cargarMensualidadesParqueadero());
  }

  if (activeView === "lavadero") {
    tareas.push(cargarOrdeneesLavadero());
  }

  if (activeView === "taller") {
    tareas.push(cargarOrdensTaller());
  }

  if (activeView === "reportes" && reportesActuales) {
    tareas.push(handleGenerarReportes());
    tareas.push(cargarArqueosCaja());
  }

  const clienteId = clientePerfilActual?.cliente?.id;
  if (clienteId) {
    tareas.push((async () => {
      const data = await apiFetch(`/api/clientes/${clienteId}`);
      if (String(clientePerfilActual?.cliente?.id || "") === String(clienteId)) {
        renderClientePerfil(data);
      }
    })());
  }

  const placa = getVehiculoPerfilPlaca();
  if (placa) {
    tareas.push((async () => {
      const data = await apiFetch(`/api/vehiculos/perfil/${encodeURIComponent(placa)}`);
      if (getVehiculoPerfilPlaca() === placa) {
        renderVehiculo360(data);
      }
    })());
  }

  const resultados = await Promise.allSettled(tareas);
  resultados
    .filter(resultado => resultado.status === "rejected")
    .forEach(resultado => {
      console.error("Error refrescando contexto después del cobro:", resultado.reason);
    });
}

async function abrirModalCobroServicio(modulo, id) {
  limpiarModalCobroServicio();

  if (modulo === "lavadero") {
    const orden = await apiFetch(`/api/lavadero/${id}`);
    const fin = new Date();
    const total = Number(orden.precio || 0);

    cobroServicioActual = {
      modulo,
      id,
      estadoFinal: "Completado",
      endpoint: `/api/lavadero/${id}`,
      successMessageId: "lav-msg",
      successMessageResolver: (response) => response?.mensaje || "Lavado completado y cobro registrado.",
      reload: async () => refrescarContextoDespuesDeCobro(),
      requireAmount: total > 0,
      requirePaymentMethod: total > 0,
      buildBody: ({ metodoPago, referencia, detallePago, montoPago }) => {
        const body = { estado: "Completado" };
        if (metodoPago) body.metodo_pago = metodoPago;
        if (Number.isFinite(montoPago) && montoPago > 0) body.monto_pago = montoPago;
        if (referencia) body.referencia_transaccion = referencia;
        if (detallePago) body.detalle_pago = detallePago;
        return body;
      },
    };

    populateCobroServicioModal({
      title: "Completar lavado y registrar pago",
      placa: orden.placa || "—",
      tipo: orden.tipo_lavado_nombre || orden.tipo_lavado || "Lavado",
      responsable: orden.lavador_nombre || orden.empleado_nombre || "Sin asignar",
      estado: orden.estado || "—",
      cliente: orden.cliente_nombre || "No registrado",
      inicio: formatDateTime(orden.hora_inicio),
      fin: fin.toLocaleString("es-CO"),
      tiempo: formatDuration(orden.hora_inicio, fin),
      valor: total,
      pagado: 0,
      saldo: total,
      montoSugerido: total,
      allowPartial: total > 0,
      requireAmount: total > 0,
      actionLabel: total > 0 ? "✓ Completar y registrar pago o abono" : "✓ Completar servicio",
    });
    return;
  }

  if (modulo === "taller") {
    const data = await apiFetch(`/api/taller/${id}`);
    const orden = data.orden || data;
    const fin = new Date();
    const total = Number(orden.total_general || orden.total_orden || 0);

    cobroServicioActual = {
      modulo,
      id,
      estadoFinal: "Entregado",
      endpoint: `/api/taller/${id}`,
      successMessageId: "tal-msg",
      successMessageResolver: (response) => response?.mensaje || "Orden entregada y cobro registrado.",
      reload: async () => refrescarContextoDespuesDeCobro(),
      requireAmount: total > 0,
      requirePaymentMethod: total > 0,
      buildBody: ({ metodoPago, referencia, detallePago, montoPago }) => {
        const body = { estado: "Entregado" };
        if (metodoPago) body.metodo_pago = metodoPago;
        if (Number.isFinite(montoPago) && montoPago > 0) body.monto_pago = montoPago;
        if (referencia) body.referencia_transaccion = referencia;
        if (detallePago) body.detalle_pago = detallePago;
        return body;
      },
    };

    populateCobroServicioModal({
      title: "Entregar orden de taller y registrar pago",
      placa: orden.placa || "—",
      tipo: orden.descripcion || orden.descripcion_falla || "Orden de taller",
      responsable: orden.mecanico_nombre || orden.empleado_nombre || "Sin asignar",
      estado: orden.estado || "—",
      cliente: orden.cliente_nombre || "No registrado",
      inicio: formatDateTime(orden.fecha_creacion),
      fin: fin.toLocaleString("es-CO"),
      tiempo: formatDuration(orden.fecha_creacion, fin),
      valor: total,
      pagado: 0,
      saldo: total,
      montoSugerido: total,
      allowPartial: total > 0,
      requireAmount: total > 0,
      actionLabel: total > 0 ? "✓ Entregar y registrar pago o abono" : "✓ Entregar orden",
    });
    return;
  }
}

async function abrirPagoPendiente(modulo, id) {
  const moduloNormalizado = String(modulo || "").toLowerCase();
  limpiarModalCobroServicio();

  if (!["parqueadero", "lavadero", "taller"].includes(moduloNormalizado)) {
    alert("Este módulo no tiene cobro pendiente disponible.");
    return;
  }

  const messageId = resolvePendingPaymentMessageId(moduloNormalizado);
  const configBase = {
    modulo: moduloNormalizado,
    id,
    method: "POST",
    successMessageId: messageId,
    reload: async () => refrescarContextoDespuesDeCobro(),
    successMessageResolver: (data) => data?.mensaje || "Pago registrado correctamente.",
  };
  const servicio = await apiFetch(`/api/pagos/servicio/${encodeURIComponent(moduloNormalizado)}/${encodeURIComponent(id)}`);

  cobroServicioActual = {
    ...configBase,
    endpoint: "/api/pagos/servicio",
    buildBody: ({ metodoPago, referencia, detallePago, montoPago }) => ({
      modulo: moduloNormalizado,
      referencia_id: Number(id),
      monto: montoPago,
      metodo_pago: metodoPago,
      referencia_transaccion: referencia || null,
      detalle_pago: detallePago,
    }),
  };

  populateCobroServicioModal({
    title: servicio.monto_pagado > 0
      ? `Registrar abono a ${formatModuleLabel(moduloNormalizado)}`
      : `Registrar pago pendiente de ${formatModuleLabel(moduloNormalizado).toLowerCase()}`,
    placa: servicio.placa || "—",
    tipo: servicio.detalle || servicio.tipo || "Servicio",
    responsable: servicio.responsable_nombre || "Caja principal",
    estado: servicio.estado_cartera || "Pendiente",
    cliente: servicio.cliente_nombre || "No registrado",
    inicio: formatDateTime(servicio.inicio),
    fin: formatDateTime(servicio.fin),
    tiempo: formatDuration(servicio.inicio, servicio.fin || new Date()),
    valor: servicio.monto || 0,
    pagado: servicio.monto_pagado || 0,
    saldo: servicio.saldo_pendiente || servicio.monto || 0,
    montoSugerido: servicio.saldo_pendiente || servicio.monto || 0,
    allowPartial: true,
    actionLabel: servicio.monto_pagado > 0 ? "✓ Registrar abono" : "✓ Registrar pago",
  });
}

function cerrarModalCobroServicio() {
  document.getElementById("modal-cobro-servicio")?.classList.add("hidden");
  setCobroServicioActionLabel("✓ Confirmar servicio y pago");
  cobroServicioActual = null;
}

async function confirmarCobroServicio() {
  if (!cobroServicioActual) {
    alert("No hay un servicio seleccionado para cobrar.");
    return;
  }

  const metodoPago = document.getElementById("cobro-metodo-pago").value.trim();
  const requiereMetodo = cobroServicioActual.requirePaymentMethod !== false;
  if (requiereMetodo && !metodoPago) {
    alert("Debe seleccionar un método de pago.");
    return;
  }

  const referencia = document.getElementById("cobro-referencia").value.trim();
  const detalle = document.getElementById("cobro-detalle-pago").value.trim();
  const observaciones = document.getElementById("cobro-observaciones").value.trim();
  const montoPago = Number(document.getElementById("cobro-monto-pago")?.value || 0);

  const detallePago = buildCobroDetallePayload({
    referencia,
    detalle,
    observaciones,
  });

  const requiereMonto = cobroServicioActual.buildBody && cobroServicioActual.requireAmount !== false;
  if (requiereMonto && (!Number.isFinite(montoPago) || montoPago <= 0)) {
    alert("Debe ingresar un monto válido para registrar el pago.");
    return;
  }

  try {
    const body = cobroServicioActual.buildBody
      ? cobroServicioActual.buildBody({
          metodoPago,
          referencia,
          detalle,
          observaciones,
          detallePago,
          montoPago,
        })
      : {
          estado: cobroServicioActual.estadoFinal,
          metodo_pago: metodoPago,
          detalle_pago: detallePago,
        };

    const response = await apiFetch(cobroServicioActual.endpoint, {
      method: cobroServicioActual.method || "PATCH",
      body: JSON.stringify(body),
    });

    const successMessageId = cobroServicioActual.successMessageId;
    const successMessage = typeof cobroServicioActual.successMessageResolver === "function"
      ? cobroServicioActual.successMessageResolver(response)
      : cobroServicioActual.successMessage;
    const reload = cobroServicioActual.reload;

    cerrarModalCobroServicio();
    if (typeof reload === "function") {
      try {
        await reload();
      } catch (reloadError) {
        console.error("Error refrescando vistas después del cobro:", reloadError);
      }
    }
    showCobroServicioMessage(successMessageId, successMessage);
  } catch (err) {
    showCobroServicioMessage(cobroServicioActual.successMessageId, err.message, true);
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

  await cargarAlertasInteligentes();
}

function getAlertSeverityClass(severidad) {
  const normalized = String(severidad || "INFO").toUpperCase();
  if (normalized === "CRITICA") return "badge-danger";
  if (normalized === "ADVERTENCIA") return "badge-warning";
  return "badge-info";
}

function getAlertSeverityLabel(severidad) {
  const normalized = String(severidad || "INFO").toUpperCase();
  if (normalized === "CRITICA") return "Crítica";
  if (normalized === "ADVERTENCIA") return "Atención";
  return "Info";
}

function setBadgeClass(id, className) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `badge ${className}`;
}

function formatAlertMeta(alerta = {}) {
  const parts = [];
  if (alerta.placa) parts.push(`Placa ${escapeHtml(alerta.placa)}`);
  if (alerta.cliente_nombre) parts.push(escapeHtml(alerta.cliente_nombre));
  if (alerta.monto !== null && alerta.monto !== undefined) parts.push(formatMoney(alerta.monto));
  if (alerta.dias !== null && alerta.dias !== undefined) {
    const dias = Number(alerta.dias);
    parts.push(dias < 0 ? `${Math.abs(dias)} día(s) vencido` : `${dias} día(s)`);
  }
  if (alerta.horas !== null && alerta.horas !== undefined) parts.push(`${alerta.horas} h`);
  if (alerta.fecha) parts.push(formatDateTime(alerta.fecha));

  return parts.length
    ? parts.map(part => `<span>${part}</span>`).join("")
    : "<span>Sin detalle adicional</span>";
}

function renderDashboardAlerts(data = {}) {
  const resumen = data.resumen || {};
  const alertas = Array.isArray(data.alertas) ? data.alertas : [];
  const total = Number(resumen.total || alertas.length || 0);
  const criticas = Number(resumen.criticas || 0);
  const advertencias = Number(resumen.advertencias || 0);
  const mensualidades = resumen.mensualidades || {};
  const cartera = resumen.cartera || {};
  const operaciones = resumen.operaciones || {};
  const licencia = resumen.licencia || {};

  setElementText("dash-alertas-count", `${total} alerta${total === 1 ? "" : "s"}`);
  setElementText(
    "dash-alertas-critical",
    criticas > 0 ? `${criticas} crítica${criticas === 1 ? "" : "s"}` : "Sin críticas"
  );
  setBadgeClass("dash-alertas-critical", criticas > 0 ? "badge-danger" : advertencias > 0 ? "badge-warning" : "badge-success");

  const diasLicencia = licencia.dias_restantes;
  if (diasLicencia === null || diasLicencia === undefined) {
    setElementText("dash-alert-license", "Sin vencimiento");
  } else if (Number(diasLicencia) < 0) {
    setElementText("dash-alert-license", "Vencida");
  } else {
    setElementText("dash-alert-license", `${diasLicencia} día${Number(diasLicencia) === 1 ? "" : "s"}`);
  }
  setElementText("dash-alert-license-note", licencia.nombre || "Plan actual");

  const vencidas = Number(mensualidades.vencidas || 0);
  const proximas = Number(mensualidades.proximas || 0);
  setElementText("dash-alert-monthly", `${vencidas} vencida${vencidas === 1 ? "" : "s"}`);
  setElementText("dash-alert-monthly-note", `${proximas} próxima${proximas === 1 ? "" : "s"}`);

  const serviciosPendientes = Number(cartera.servicios_pendientes || 0);
  setElementText("dash-alert-debt", formatMoney(cartera.monto_pendiente || 0));
  setElementText("dash-alert-debt-note", `${serviciosPendientes} servicio${serviciosPendientes === 1 ? "" : "s"} pendiente${serviciosPendientes === 1 ? "" : "s"}`);

  const abiertas =
    Number(operaciones.parqueadero_abiertos || 0) +
    Number(operaciones.lavadero_abiertos || 0) +
    Number(operaciones.taller_abiertos || 0);
  const demoradas = Number(operaciones.demoradas || 0);
  setElementText("dash-alert-open", `${abiertas} abierta${abiertas === 1 ? "" : "s"}`);
  setElementText("dash-alert-open-note", `${demoradas} demorada${demoradas === 1 ? "" : "s"}`);

  const list = document.getElementById("dash-alertas-list");
  const empty = document.getElementById("dash-alertas-empty");
  const updated = document.getElementById("dash-alertas-updated");
  if (!list || !empty) return;

  const topAlerts = alertas.slice(0, 10);
  list.innerHTML = topAlerts.map(alerta => {
    const severityClass = getAlertSeverityClass(alerta.severidad);
    const severityLabel = getAlertSeverityLabel(alerta.severidad);
    return `
      <article class="smart-alert-item smart-alert-${escapeHtml(String(alerta.severidad || "info").toLowerCase())}">
        <div class="smart-alert-marker"></div>
        <div class="smart-alert-content">
          <div class="smart-alert-title-row">
            <strong>${escapeHtml(alerta.titulo)}</strong>
            <span class="badge ${severityClass}">${severityLabel}</span>
          </div>
          <p>${escapeHtml(alerta.descripcion || "")}</p>
          <div class="smart-alert-meta">${formatAlertMeta(alerta)}</div>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-secondary smart-alert-action"
          data-alert-action
          data-alert-module="${escapeHtml(alerta.modulo || "dashboard")}"
          data-alert-reference-type="${escapeHtml(alerta.referencia_tipo || "")}"
        >${escapeHtml(alerta.accion || "Revisar")}</button>
      </article>
    `;
  }).join("");

  empty.hidden = topAlerts.length > 0;
  if (updated) {
    updated.textContent = data.generado_en
      ? `Actualizado ${formatDateTime(data.generado_en)}`
      : "Sin actualizar";
  }
}

async function cargarAlertasInteligentes() {
  try {
    const data = await apiFetch("/api/alertas/inteligentes");
    renderDashboardAlerts(data);
  } catch (err) {
    console.error("Error cargando alertas inteligentes:", err);
    setElementText("dash-alertas-count", "Sin datos");
    setElementText("dash-alertas-critical", "Error");
    setBadgeClass("dash-alertas-critical", "badge-danger");
    const empty = document.getElementById("dash-alertas-empty");
    const list = document.getElementById("dash-alertas-list");
    if (list) list.innerHTML = "";
    if (empty) {
      empty.hidden = false;
      empty.textContent = "No se pudieron cargar las alertas.";
    }
  }
}

function abrirAccionAlerta(modulo, referenciaTipo) {
  const viewMap = {
    dashboard: "dashboard",
    config: "config",
    configuracion: "config",
    clientes: "clientes",
    parqueadero: "parqueadero",
    lavadero: "lavadero",
    taller: "taller",
    empresas: "empresas",
    usuarios: "usuarios",
    empleados: "empleados",
    reportes: "reportes",
  };

  const targetView = viewMap[modulo] || "dashboard";
  const changed = changeView(targetView);
  if (!changed) return;

  if (targetView === "config" && ["licencia", "empresa"].includes(referenciaTipo)) {
    setConfigTab("licencias");
  }

  if (targetView === "parqueadero" && referenciaTipo === "mensualidad") {
    seleccionarFlujoParqueadero("alta");
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

function getBadgeClass(value, kind = "status") {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  if (!normalized || normalized === "no-registrado" || normalized === "n-a") {
    return "badge badge-muted";
  }

  if (kind === "payment") {
    const paymentMap = {
      efectivo: "badge-success",
      tarjeta: "badge-info",
      transferencia: "badge-primary",
      mixto: "badge-warning",
      mensualidad: "badge-teal",
      "sin-metodo": "badge-warning",
      otro: "badge-muted",
    };
    return `badge ${paymentMap[normalized] || "badge-primary"}`;
  }

  if (["activa", "activo", "completado", "entregado", "pagado"].includes(normalized)) {
    return "badge badge-success";
  }

  if (["abonado", "pendiente", "en-proceso", "en-curso", "iniciado", "abierto"].includes(normalized)) {
    return "badge badge-warning";
  }

  if (["inactiva", "inactivo", "vencida", "cancelado", "cancelada"].includes(normalized)) {
    return "badge badge-danger";
  }

  return "badge badge-info";
}

function renderBadge(value, kind = "status") {
  const label = value || "No registrado";
  return `<span class="${getBadgeClass(label, kind)}">${label}</span>`;
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
        <td>${renderBadge(item.estado)}</td>
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
      preCalculo.tipo_servicio === "MENSUALIDAD"
        ? "MENSUALIDAD"
        : "";
    document.getElementById("pq-referencia").value = "";
    document.getElementById("pq-detalle-pago").value = "";
    document.getElementById("pq-obs-salida").value = "";
    configureSalidaMonto({
      total: Number(preCalculo.valor_a_cobrar || 0),
      esMensualidad: preCalculo.tipo_servicio === "MENSUALIDAD",
    });
    actualizarCamposPagoServicio(
      "pq-metodo-pago",
      "pq-referencia-group",
      "pq-detalle-pago-group"
    );

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
    document.getElementById("salida-valor").textContent =
      `$${Number(preCalculo.valor_a_cobrar || 0).toLocaleString("es-CO")} COP`;
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
  if (!registroId || !datosPreSalida) {
    alert("Error: datos no disponibles.");
    return;
  }

  const metodoPago = document.getElementById("pq-metodo-pago").value.trim();
  const totalCobro = Number(datosPreSalida.valor_a_cobrar || 0);
  const esMensualidad = String(datosPreSalida.tipo_servicio || "").toUpperCase() === "MENSUALIDAD";
  const requiereCobro = !esMensualidad && totalCobro > 0;
  const montoPago = Number(document.getElementById("pq-monto-pago")?.value || 0);

  if (requiereCobro && !metodoPago) {
    alert("Debe seleccionar un método de pago.");
    return;
  }

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
    const payload = {
      referencia_transaccion: referencia,
      detalle_pago: detallePago,
      observaciones: observacionesSalida,
    };

    if (metodoPago) {
      payload.metodo_pago = metodoPago;
    }

    if (requiereCobro) {
      payload.monto_pago = montoPago;
    }

    const response = await apiFetch(`/api/parqueadero/salida/${registroId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    alert(response?.mensaje || "✓ Salida registrada correctamente.");
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
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();

  // Login
  const loginForm = document.getElementById("login-form");
  loginForm?.addEventListener("submit", handleLogin);

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", logout);

  // Navegación
  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("module-locked")) {
        showModuleBlockedMessage(btn.dataset.licenseModule);
        return;
      }
      changeView(btn.dataset.view);
    });
  });

  initModuleCatalog();

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

  document
    .getElementById("cli-perfil-close")
    ?.addEventListener("click", cerrarPerfilCliente);

  document
    .getElementById("cli-action-editar")
    ?.addEventListener("click", () => abrirClienteActionPanel("editar"));

  document
    .getElementById("cli-action-vehiculo")
    ?.addEventListener("click", () => abrirClienteActionPanel("vehiculo"));

  document
    .getElementById("cli-action-mensualidad")
    ?.addEventListener("click", () => abrirClienteActionPanel("mensualidad"));

  document
    .getElementById("form-cli-editar")
    ?.addEventListener("submit", handleEditarCliente360);

  document
    .getElementById("form-cli-vehiculo")
    ?.addEventListener("submit", handleAgregarVehiculoCliente360);

  document
    .getElementById("form-cli-mensualidad")
    ?.addEventListener("submit", handleCrearMensualidadCliente360);

  document
    .getElementById("cli-men-vehiculo")
    ?.addEventListener("change", sincronizarVehiculoMensualidadCliente);

  document
    .getElementById("cli-recibo-cliente")
    ?.addEventListener("click", abrirReciboCliente360);

  document
    .getElementById("veh360-close")
    ?.addEventListener("click", cerrarVehiculo360);

  document
    .getElementById("veh360-action-parqueadero")
    ?.addEventListener("click", iniciarIngresoVehiculo360);

  document
    .getElementById("veh360-action-lavadero")
    ?.addEventListener("click", iniciarLavadoVehiculo360);

  document
    .getElementById("veh360-action-taller")
    ?.addEventListener("click", iniciarTallerVehiculo360);

  document
    .getElementById("veh360-action-mensualidad")
    ?.addEventListener("click", iniciarMensualidadVehiculo360);

  document
    .getElementById("veh360-action-recibo")
    ?.addEventListener("click", abrirReciboVehiculo360);

  document.querySelectorAll("[data-cli-action-cancel]").forEach((button) => {
    button.addEventListener("click", cerrarClienteActionPanels);
  });

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

  document
    .getElementById("btn-rep-hoy")
    ?.addEventListener("click", () => setReportRangeAndGenerate(0));

  document
    .getElementById("btn-rep-7")
    ?.addEventListener("click", () => setReportRangeAndGenerate(6));

  document
    .getElementById("btn-rep-30")
    ?.addEventListener("click", () => setReportRangeAndGenerate(30));

  document
    .getElementById("btn-rep-exportar")
    ?.addEventListener("click", exportReportesCSV);

  document
    .getElementById("form-caja-arqueo")
    ?.addEventListener("submit", handleGuardarArqueoCaja);

  document
    .getElementById("rep-caja-efectivo-contado")
    ?.addEventListener("input", actualizarDiferenciaArqueo);

  // Empresas
  document
    .getElementById("form-empresa-admin")
    ?.addEventListener("submit", handleGuardarEmpresaAdmin);

  document
    .getElementById("empresas-buscar")
    ?.addEventListener("input", renderEmpresasTable);

  document
    .getElementById("btn-empresa-cancelar-edicion")
    ?.addEventListener("click", resetEmpresaAdminForm);

  document
    .getElementById("form-licencia-empresa")
    ?.addEventListener("submit", handleAsignarLicenciaEmpresa);

  document
    .getElementById("licencia-plan-id")
    ?.addEventListener("change", renderLicenciaPlanModulos);

  document
    .getElementById("licencia-empresa-id")
    ?.addEventListener("change", () => syncLicenciaEmpresaForm());

  document
    .getElementById("form-suscripcion-saas")
    ?.addEventListener("submit", handleGuardarSuscripcionSaas);

  document
    .getElementById("suscripcion-empresa-id")
    ?.addEventListener("change", () => syncSuscripcionSaasForm());

  document
    .getElementById("suscripcion-plan-id")
    ?.addEventListener("change", () => {
      const licencia = getLicenciaById(document.getElementById("suscripcion-plan-id")?.value);
      if (licencia) {
        document.getElementById("suscripcion-precio-plan").value = String(Math.round(Number(licencia.precio || 0)));
      }
    });

  document
    .getElementById("btn-suscripcion-renovar")
    ?.addEventListener("click", handleRenovarSuscripcionSaas);

  document
    .getElementById("btn-suscripcion-suspender")
    ?.addEventListener("click", () => handleCambiarEstadoSuscripcionSaas("SUSPENDIDA"));

  document
    .getElementById("btn-suscripcion-cancelar")
    ?.addEventListener("click", () => handleCambiarEstadoSuscripcionSaas("CANCELADA"));

  document
    .getElementById("form-factura-saas")
    ?.addEventListener("submit", handleRegistrarFacturaSaas);

  // Usuarios del sistema
  document
    .getElementById("form-usuario-sistema")
    ?.addEventListener("submit", handleGuardarUsuarioSistema);

  document
    .getElementById("usuarios-buscar")
    ?.addEventListener("input", renderUsuariosSistemaTable);

  document
    .getElementById("btn-usuario-cancelar-edicion")
    ?.addEventListener("click", resetUsuarioSistemaForm);

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
    .getElementById("btn-gestionar-licencia")
    ?.addEventListener("click", handleGestionarPlanActual);

  document
    .getElementById("btn-renovar-licencia")
    ?.addEventListener("click", handleGestionarPlanActual);

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
    .getElementById("btn-refresh-alertas")
    ?.addEventListener("click", cargarAlertasInteligentes);

  document
    .getElementById("dash-alertas-list")
    ?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-alert-action]");
      if (!button) return;
      abrirAccionAlerta(button.dataset.alertModule, button.dataset.alertReferenceType);
    });

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
    await initAfterLogin();
  } else {
    showLoginView();
  }
});

async function initAfterLogin() {
  const empresa = localStorage.getItem(STORAGE.EMPRESA);
  if (empresa) document.getElementById("sidebar-empresa").textContent = empresa;

  const email = localStorage.getItem(STORAGE.EMAIL);
  if (email) document.getElementById("user-info-label").textContent = email;

  const empresaLogo = localStorage.getItem('empresa_logo');
  updateSidebarLogo(empresaLogo, empresa);
  await loadLicensePermissions();
  applyPermissionVisibility();

  changeView("dashboard");
}

/* ======================================================
   MÓDULO EMPRESAS
======================================================*/
let empresasAdminData = [];
let licenciasCatalogoData = [];
let suscripcionesAdminData = [];
let saasResumenData = null;
let facturasSaasData = [];

function formatDateForInput(value) {
  if (!value) return "";
  if (value instanceof Date) return formatDateParam(value);
  return String(value).split("T")[0];
}

function getEmpresaAdminPayload(includeAdmin = false) {
  const payload = {
    nombre: document.getElementById("empresa-admin-nombre")?.value.trim(),
    nit: document.getElementById("empresa-admin-nit")?.value.trim() || null,
    ciudad: document.getElementById("empresa-admin-ciudad")?.value.trim() || null,
    direccion: document.getElementById("empresa-admin-direccion")?.value.trim() || null,
    telefono: document.getElementById("empresa-admin-telefono")?.value.trim() || null,
    email_contacto: document.getElementById("empresa-admin-email")?.value.trim() || null,
    zona_horaria: document.getElementById("empresa-admin-zona")?.value || "America/Bogota",
    licencia_tipo: document.getElementById("empresa-admin-licencia")?.value || "Demo",
    licencia_fin: document.getElementById("empresa-admin-licencia-fin")?.value || null,
    activa: document.getElementById("empresa-admin-activa")?.value !== "false",
  };

  if (includeAdmin) {
    payload.admin_nombre = document.getElementById("empresa-admin-user-nombre")?.value.trim() || null;
    payload.admin_email = document.getElementById("empresa-admin-user-email")?.value.trim() || null;
    payload.admin_password = document.getElementById("empresa-admin-user-password")?.value.trim() || "";
  }

  return payload;
}

function resetEmpresaAdminForm() {
  const form = document.getElementById("form-empresa-admin");
  form?.reset();
  setElementText("empresa-admin-form-title", "Crear empresa");
  setElementText("btn-empresa-admin-submit", "Crear empresa");
  document.getElementById("empresa-admin-id").value = "";
  document.getElementById("empresa-admin-zona").value = "America/Bogota";
  document.getElementById("empresa-admin-licencia").value = "Demo";
  document.getElementById("empresa-admin-activa").value = "true";
  document.getElementById("empresa-admin-usuario-fields")?.classList.remove("hidden");
  document.getElementById("btn-empresa-cancelar-edicion")?.classList.add("hidden");
}

function renderEmpresasSummary(empresas = []) {
  const total = empresas.length;
  const activas = empresas.filter((empresa) => empresa.activa).length;
  const usuarios = empresas.reduce((sum, empresa) => sum + Number(empresa.usuarios_total || 0), 0);

  setElementText("empresas-total", total);
  setElementText("empresas-activas", activas);
  setElementText("empresas-usuarios", usuarios);
}

function getLicenciaById(id) {
  return licenciasCatalogoData.find((licencia) => Number(licencia.id) === Number(id));
}

function getLicenciaForEmpresa(empresa = {}) {
  if (empresa.licencia_id) return getLicenciaById(empresa.licencia_id);
  const licenciaTipo = normalizeRole(empresa.licencia_nombre || empresa.licencia_tipo);
  return licenciasCatalogoData.find((licencia) => normalizeRole(licencia.nombre) === licenciaTipo);
}

function getSuscripcionForEmpresa(empresa = {}) {
  return suscripcionesAdminData.find((suscripcion) => Number(suscripcion.empresa_id) === Number(empresa.id));
}

function renderSaasSummary(resumen = null) {
  const data = resumen || {
    mrr: 0,
    arr: 0,
    trial: 0,
    vencidas: 0,
  };

  setElementText("saas-total-mrr", formatMoney(Number(data.mrr || 0)));
  setElementText("saas-total-arr", formatMoney(Number(data.arr || 0)));
  setElementText("saas-total-trial", Number(data.trial || 0));
  setElementText("saas-total-vencidas", Number(data.vencidas || 0));
}

function populateLicenciaPlanSelect() {
  const select = document.getElementById("licencia-plan-id");
  if (!select) return;

  select.innerHTML = licenciasCatalogoData.map((licencia) => `
    <option value="${licencia.id}">${licencia.nombre} - ${formatMoney(licencia.precio || 0)}</option>
  `).join("");
}

function populateLicenciaEmpresaSelect() {
  const select = document.getElementById("licencia-empresa-id");
  if (!select) return;

  select.innerHTML = empresasAdminData.map((empresa) => `
    <option value="${empresa.id}">${empresa.nombre}</option>
  `).join("");
}

function populateSuscripcionEmpresaSelect() {
  const select = document.getElementById("suscripcion-empresa-id");
  if (!select) return;

  select.innerHTML = empresasAdminData.map((empresa) => `
    <option value="${empresa.id}">${empresa.nombre}</option>
  `).join("");
}

function populateSuscripcionPlanSelect() {
  const select = document.getElementById("suscripcion-plan-id");
  if (!select) return;

  select.innerHTML = licenciasCatalogoData.map((licencia) => `
    <option value="${licencia.id}">${licencia.nombre} - ${formatMoney(licencia.precio || 0)}</option>
  `).join("");
}

function renderLicenciaPlanModulos() {
  const panel = document.getElementById("licencia-plan-modulos");
  if (!panel) return;

  const licencia = getLicenciaById(document.getElementById("licencia-plan-id")?.value);
  const modulos = licencia?.modulos || [];

  if (modulos.length === 0) {
    panel.innerHTML = '<span class="badge badge-muted">Sin módulos asignados</span>';
    return;
  }

  panel.innerHTML = modulos
    .map((modulo) => `<span class="badge badge-teal">${modulo.nombre}</span>`)
    .join("");
}

function renderFacturasSaasTable() {
  const tbody = document.getElementById("facturas-saas-tbody");
  const empty = document.getElementById("facturas-saas-empty");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";
  if (!facturasSaasData.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  tbody.innerHTML = facturasSaasData.map((factura) => `
    <tr>
      <td>
        <strong>${factura.numero_factura || "-"}</strong>
        <span class="table-subtext">${formatDisplayDate(factura.fecha_emision)}</span>
      </td>
      <td>${factura.concepto || "-"}</td>
      <td>${formatDisplayDate(factura.periodo_inicio)} - ${formatDisplayDate(factura.periodo_fin)}</td>
      <td>${formatMoney(Number(factura.total || 0))}</td>
      <td>${renderBadge(factura.estado || "PENDIENTE")}</td>
      <td>${factura.metodo_pago || factura.referencia_pago || "-"}</td>
    </tr>
  `).join("");
}

async function cargarFacturasSaas(empresaId) {
  const empresaIdNum = Number(empresaId || 0);
  facturasSaasData = [];
  renderFacturasSaasTable();

  if (!empresaIdNum) return;

  try {
    facturasSaasData = await apiFetch(`/api/suscripciones/${empresaIdNum}/facturas`);
    renderFacturasSaasTable();
  } catch (error) {
    facturasSaasData = [];
    renderFacturasSaasTable();
    showMessage("factura-saas-msg", error.message, true);
  }
}

async function syncSuscripcionSaasForm(empresaId = null) {
  const selectEmpresa = document.getElementById("suscripcion-empresa-id");
  const selectPlan = document.getElementById("suscripcion-plan-id");
  if (!selectEmpresa || !selectPlan) return;

  if (empresaId) {
    selectEmpresa.value = String(empresaId);
  }

  const empresa = empresasAdminData.find((item) => Number(item.id) === Number(selectEmpresa.value));
  const suscripcion = getSuscripcionForEmpresa(empresa || {});
  const licencia = suscripcion?.licencia_id
    ? getLicenciaById(suscripcion.licencia_id)
    : getLicenciaForEmpresa(empresa || {});

  if (licencia) {
    selectPlan.value = String(licencia.id);
  }

  document.getElementById("suscripcion-estado").value = suscripcion?.estado_real || (licencia?.nombre === "Demo" ? "TRIAL" : "ACTIVA");
  document.getElementById("suscripcion-pasarela").value = suscripcion?.pasarela || "MANUAL";
  document.getElementById("suscripcion-fecha-inicio").value = formatDateForInput(
    suscripcion?.fecha_inicio || empresa?.licencia_asignacion_inicio || empresa?.licencia_inicio || new Date()
  );
  document.getElementById("suscripcion-fecha-fin").value = formatDateForInput(
    suscripcion?.fecha_fin || empresa?.licencia_asignacion_fin || empresa?.licencia_fin
  );
  document.getElementById("suscripcion-precio-plan").value = String(
    Math.round(Number(suscripcion?.precio_plan ?? licencia?.precio ?? 0))
  );
  document.getElementById("suscripcion-referencia-externa").value = suscripcion?.referencia_externa || "";
  document.getElementById("suscripcion-renovacion-automatica").checked = Boolean(suscripcion?.renovacion_automatica);
  document.getElementById("suscripcion-observaciones").value = suscripcion?.observaciones || "";

  setElementText(
    "suscripcion-estado-actual",
    empresa
      ? `${empresa.nombre} · ${suscripcion?.estado_real || "SIN SUSCRIPCION"}`
      : "Sin suscripción"
  );
  setElementText(
    "facturas-saas-empresa-actual",
    empresa
      ? `${empresa.nombre}${suscripcion?.licencia_nombre ? ` · ${suscripcion.licencia_nombre}` : ""}`
      : "Sin empresa"
  );

  document.getElementById("factura-saas-total").value = String(
    Math.round(Number(suscripcion?.precio_plan ?? licencia?.precio ?? 0))
  );
  document.getElementById("factura-saas-periodo-inicio").value = formatDateForInput(
    suscripcion?.fecha_inicio || new Date()
  );
  document.getElementById("factura-saas-periodo-fin").value = formatDateForInput(
    suscripcion?.fecha_fin
  );

  await cargarFacturasSaas(empresa?.id);
}

function syncLicenciaEmpresaForm(empresaId = null) {
  const selectEmpresa = document.getElementById("licencia-empresa-id");
  const selectPlan = document.getElementById("licencia-plan-id");
  if (!selectEmpresa || !selectPlan) return;

  if (empresaId) selectEmpresa.value = String(empresaId);

  const empresa = empresasAdminData.find((item) => Number(item.id) === Number(selectEmpresa.value));
  const licencia = getLicenciaForEmpresa(empresa);
  if (licencia) selectPlan.value = String(licencia.id);

  document.getElementById("licencia-fecha-inicio").value = formatDateForInput(
    empresa?.licencia_asignacion_inicio || empresa?.licencia_inicio || new Date()
  );
  document.getElementById("licencia-fecha-fin").value = formatDateForInput(
    empresa?.licencia_asignacion_fin || empresa?.licencia_fin
  );

  const current = document.getElementById("licencia-empresa-estado");
  if (current) {
    const nombre = licencia?.nombre || empresa?.licencia_nombre || empresa?.licencia_tipo || "Sin licencia";
    const fin = empresa?.licencia_asignacion_fin || empresa?.licencia_fin;
    current.textContent = `${nombre}${fin ? ` hasta ${new Date(fin).toLocaleDateString()}` : " sin vencimiento"}`;
  }

  renderLicenciaPlanModulos();
}

async function cargarLicenciasCatalogo() {
  if (!userIsSuperAdmin()) return;
  const data = await apiFetch("/api/licencias/catalogo/completo");
  licenciasCatalogoData = data.licencias || [];
  populateLicenciaPlanSelect();
}

function renderEmpresasTable() {
  const tbody = document.getElementById("empresas-tbody");
  const empty = document.getElementById("empresas-empty");
  if (!tbody || !empty) return;

  const search = document.getElementById("empresas-buscar")?.value.trim().toLowerCase() || "";
  const empresas = search
    ? empresasAdminData.filter((empresa) =>
        `${empresa.nombre || ""} ${empresa.nit || ""} ${empresa.ciudad || ""} ${empresa.email_contacto || ""}`
          .toLowerCase()
          .includes(search)
      )
    : empresasAdminData;

  tbody.innerHTML = "";

  if (empresas.length === 0) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  tbody.innerHTML = empresas.map((empresa) => {
    const licencia = getLicenciaForEmpresa(empresa);
    const suscripcion = getSuscripcionForEmpresa(empresa);
    const licenciaNombre = licencia?.nombre || empresa.licencia_nombre || empresa.licencia_tipo || "demo";
    const licenciaFinRaw = empresa.licencia_asignacion_fin || empresa.licencia_fin;
    const licenciaFin = licenciaFinRaw
      ? new Date(licenciaFinRaw).toLocaleDateString()
      : "Sin vencimiento";
    const suscripcionEstado = suscripcion?.estado_real || "SIN SUSCRIPCION";
    const suscripcionFin = suscripcion?.fecha_fin
      ? new Date(suscripcion.fecha_fin).toLocaleDateString()
      : "Sin fecha";
    const nextState = empresa.activa ? "false" : "true";
    const nextLabel = empresa.activa ? "Desactivar" : "Activar";
    const nextClass = empresa.activa ? "btn-danger" : "btn-success";

    return `
      <tr>
        <td>
          <strong>${empresa.nombre}</strong>
          <span class="table-subtext">${empresa.email_contacto || "Sin email"}</span>
        </td>
        <td>${empresa.nit || "-"}</td>
        <td>${empresa.ciudad || "-"}</td>
        <td>${empresa.usuarios_total || 0}</td>
        <td>${empresa.clientes_total || 0}</td>
        <td>${empresa.vehiculos_total || 0}</td>
        <td>${empresa.parqueados_activos || 0}</td>
        <td>
          <span class="badge badge-primary">${licenciaNombre}</span>
          <span class="table-subtext">${licenciaFin}</span>
        </td>
        <td>
          ${renderBadge(suscripcionEstado)}
          <span class="table-subtext">${suscripcionFin}</span>
        </td>
        <td>${renderBadge(empresa.activa ? "Activa" : "Inactiva")}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn btn-sm btn-secondary" onclick="editarEmpresaAdmin(${empresa.id})">Editar</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="editarLicenciaEmpresa(${empresa.id})">Licencia</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="syncSuscripcionSaasForm(${empresa.id})">SaaS</button>
            <button type="button" class="btn btn-sm ${nextClass}" onclick="toggleEmpresaAdmin(${empresa.id}, ${nextState})">${nextLabel}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function cargarEmpresas() {
  try {
    const [, empresas, suscripciones, resumen] = await Promise.all([
      cargarLicenciasCatalogo(),
      apiFetch("/api/empresas"),
      apiFetch("/api/suscripciones"),
      apiFetch("/api/suscripciones/resumen"),
    ]);
    empresasAdminData = empresas;
    suscripcionesAdminData = suscripciones;
    saasResumenData = resumen;
    populateLicenciaEmpresaSelect();
    populateSuscripcionEmpresaSelect();
    populateSuscripcionPlanSelect();
    syncLicenciaEmpresaForm();
    await syncSuscripcionSaasForm();
    renderEmpresasSummary(empresasAdminData);
    renderSaasSummary(saasResumenData);
    renderEmpresasTable();
  } catch (error) {
    empresasAdminData = [];
    suscripcionesAdminData = [];
    saasResumenData = null;
    facturasSaasData = [];
    renderEmpresasSummary([]);
    renderSaasSummary(null);
    renderFacturasSaasTable();
    renderEmpresasTable();
    showMessage("empresa-admin-msg", error.message, true);
  }
}

function editarLicenciaEmpresa(id) {
  syncLicenciaEmpresaForm(id);
  document.getElementById("form-licencia-empresa")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editarEmpresaAdmin(id) {
  const empresa = empresasAdminData.find((item) => Number(item.id) === Number(id));
  if (!empresa) return;

  document.getElementById("empresa-admin-id").value = empresa.id;
  document.getElementById("empresa-admin-nombre").value = empresa.nombre || "";
  document.getElementById("empresa-admin-nit").value = empresa.nit || "";
  document.getElementById("empresa-admin-ciudad").value = empresa.ciudad || "";
  document.getElementById("empresa-admin-direccion").value = empresa.direccion || "";
  document.getElementById("empresa-admin-telefono").value = empresa.telefono || "";
  document.getElementById("empresa-admin-email").value = empresa.email_contacto || "";
  document.getElementById("empresa-admin-zona").value = empresa.zona_horaria || "America/Bogota";
  const licenciaLegacySelect = document.getElementById("empresa-admin-licencia");
  const licenciaLegacyOption = Array.from(licenciaLegacySelect.options).find(
    (option) => normalizeRole(option.value) === normalizeRole(empresa.licencia_tipo || empresa.licencia_nombre)
  );
  licenciaLegacySelect.value = licenciaLegacyOption?.value || "Demo";
  document.getElementById("empresa-admin-licencia-fin").value = formatDateForInput(empresa.licencia_fin);
  document.getElementById("empresa-admin-activa").value = empresa.activa ? "true" : "false";

  setElementText("empresa-admin-form-title", "Editar empresa");
  setElementText("btn-empresa-admin-submit", "Guardar cambios");
  document.getElementById("empresa-admin-usuario-fields")?.classList.add("hidden");
  document.getElementById("btn-empresa-cancelar-edicion")?.classList.remove("hidden");
  document.getElementById("form-empresa-admin")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleGuardarEmpresaAdmin(event) {
  event.preventDefault();
  const empresaId = document.getElementById("empresa-admin-id")?.value;
  const isEditing = Boolean(empresaId);
  const payload = getEmpresaAdminPayload(!isEditing);

  if (!payload.nombre) {
    showMessage("empresa-admin-msg", "El nombre de la empresa es obligatorio.", true);
    return;
  }

  try {
    await apiFetch(isEditing ? `/api/empresas/${empresaId}` : "/api/empresas", {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });

    showMessage("empresa-admin-msg", isEditing ? "Empresa actualizada." : "Empresa creada.");
    resetEmpresaAdminForm();
    await cargarEmpresas();
  } catch (error) {
    showMessage("empresa-admin-msg", error.message, true);
  }
}

async function toggleEmpresaAdmin(id, activa) {
  const accion = activa ? "activar" : "desactivar";
  if (!confirm(`¿Deseas ${accion} esta empresa?`)) return;

  try {
    await apiFetch(`/api/empresas/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ activa }),
    });
    await cargarEmpresas();
  } catch (error) {
    showMessage("empresa-admin-msg", error.message, true);
  }
}

async function handleAsignarLicenciaEmpresa(event) {
  event.preventDefault();
  const empresaId = document.getElementById("licencia-empresa-id")?.value;
  const licenciaId = document.getElementById("licencia-plan-id")?.value;

  if (!empresaId || !licenciaId) {
    showMessage("licencia-empresa-msg", "Selecciona empresa y licencia.", true);
    return;
  }

  try {
    await apiFetch("/api/licencias/asignar", {
      method: "POST",
      body: JSON.stringify({
        empresa_id: Number(empresaId),
        licencia_id: Number(licenciaId),
        fecha_inicio: document.getElementById("licencia-fecha-inicio")?.value || null,
        fecha_fin: document.getElementById("licencia-fecha-fin")?.value || null,
      }),
    });

    showMessage("licencia-empresa-msg", "Licencia asignada correctamente.");
    await cargarEmpresas();
    await loadLicensePermissions();
    applyPermissionVisibility();
    syncLicenciaEmpresaForm(empresaId);
  } catch (error) {
    showMessage("licencia-empresa-msg", error.message, true);
  }
}

async function handleGuardarSuscripcionSaas(event) {
  event.preventDefault();

  const empresaId = Number(document.getElementById("suscripcion-empresa-id")?.value || 0);
  const licenciaId = Number(document.getElementById("suscripcion-plan-id")?.value || 0);

  if (!empresaId || !licenciaId) {
    showMessage("suscripcion-saas-msg", "Selecciona empresa y plan.", true);
    return;
  }

  try {
    await apiFetch("/api/suscripciones/upsert", {
      method: "POST",
      body: JSON.stringify({
        empresa_id: empresaId,
        licencia_id: licenciaId,
        estado: document.getElementById("suscripcion-estado")?.value || "ACTIVA",
        fecha_inicio: document.getElementById("suscripcion-fecha-inicio")?.value || null,
        fecha_fin: document.getElementById("suscripcion-fecha-fin")?.value || null,
        precio_plan: Number(document.getElementById("suscripcion-precio-plan")?.value || 0),
        pasarela: document.getElementById("suscripcion-pasarela")?.value || "MANUAL",
        referencia_externa: document.getElementById("suscripcion-referencia-externa")?.value.trim() || null,
        renovacion_automatica: document.getElementById("suscripcion-renovacion-automatica")?.checked || false,
        observaciones: document.getElementById("suscripcion-observaciones")?.value.trim() || null,
      }),
    });

    showMessage("suscripcion-saas-msg", "Suscripción guardada correctamente.");
    await cargarEmpresas();
    await syncSuscripcionSaasForm(empresaId);
  } catch (error) {
    showMessage("suscripcion-saas-msg", error.message, true);
  }
}

async function handleRenovarSuscripcionSaas() {
  const empresaId = Number(document.getElementById("suscripcion-empresa-id")?.value || 0);
  if (!empresaId) {
    showMessage("suscripcion-saas-msg", "Selecciona una empresa para renovar.", true);
    return;
  }

  try {
    await apiFetch(`/api/suscripciones/${empresaId}/renovar`, {
      method: "POST",
      body: JSON.stringify({
        dias: 30,
        licencia_id: Number(document.getElementById("suscripcion-plan-id")?.value || 0),
        pasarela: document.getElementById("suscripcion-pasarela")?.value || "MANUAL",
        total: Number(document.getElementById("suscripcion-precio-plan")?.value || 0),
        metodo_pago: document.getElementById("factura-saas-metodo")?.value.trim() || null,
        referencia_pago: document.getElementById("factura-saas-referencia")?.value.trim() || null,
      }),
    });

    showMessage("suscripcion-saas-msg", "Suscripción renovada por 30 días.");
    await cargarEmpresas();
    await syncSuscripcionSaasForm(empresaId);
  } catch (error) {
    showMessage("suscripcion-saas-msg", error.message, true);
  }
}

async function handleCambiarEstadoSuscripcionSaas(estado) {
  const empresaId = Number(document.getElementById("suscripcion-empresa-id")?.value || 0);
  if (!empresaId) {
    showMessage("suscripcion-saas-msg", "Selecciona una empresa.", true);
    return;
  }

  const mensaje = estado === "SUSPENDIDA"
    ? "¿Deseas suspender esta suscripción?"
    : "¿Deseas cancelar esta suscripción?";
  if (!confirm(mensaje)) return;

  try {
    await apiFetch(`/api/suscripciones/${empresaId}/estado`, {
      method: "POST",
      body: JSON.stringify({
        estado,
        observaciones: document.getElementById("suscripcion-observaciones")?.value.trim() || null,
      }),
    });

    showMessage("suscripcion-saas-msg", `Suscripción ${estado.toLowerCase()} correctamente.`);
    await cargarEmpresas();
    await syncSuscripcionSaasForm(empresaId);
  } catch (error) {
    showMessage("suscripcion-saas-msg", error.message, true);
  }
}

async function handleRegistrarFacturaSaas(event) {
  event.preventDefault();

  const empresaId = Number(document.getElementById("suscripcion-empresa-id")?.value || 0);
  if (!empresaId) {
    showMessage("factura-saas-msg", "Selecciona una empresa.", true);
    return;
  }

  const total = Number(document.getElementById("factura-saas-total")?.value || 0);
  if (!Number.isFinite(total) || total <= 0) {
    showMessage("factura-saas-msg", "El total de la factura debe ser mayor a cero.", true);
    return;
  }

  const impuestos = Number(document.getElementById("factura-saas-impuestos")?.value || 0);
  const subtotal = Math.max(total - impuestos, 0);

  try {
    await apiFetch(`/api/suscripciones/${empresaId}/facturas`, {
      method: "POST",
      body: JSON.stringify({
        concepto: document.getElementById("factura-saas-concepto")?.value.trim() || "Cobro de suscripción SaaS",
        periodo_inicio: document.getElementById("factura-saas-periodo-inicio")?.value || null,
        periodo_fin: document.getElementById("factura-saas-periodo-fin")?.value || null,
        subtotal,
        impuestos,
        total,
        estado: document.getElementById("factura-saas-estado")?.value || "PAGADA",
        fecha_vencimiento: document.getElementById("factura-saas-vencimiento")?.value || null,
        metodo_pago: document.getElementById("factura-saas-metodo")?.value.trim() || null,
        referencia_pago: document.getElementById("factura-saas-referencia")?.value.trim() || null,
      }),
    });

    showMessage("factura-saas-msg", "Factura SaaS registrada correctamente.");
    await syncSuscripcionSaasForm(empresaId);
  } catch (error) {
    showMessage("factura-saas-msg", error.message, true);
  }
}

/* ======================================================
   MÓDULO USUARIOS DEL SISTEMA
======================================================*/
let usuariosSistemaData = [];

function getUsuarioSistemaPayload(includePassword = true) {
  const payload = {
    nombre: document.getElementById("usuario-nombre")?.value.trim(),
    email: document.getElementById("usuario-email")?.value.trim(),
    rol: document.getElementById("usuario-rol")?.value || "Operador",
    activo: document.getElementById("usuario-activo")?.value !== "false",
  };

  if (userIsSuperAdmin()) {
    payload.empresa_id = Number(document.getElementById("usuario-empresa")?.value || 0);
  }

  const password = document.getElementById("usuario-password")?.value.trim();
  if (includePassword || password) payload.password = password;

  return payload;
}

function populateUsuarioEmpresaSelect(empresas = empresasAdminData) {
  const select = document.getElementById("usuario-empresa");
  if (!select) return;

  select.innerHTML = empresas.map((empresa) => `
    <option value="${empresa.id}">${empresa.nombre}</option>
  `).join("");
}

function resetUsuarioSistemaForm() {
  const form = document.getElementById("form-usuario-sistema");
  form?.reset();
  document.getElementById("usuario-id").value = "";
  setElementText("usuario-form-title", "Crear usuario");
  setElementText("btn-usuario-submit", "Crear usuario");
  document.getElementById("btn-usuario-cancelar-edicion")?.classList.add("hidden");
  document.getElementById("usuario-rol").value = "Operador";
  document.getElementById("usuario-activo").value = "true";

  if (userIsSuperAdmin() && empresasAdminData.length > 0) {
    document.getElementById("usuario-empresa").value = empresasAdminData[0].id;
  }
}

function renderUsuariosSistemaSummary(usuarios = []) {
  const total = usuarios.length;
  const activos = usuarios.filter((usuario) => usuario.activo).length;
  const admins = usuarios.filter((usuario) =>
    ["administrador", "admin", "superadmin"].includes(normalizeRole(usuario.rol))
  ).length;

  setElementText("usuarios-total", total);
  setElementText("usuarios-activos", activos);
  setElementText("usuarios-admins", admins);
}

function renderUsuariosSistemaTable() {
  const tbody = document.getElementById("usuarios-tbody");
  const empty = document.getElementById("usuarios-empty");
  if (!tbody || !empty) return;

  const search = document.getElementById("usuarios-buscar")?.value.trim().toLowerCase() || "";
  const usuarios = search
    ? usuariosSistemaData.filter((usuario) =>
        `${usuario.nombre || ""} ${usuario.email || ""} ${usuario.rol || ""} ${usuario.empresa_nombre || ""}`
          .toLowerCase()
          .includes(search)
      )
    : usuariosSistemaData;

  tbody.innerHTML = "";

  if (usuarios.length === 0) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  tbody.innerHTML = usuarios.map((usuario) => {
    const nextState = usuario.activo ? "false" : "true";
    const nextLabel = usuario.activo ? "Desactivar" : "Activar";
    const nextClass = usuario.activo ? "btn-danger" : "btn-success";

    return `
      <tr>
        <td>
          <strong>${usuario.nombre}</strong>
          <span class="table-subtext">${usuario.email}</span>
        </td>
        <td>${usuario.empresa_nombre || "-"}</td>
        <td><span class="badge badge-primary">${usuario.rol}</span></td>
        <td>${renderBadge(usuario.activo ? "Activo" : "Inactivo")}</td>
        <td>${new Date(usuario.creado_en).toLocaleDateString()}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn btn-sm btn-secondary" onclick="editarUsuarioSistema(${usuario.id})">Editar</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="resetPasswordUsuarioSistema(${usuario.id})">Clave</button>
            <button type="button" class="btn btn-sm ${nextClass}" onclick="toggleUsuarioSistema(${usuario.id}, ${nextState})">${nextLabel}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function ensureEmpresasForUsuarioSelect() {
  if (!userIsSuperAdmin()) return;

  if (empresasAdminData.length === 0) {
    empresasAdminData = await apiFetch("/api/empresas");
  }

  populateUsuarioEmpresaSelect(empresasAdminData);
}

async function cargarUsuariosSistema() {
  try {
    await ensureEmpresasForUsuarioSelect();
    const query = userIsSuperAdmin() ? "?empresa_id=all" : "";
    usuariosSistemaData = await apiFetch(`/api/usuarios${query}`);
    renderUsuariosSistemaSummary(usuariosSistemaData);
    renderUsuariosSistemaTable();
    resetUsuarioSistemaForm();
  } catch (error) {
    usuariosSistemaData = [];
    renderUsuariosSistemaSummary([]);
    renderUsuariosSistemaTable();
    showMessage("usuario-msg", error.message, true);
  }
}

function editarUsuarioSistema(id) {
  const usuario = usuariosSistemaData.find((item) => Number(item.id) === Number(id));
  if (!usuario) return;

  document.getElementById("usuario-id").value = usuario.id;
  document.getElementById("usuario-nombre").value = usuario.nombre || "";
  document.getElementById("usuario-email").value = usuario.email || "";
  document.getElementById("usuario-rol").value = usuario.rol || "Operador";
  document.getElementById("usuario-activo").value = usuario.activo ? "true" : "false";
  document.getElementById("usuario-password").value = "";

  if (userIsSuperAdmin()) {
    document.getElementById("usuario-empresa").value = usuario.empresa_id;
  }

  setElementText("usuario-form-title", "Editar usuario");
  setElementText("btn-usuario-submit", "Guardar cambios");
  document.getElementById("btn-usuario-cancelar-edicion")?.classList.remove("hidden");
  document.getElementById("form-usuario-sistema")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleGuardarUsuarioSistema(event) {
  event.preventDefault();
  const usuarioId = document.getElementById("usuario-id")?.value;
  const isEditing = Boolean(usuarioId);
  const payload = getUsuarioSistemaPayload(!isEditing);

  if (!payload.nombre || !payload.email) {
    showMessage("usuario-msg", "Nombre y correo son obligatorios.", true);
    return;
  }

  if (!isEditing && !payload.password) {
    showMessage("usuario-msg", "La contraseña es obligatoria al crear usuario.", true);
    return;
  }

  try {
    await apiFetch(isEditing ? `/api/usuarios/${usuarioId}` : "/api/usuarios", {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });

    if (isEditing && payload.password) {
      await apiFetch(`/api/usuarios/${usuarioId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password: payload.password }),
      });
    }

    showMessage("usuario-msg", isEditing ? "Usuario actualizado." : "Usuario creado.");
    await cargarUsuariosSistema();
  } catch (error) {
    showMessage("usuario-msg", error.message, true);
  }
}

async function toggleUsuarioSistema(id, activo) {
  const accion = activo ? "activar" : "desactivar";
  if (!confirm(`¿Deseas ${accion} este usuario?`)) return;

  try {
    await apiFetch(`/api/usuarios/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ activo }),
    });
    await cargarUsuariosSistema();
  } catch (error) {
    showMessage("usuario-msg", error.message, true);
  }
}

async function resetPasswordUsuarioSistema(id) {
  const password = prompt("Nueva contraseña para el usuario:");
  if (!password) return;

  try {
    await apiFetch(`/api/usuarios/${id}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    });
    showMessage("usuario-msg", "Contraseña actualizada.");
  } catch (error) {
    showMessage("usuario-msg", error.message, true);
  }
}

/* ======================================================
   MÓDULO CONFIGURACIÓN
======================================================*/

function setConfigTab(tab = "empresa") {
  const selectedTab = tab || "empresa";

  document.querySelectorAll(".config-tab").forEach((button) => {
    const active = button.dataset.configTab === selectedTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.querySelectorAll("[data-config-panel]").forEach((panel) => {
    const samePanel = panel.dataset.configPanel === selectedTab;
    const adminOnly = panel.dataset.adminOnly === "true";
    panel.classList.toggle("hidden", !samePanel || (adminOnly && !userIsSuperAdmin()));
  });

  if (selectedTab === "parqueadero") {
    loadParqueaderoConfig();
  }

  if (selectedTab === "licencias") {
    loadLicenciaInfo();
  }
}

function updateConfigOverview(empresa = {}, permisos = null) {
  const licencia = permisos?.licencia || licensePermissionsState.license;
  const modulos = permisos?.modulos || (licensePermissionsState.modules ? Array.from(licensePermissionsState.modules) : []);
  const diasRestantes = getDaysRemaining(licencia?.fecha_fin);

  setElementText("config-summary-empresa", empresa.nombre || localStorage.getItem(STORAGE.EMPRESA) || "-");
  setElementText("config-summary-plan", licencia?.nombre || "Sin plan");
  setElementText("config-summary-modulos", `${modulos.length || 0} activos`);

  if (diasRestantes === null) {
    setElementText("config-summary-vigencia", licencia ? "Sin vencimiento" : "-");
  } else if (diasRestantes < 0) {
    setElementText("config-summary-vigencia", "Vencida");
  } else {
    setElementText("config-summary-vigencia", `${diasRestantes} día(s)`);
  }

  setElementText("empresa-identidad-nombre", empresa.nombre || "Empresa");
  setElementText("empresa-identidad-contacto", empresa.email_contacto || empresa.telefono || "Sin contacto");
  setElementText("empresa-identidad-ciudad", empresa.ciudad || "Sin ciudad");

  const estadoEmpresa = document.getElementById("config-empresa-estado");
  if (estadoEmpresa) {
    estadoEmpresa.textContent = "Activa";
    estadoEmpresa.className = "badge badge-success";
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
    const permisos = await loadLicenciaInfo();
    updateConfigOverview(empresa, permisos);
    await loadParqueaderoConfig();

    const activeTab = document.querySelector(".config-tab.active")?.dataset.configTab || "empresa";
    setConfigTab(activeTab);

  } catch (error) {
    console.error('Error cargando configuración:', error);
    showError('Error al cargar la configuración');
  }
}

function formatDisplayDate(value) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? parseDateParam(value)
    : new Date(value);

  return date.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDaysRemaining(dateValue) {
  if (!dateValue) return null;
  const end = new Date(dateValue);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
}

function getLicenseProgress(startValue, endValue) {
  if (!startValue || !endValue) return 100;
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 100;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

function formatModuleLabel(value) {
  const labels = {
    configuracion: "Configuración",
    parqueadero: "Parqueadero",
    lavadero: "Lavadero",
    taller: "Taller",
    clientes: "Clientes",
    reportes: "Reportes",
    empleados: "Empleados",
    usuarios: "Usuarios",
    empresas: "Empresas",
    dashboard: "Dashboard",
  };
  const key = normalizeRole(value);
  return labels[key] || String(value || "Módulo");
}

function renderLicenseModules(modulos = []) {
  const container = document.getElementById("modulos-lista");
  if (!container) return;

  if (modulos.length === 0) {
    container.innerHTML = '<div class="license-module-empty">Sin módulos activos.</div>';
    return;
  }

  container.innerHTML = modulos.map((modulo) => `
    <div class="license-module-item">
      <strong>${formatModuleLabel(modulo.nombre)}</strong>
      <span>${modulo.descripcion || "Acceso activo en el plan actual"}</span>
    </div>
  `).join("");
}

function renderEmptyLicensePlan() {
  setElementText("licencia-nombre", "Sin licencia");
  setElementText("licencia-descripcion", "La empresa no tiene una licencia asignada.");
  setElementText("licencia-inicio", "-");
  setElementText("licencia-fin", "-");
  setElementText("licencia-precio", "-");
  setElementText("licencia-modulos-total", "0");
  setElementText("licencia-dias-restantes", "-");
  setElementText("licencia-vigencia-texto", "Sin vencimiento registrado");
  setElementText("licencia-progreso-texto", "Sin rango de fechas");
  setElementText("licencia-modulos-badge", "0 activos");
  setElementText("licencia-help-text", userIsSuperAdmin()
    ? "Asigna un plan desde Gestión Multi-Empresa."
    : "Solicita la asignación de un plan al administrador de la plataforma."
  );

  const estado = document.getElementById("licencia-estado");
  if (estado) {
    estado.textContent = "Inactiva";
    estado.className = "badge badge-danger";
  }

  const progress = document.getElementById("licencia-progress-bar");
  if (progress) progress.style.width = "0%";

  renderLicenseModules([]);
  document.getElementById("btn-gestionar-licencia")?.classList.toggle("hidden", !userIsSuperAdmin());
  document.getElementById("btn-renovar-licencia")?.classList.toggle("hidden", userIsSuperAdmin());
}

async function loadLicenciaInfo() {
  try {
    const permisos = await apiFetch('/api/empresa/licencia/permisos');
    setLicensePermissions(permisos);
    applyPermissionVisibility();

    const licencia = permisos.licencia;
    if (!licencia) {
      renderEmptyLicensePlan();
      return permisos;
    }

    const modulos = permisos.modulos_detalle || (permisos.modulos || []).map((nombre) => ({ nombre }));
    const diasRestantes = getDaysRemaining(licencia.fecha_fin);
    const activa = Boolean(licencia.activa) && !permisos.expirada;
    const estadoLabel = activa ? "Activa" : permisos.expirada ? "Vencida" : "Inactiva";
    const progress = getLicenseProgress(licencia.fecha_inicio, licencia.fecha_fin);
    const renewalVisible = diasRestantes !== null && diasRestantes <= 30;

    setElementText("licencia-nombre", licencia.nombre || "Sin nombre");
    setElementText("licencia-descripcion", licencia.descripcion || "Plan activo para la operación de la empresa.");
    setElementText("licencia-inicio", formatDisplayDate(licencia.fecha_inicio));
    setElementText("licencia-fin", licencia.fecha_fin ? formatDisplayDate(licencia.fecha_fin) : "Sin vencimiento");
    setElementText("licencia-precio", licencia.precio !== null && licencia.precio !== undefined ? formatMoney(licencia.precio) : "-");
    setElementText("licencia-modulos-total", modulos.length);
    setElementText("licencia-modulos-badge", `${modulos.length} activos`);
    setElementText("licencia-progreso-texto", licencia.fecha_fin ? `${progress}% del periodo usado` : "Plan sin fecha de vencimiento");

    if (diasRestantes === null) {
      setElementText("licencia-dias-restantes", "Sin vencimiento");
      setElementText("licencia-vigencia-texto", "El plan no tiene fecha de cierre.");
    } else if (diasRestantes < 0) {
      setElementText("licencia-dias-restantes", "Vencida");
      setElementText("licencia-vigencia-texto", `Venció hace ${Math.abs(diasRestantes)} día(s).`);
    } else {
      setElementText("licencia-dias-restantes", `${diasRestantes} día(s)`);
      setElementText("licencia-vigencia-texto", diasRestantes <= 30
        ? "Renovación próxima"
        : "Vigencia saludable"
      );
    }

    const estado = document.getElementById("licencia-estado");
    if (estado) {
      estado.textContent = estadoLabel;
      estado.className = getBadgeClass(estadoLabel);
    }

    const progressBar = document.getElementById("licencia-progress-bar");
    if (progressBar) progressBar.style.width = `${progress}%`;

    renderLicenseModules(modulos);

    document.getElementById("btn-gestionar-licencia")?.classList.toggle("hidden", !userIsSuperAdmin());
    document.getElementById("btn-renovar-licencia")?.classList.toggle("hidden", userIsSuperAdmin() || !renewalVisible);
    setElementText("licencia-help-text", userIsSuperAdmin()
      ? "Puedes cambiar plan, fechas y módulos desde Gestión Multi-Empresa."
      : "Para cambios de plan, contacta al administrador de la plataforma."
    );
    return permisos;
  } catch (error) {
    console.error('Error cargando licencia:', error);
    renderEmptyLicensePlan();
    return null;
  }
}

async function handleGestionarPlanActual() {
  if (!userIsSuperAdmin()) {
    alert("Contacta al administrador de la plataforma para renovar o cambiar el plan.");
    return;
  }

  const empresaId = Number(getCurrentUser().empresa_id || 0);
  if (!empresaId) {
    changeView("empresas");
    return;
  }

  const changed = changeView("empresas");
  if (!changed) return;

  await cargarEmpresas();
  syncLicenciaEmpresaForm(empresaId);
  document.getElementById("form-licencia-empresa")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const status = document.getElementById("config-parqueadero-status");
    if (status) {
      status.textContent = config.general?.modulo_activo ? "Activo" : "Inactivo";
      status.className = config.general?.modulo_activo ? "badge badge-success" : "badge badge-muted";
    }
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
    const status = document.getElementById("config-parqueadero-status");
    if (status) {
      status.textContent = config.general?.modulo_activo ? "Activo" : "Inactivo";
      status.className = config.general?.modulo_activo ? "badge badge-success" : "badge badge-muted";
    }
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
          <td>${renderBadge(ord.estado)}</td>
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
          <td>${renderBadge(ord.metodo_pago, "payment")}</td>
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
        <td>${renderBadge(item.metodo_pago, "payment")}</td>
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
          <td>${renderBadge(ord.estado)}</td>
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
          <td>${renderBadge(ord.metodo_pago, "payment")}</td>
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
let clientesCache = [];
let clientePerfilSeleccionadoId = null;
let clientePerfilActual = null;
let vehiculoPerfilActual = null;
let reciboActual = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toClientNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatClientDate(value, fallback = "Sin actividad") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatClientDateRange(start, end) {
  const inicio = formatClientDate(start, "Sin inicio");
  const fin = formatClientDate(end, "Sin fin");
  return `${inicio} a ${fin}`;
}

function getClientInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "--";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getClientStatus(cliente = {}) {
  const servicios = toClientNumber(cliente.total_servicios);
  const gasto = toClientNumber(cliente.total_gastado);

  if (servicios >= 10 || gasto >= 500000) {
    return { label: "Frecuente", className: "badge-success" };
  }
  if (servicios > 0) {
    return { label: "Activo", className: "badge-info" };
  }
  return { label: "Nuevo", className: "badge-muted" };
}

function getModuleBadgeClass(tipo) {
  const normalized = String(tipo || "").toLowerCase();
  if (normalized.includes("parqueadero")) return "badge-info";
  if (normalized.includes("lavadero")) return "badge-teal";
  if (normalized.includes("taller")) return "badge-warning";
  return "badge-muted";
}

function getMensualidadStatus(mensualidad = {}) {
  const estado = String(mensualidad.estado || "").toUpperCase();
  const fin = mensualidad.fecha_fin ? new Date(mensualidad.fecha_fin) : null;
  const vencida = fin && !Number.isNaN(fin.getTime()) && fin < new Date();

  if (estado === "ACTIVA" && !vencida) {
    return { label: "Activa", className: "badge-success" };
  }
  if (vencida) {
    return { label: "Vencida", className: "badge-danger" };
  }
  return { label: estado || "Inactiva", className: "badge-muted" };
}

function getVehicleStatus(data = {}) {
  if (data.estado === "EN_PARQUEADERO") {
    return { label: "En parqueadero", className: "badge-warning" };
  }
  if (data.estado === "MENSUALIDAD_ACTIVA") {
    return { label: "Mensualidad activa", className: "badge-success" };
  }
  if (data.estado === "REGISTRADO") {
    return { label: "Registrado", className: "badge-info" };
  }
  return { label: "Sin registro", className: "badge-muted" };
}

function getVehiculoPerfilActual() {
  return vehiculoPerfilActual || null;
}

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
  setElementText("veh360-detalle", "Consultando historial de la placa...");
  setElementText("veh360-total", formatMoney(0));
  setElementText("veh360-servicios", "0");
  setElementText("veh360-ultima", "Sin actividad");
  setElementText("veh360-mensualidad", "Sin plan");
  setElementText("veh360-pagado", formatMoney(0));
  setElementText("veh360-pendiente", formatMoney(0));
  setElementText("veh360-en-curso", formatMoney(0));
  setElementText("veh360-recurrente", formatMoney(0));
  setElementText("veh360-propietario", "Sin propietario");
  setElementText("veh360-contacto", "Sin contacto registrado");
  setElementText("veh360-parqueadero", formatMoney(0));
  setElementText("veh360-parqueadero-count", "0 servicios");
  setElementText("veh360-lavadero", formatMoney(0));
  setElementText("veh360-lavadero-count", "0 servicios");
  setElementText("veh360-taller", formatMoney(0));
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
  const detalle = [
    vehiculo.marca,
    vehiculo.modelo,
    vehiculo.color,
  ].filter(Boolean).join(" · ") || "Sin detalle técnico registrado";
  const contacto = [
    propietario.documento ? `Doc. ${propietario.documento}` : null,
    propietario.telefono,
    propietario.correo,
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
  setElementText(
    "veh360-mensualidad",
    mensualidad
      ? `${formatMoney(toClientNumber(mensualidad.valor_mensual))} · ${toClientNumber(mensualidad.dias_restantes)} día(s)`
      : "Sin plan"
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
    document.getElementById("vehiculo-360-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
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
  const tipoEl = document.getElementById("pq-tipo");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");
  const propEl = document.getElementById("pq-es-propietario");

  if (placaEl) placaEl.value = placa;
  if (tipoEl) tipoEl.value = vehiculo.tipo_vehiculo || "CARRO";
  if (nombreEl) nombreEl.value = propietario.nombre || "";
  if (telEl) telEl.value = propietario.telefono || "";
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

function getWalletStatus(resumen = {}) {
  const pendiente = toClientNumber(resumen.total_pendiente);
  const enCurso = toClientNumber(resumen.total_en_curso);
  const abonado = toClientNumber(resumen.total_abonado);

  if (pendiente > 0) {
    if (abonado > 0) {
      return { label: "Con saldo", className: "badge-warning" };
    }
    return { label: "Pendiente", className: "badge-danger" };
  }
  if (enCurso > 0) {
    return { label: "En curso", className: "badge-warning" };
  }
  return { label: "Al día", className: "badge-success" };
}

function renderCarteraActions(item, mode = "pendientes") {
  const modulo = escapeHtml(item.modulo || "");
  const referenciaId = escapeHtml(item.referencia_id || "");
  const acciones = [];

  if (mode !== "pagos" && ["PENDIENTE", "ABONADO"].includes(item.estado_cartera) && modulo && referenciaId) {
    acciones.push(
      `<button type="button" class="btn btn-sm btn-primary" onclick="abrirPagoPendiente('${modulo}','${referenciaId}')">${item.estado_cartera === "ABONADO" ? "Abonar" : "Cobrar"}</button>`
    );
  }

  if (modulo && referenciaId) {
    acciones.push(
      `<button type="button" class="btn btn-sm btn-secondary" onclick="abrirReciboServicio('${modulo}','${referenciaId}')">Recibo</button>`
    );
  }

  return acciones.length
    ? `<div class="table-actions">${acciones.join("")}</div>`
    : "—";
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
        ${mode === "pagos"
          ? ""
          : `<span class="table-subtext">Total ${formatMoney(toClientNumber(item.monto))} · Pagado ${formatMoney(toClientNumber(item.monto_pagado || 0))}</span>`}
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
  renderCarteraRows(
    "cli-cartera-pendientes-tbody",
    "cli-cartera-pendientes-empty",
    [...(data.pendientes || []), ...(data.en_curso || [])].slice(0, 8)
  );
  renderCarteraRows(
    "cli-cartera-pagos-tbody",
    "cli-cartera-pagos-empty",
    (data.pagos || []).slice(0, 8),
    "pagos"
  );
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
          <span>No.</span>
          <strong>${escapeHtml(data.numero || "SIN-NUMERO")}</strong>
          <small>${escapeHtml(generado)}</small>
        </div>
      </div>

      <div class="receipt-subject-grid">
        <div>
          <h3>${escapeHtml(arqueo.estado || "CERRADO")}</h3>
          <p><strong>Fecha de caja:</strong> ${escapeHtml(formatDisplayDate(arqueo.fecha_caja))}</p>
          <p><strong>Rango:</strong> ${escapeHtml(`${formatDisplayDate(arqueo.desde)} a ${formatDisplayDate(arqueo.hasta)}`)}</p>
          <p><strong>Usuario:</strong> ${escapeHtml(sujeto.nombre || "Usuario no registrado")}</p>
          <p><strong>Correo:</strong> ${escapeHtml(sujeto.correo || "N/A")}</p>
        </div>
        <div>
          <h3>Validación</h3>
          <p><strong>Estado de arqueo:</strong> <span class="badge ${diffBadgeClass}">${diffBadgeLabel}</span></p>
          <p><strong>Recaudado:</strong> ${formatMoney(toClientNumber(resumen.total_pagado))}</p>
          <p><strong>Efectivo sistema:</strong> ${formatMoney(toClientNumber(resumen.efectivo_sistema))}</p>
          <p><strong>Efectivo contado:</strong> ${formatMoney(toClientNumber(resumen.efectivo_contado))}</p>
          <p><strong>Diferencia:</strong> ${formatMoney(diferencia)}</p>
        </div>
      </div>

      <div class="receipt-summary-grid">
        <div>
          <span>Facturado</span>
          <strong>${formatMoney(toClientNumber(resumen.total_facturado))}</strong>
        </div>
        <div>
          <span>Recaudado</span>
          <strong>${formatMoney(toClientNumber(resumen.total_pagado))}</strong>
        </div>
        <div>
          <span>Pendiente</span>
          <strong>${formatMoney(toClientNumber(resumen.total_pendiente))}</strong>
        </div>
        <div>
          <span>Servicios</span>
          <strong>${toClientNumber(resumen.servicios_total)}</strong>
        </div>
      </div>

      <table class="receipt-table">
        <thead>
          <tr>
            <th>Método</th>
            <th>Servicios</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${metodos.length ? metodos.map((item) => `
            <tr>
              <td>${escapeHtml(formatCashMethod(item.metodo_pago))}</td>
              <td>${toClientNumber(item.cantidad)}</td>
              <td>${formatMoney(toClientNumber(item.total))}</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="3">Sin recaudo registrado por método de pago.</td>
            </tr>
          `}
        </tbody>
      </table>

      <table class="receipt-table">
        <thead>
          <tr>
            <th>Módulo</th>
            <th>Servicios</th>
            <th>Recaudado</th>
            <th>Pendiente</th>
          </tr>
        </thead>
        <tbody>
          ${modulos.length ? modulos.map((item) => `
            <tr>
              <td>${escapeHtml(formatModuleLabel(item.modulo))}</td>
              <td>${toClientNumber(item.cantidad)}</td>
              <td>${formatMoney(toClientNumber(item.recaudado))}</td>
              <td>${formatMoney(toClientNumber(item.pendiente))}</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="4">Sin módulos registrados para este arqueo.</td>
            </tr>
          `}
        </tbody>
      </table>

      <table class="receipt-table">
        <thead>
          <tr>
            <th>Responsable</th>
            <th>Movimientos</th>
            <th>Recaudado</th>
            <th>Pendiente</th>
          </tr>
        </thead>
        <tbody>
          ${responsables.length ? responsables.map((item) => `
            <tr>
              <td>${escapeHtml(item.responsable_nombre || "Sin responsable")}</td>
              <td>${toClientNumber(item.cantidad)}</td>
              <td>${formatMoney(toClientNumber(item.recaudado))}</td>
              <td>${formatMoney(toClientNumber(item.pendiente))}</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="4">Sin responsables asociados al arqueo.</td>
            </tr>
          `}
        </tbody>
      </table>

      <div class="receipt-footer-note">
        <strong>Observación:</strong> ${escapeHtml(arqueo.observaciones || "Sin observaciones registradas.")}
      </div>
    `;
  }

  const subjectRows = [
    ["Nombre", sujeto.nombre || "No registrado"],
    ["Documento", sujeto.documento || "N/A"],
    ["Teléfono", sujeto.telefono || "N/A"],
    ["Correo", sujeto.correo || "N/A"],
    ["Placa", sujeto.placa || "N/A"],
    ["Vehículo", sujeto.vehiculo || "N/A"],
  ].filter(([, value]) => value !== "N/A" || sujeto.placa || sujeto.vehiculo || sujeto.documento);

  return `
    <div class="receipt-header-block">
      <div>
        <span class="receipt-eyebrow">AutoGestion360</span>
        <h2>${escapeHtml(receiptTitle(data))}</h2>
        <p>${escapeHtml(empresa.nombre || "Empresa")} ${empresa.nit ? `· NIT ${escapeHtml(empresa.nit)}` : ""}</p>
        <p>${escapeHtml([empresa.direccion, empresa.ciudad, empresa.telefono, empresa.email_contacto].filter(Boolean).join(" · ") || "Datos de empresa no registrados")}</p>
      </div>
      <div class="receipt-number-box">
        <span>No.</span>
        <strong>${escapeHtml(data.numero || "SIN-NUMERO")}</strong>
        <small>${escapeHtml(generado)}</small>
      </div>
    </div>

    <div class="receipt-subject-grid">
      <div>
        <h3>${escapeHtml(sujeto.titulo || "Detalle")}</h3>
        ${subjectRows.map(([label, value]) => `
          <p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>
        `).join("")}
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

    <div class="receipt-summary-grid">
      <div>
        <span>Servicios</span>
        <strong>${toClientNumber(resumen.servicios_total)}</strong>
      </div>
      <div>
        <span>Pagados</span>
        <strong>${toClientNumber(resumen.servicios_pagados)}</strong>
      </div>
      <div>
        <span>Pendientes</span>
        <strong>${toClientNumber(resumen.servicios_pendientes)}</strong>
      </div>
      <div>
        <span>Mensualidades activas</span>
        <strong>${toClientNumber(resumen.mensualidades_activas)}</strong>
      </div>
    </div>

    <table class="receipt-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Módulo</th>
          <th>Placa</th>
          <th>Detalle</th>
          <th>Valor</th>
          <th>Pago</th>
          <th>Estado</th>
        </tr>
      </thead>
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
        `).join("") : `
          <tr>
            <td colspan="7">Sin movimientos para este comprobante.</td>
          </tr>
        `}
      </tbody>
    </table>

    <div class="receipt-footer-note">
      <strong>Observación:</strong> Este comprobante resume la información registrada en AutoGestion360 al momento de generación.
    </div>
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
  if (!popup) {
    window.print();
    return;
  }
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

function getClientePerfilActual() {
  return clientePerfilActual?.cliente || null;
}

function setClienteActionMessage(message, isError = false) {
  showMessage("cli-action-msg", message, isError);
}

function cerrarClienteActionPanels() {
  document.querySelectorAll(".client-action-panel").forEach((panel) => {
    panel.hidden = true;
  });

  document.querySelectorAll(".client-profile-actions .btn").forEach((button) => {
    button.classList.remove("active");
  });
}

function setClienteActionButton(action, active) {
  const buttons = {
    editar: "cli-action-editar",
    vehiculo: "cli-action-vehiculo",
    mensualidad: "cli-action-mensualidad",
  };
  const button = document.getElementById(buttons[action]);
  if (button) button.classList.toggle("active", active);
}

function abrirClienteActionPanel(action) {
  if (!getClientePerfilActual()) {
    setClienteActionMessage("Selecciona un cliente para usar las acciones rápidas.", true);
    return;
  }

  const panels = {
    editar: "form-cli-editar",
    vehiculo: "form-cli-vehiculo",
    mensualidad: "form-cli-mensualidad",
  };
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
  const form = document.getElementById("form-cli-vehiculo");
  form?.reset();
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
      ${vehiculos.map((vehiculo) => `
        <option value="${escapeHtml(vehiculo.placa || "")}" data-tipo="${escapeHtml(vehiculo.tipo_vehiculo || "CARRO")}" data-marca="${escapeHtml(vehiculo.marca || "")}" data-modelo="${escapeHtml(vehiculo.modelo || "")}" data-color="${escapeHtml(vehiculo.color || "")}">
          ${escapeHtml(vehiculo.placa || "Sin placa")} · ${escapeHtml(vehiculo.tipo_vehiculo || "Vehículo")}
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

async function handleEditarCliente360(event) {
  event.preventDefault();
  const cliente = getClientePerfilActual();
  if (!cliente) return;

  const nombre = document.getElementById("cli-edit-nombre").value.trim();
  const documento = document.getElementById("cli-edit-documento").value.trim();
  const telefono = document.getElementById("cli-edit-telefono").value.trim();
  const correo = document.getElementById("cli-edit-correo").value.trim();

  if (!nombre) {
    setClienteActionMessage("El nombre es obligatorio.", true);
    return;
  }

  try {
    await apiFetch(`/api/clientes/${cliente.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        nombre,
        documento: documento || null,
        telefono: telefono || null,
        correo: correo || null,
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
  const marca = document.getElementById("cli-veh-marca").value.trim();
  const modelo = document.getElementById("cli-veh-modelo").value.trim();
  const color = document.getElementById("cli-veh-color").value.trim();

  if (!placa || !tipo) {
    setClienteActionMessage("Placa y tipo son obligatorios.", true);
    return;
  }

  try {
    await apiFetch("/api/vehiculos", {
      method: "POST",
      body: JSON.stringify({
        cliente_id: cliente.id,
        placa,
        tipo,
        tipo_vehiculo: tipo,
        marca: marca || null,
        modelo: modelo || null,
        color: color || null,
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
  return {
    marca: option.dataset.marca || null,
    modelo: option.dataset.modelo || null,
    color: option.dataset.color || null,
  };
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
  const direccion = document.getElementById("cli-men-direccion").value.trim();
  const contacto_emergencia = document.getElementById("cli-men-contacto").value.trim();
  const observaciones = document.getElementById("cli-men-obs").value.trim();
  const vehiculoSeleccionado = getVehiculoMensualidadSeleccionado();

  if (!documento || !placa || !tipo_vehiculo || !fecha_inicio || !fecha_fin) {
    setClienteActionMessage("Documento, placa, tipo, inicio y fin son obligatorios.", true);
    return;
  }

  if (!Number.isFinite(valor_mensual) || valor_mensual < 0) {
    setClienteActionMessage("El valor mensual no es válido.", true);
    return;
  }

  try {
    await apiFetch("/api/parqueadero/mensualidades", {
      method: "POST",
      body: JSON.stringify({
        nombre_cliente: cliente.nombre,
        documento,
        telefono: cliente.telefono || null,
        correo: cliente.correo || null,
        direccion: direccion || null,
        contacto_emergencia: contacto_emergencia || null,
        placa,
        tipo_vehiculo,
        marca: vehiculoSeleccionado.marca,
        modelo: vehiculoSeleccionado.modelo,
        color: vehiculoSeleccionado.color,
        fecha_inicio,
        fecha_fin,
        valor_mensual,
        observaciones: observaciones || null,
      }),
    });

    if (typeof cargarMensualidadesParqueadero === "function") {
      cargarMensualidadesParqueadero();
    }
    await refrescarCliente360Actual("Mensualidad creada correctamente.");
  } catch (err) {
    setClienteActionMessage(err.message || "No se pudo crear la mensualidad.", true);
  }
}

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

  return clientesCache.filter((cli) => {
    const text = [
      cli.nombre,
      cli.documento,
      cli.telefono,
      cli.correo,
      cli.total_servicios,
      cli.total_gastado,
    ].join(" ").toLowerCase();
    return text.includes(query);
  });
}

function renderClientesTable(clientes) {
  const tbody = document.getElementById("cli-lista-tbody");
  const empty = document.getElementById("cli-lista-empty");
  if (!tbody || !empty) return;

  tbody.innerHTML = clientes.map((cli) => {
    const status = getClientStatus(cli);
    const totalServicios = toClientNumber(cli.total_servicios);
    const totalGastado = toClientNumber(cli.total_gastado);
    const parqueadero = toClientNumber(cli.total_parqueadero);
    const lavadero = toClientNumber(cli.total_lavadero);
    const taller = toClientNumber(cli.total_taller);
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
          <strong>${totalServicios}</strong>
          <small class="muted-inline">P ${parqueadero} · L ${lavadero} · T ${taller}</small>
        </td>
        <td>${formatMoney(totalGastado)}</td>
        <td>${formatClientDate(cli.ultima_actividad || cli.fecha_registro)}</td>
        <td><span class="badge ${status.className}">${status.label}</span></td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="verDetallesCliente(${Number(cli.id)})">Ver perfil</button>
        </td>
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

function cerrarPerfilCliente() {
  clientePerfilSeleccionadoId = null;
  clientePerfilActual = null;
  cerrarVehiculo360();
  cerrarClienteActionPanels();
  const panel = document.getElementById("cli-perfil-panel");
  if (panel) panel.hidden = true;
}

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

  const vehiculosGrid = document.getElementById("cli-vehiculos-grid");
  const mensualidadesTbody = document.getElementById("cli-mensualidades-tbody");
  const historialTbody = document.getElementById("cli-historial-tbody");
  if (vehiculosGrid) vehiculosGrid.innerHTML = "";
  if (mensualidadesTbody) mensualidadesTbody.innerHTML = "";
  if (historialTbody) historialTbody.innerHTML = "";
  renderClienteCarteraLoading();
}

function renderClienteVehiculos(vehiculos = []) {
  const grid = document.getElementById("cli-vehiculos-grid");
  const empty = document.getElementById("cli-vehiculos-empty");
  if (!grid || !empty) return;

  grid.innerHTML = vehiculos.map((vehiculo) => {
    const placa = vehiculo.placa || "";
    return `
      <article class="client-vehicle-item">
        <div>
          <strong>${escapeHtml(placa || "Sin placa")}</strong>
          <span>${escapeHtml([vehiculo.tipo_vehiculo, vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" · ") || "Sin detalle")}</span>
        </div>
        <div class="client-vehicle-meta">
          <span class="badge badge-muted">${toClientNumber(vehiculo.total_servicios)} servicios</span>
          <strong>${formatMoney(toClientNumber(vehiculo.total_gastado))}</strong>
          <button type="button" class="btn btn-sm btn-secondary" onclick="verVehiculo360('${encodeURIComponent(placa)}')">Ver 360</button>
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

  tbody.innerHTML = mensualidades.map((mensualidad) => {
    const status = getMensualidadStatus(mensualidad);
    return `
      <tr>
        <td>${escapeHtml(mensualidad.placa || "Sin placa")}</td>
        <td>${escapeHtml(formatClientDateRange(mensualidad.fecha_inicio, mensualidad.fecha_fin))}</td>
        <td>${formatMoney(toClientNumber(mensualidad.valor_mensual))}</td>
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
  const status = getClientStatus({
    ...cliente,
    total_servicios: estadisticas.total_servicios,
    total_gastado: estadisticas.total_gastado,
  });
  const contacto = [
    cliente.documento ? `Doc. ${cliente.documento}` : null,
    cliente.telefono,
    cliente.correo,
  ].filter(Boolean).join(" · ") || "Sin contacto registrado";

  setElementText("cli-perfil-iniciales", getClientInitials(cliente.nombre));
  setElementText("cli-perfil-badge", status.label);
  const badge = document.getElementById("cli-perfil-badge");
  if (badge) {
    badge.className = `badge ${status.className}`;
  }
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
    document.getElementById("cli-perfil-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  } catch (err) {
    showMessage("cli-msg", "Error cargando detalles: " + err.message, true);
    cerrarPerfilCliente();
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
let reportesActuales = null;

function setFechasDefecto() {
  const hoy = new Date();
  const hace30 = new Date(hoy);
  hace30.setDate(hace30.getDate() - 30);

  const desdeEl = document.getElementById("rep-desde");
  const hastaEl = document.getElementById("rep-hasta");
  if (desdeEl && !desdeEl.value) desdeEl.valueAsDate = hace30;
  if (hastaEl && !hastaEl.value) hastaEl.valueAsDate = hoy;
}

function setReportRangeAndGenerate(daysBack) {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(hoy.getDate() - daysBack);

  const desdeEl = document.getElementById("rep-desde");
  const hastaEl = document.getElementById("rep-hasta");
  if (desdeEl) desdeEl.valueAsDate = desde;
  if (hastaEl) hastaEl.valueAsDate = hoy;
  handleGenerarReportes();
}

function updateReportRangeLabel(desde, hasta) {
  const label = document.getElementById("rep-range-label");
  if (!label) return;
  label.textContent = `${formatDisplayDate(desde)} - ${formatDisplayDate(hasta)}`;
}

function setRevenueSegmentWidths(resumen = {}) {
  const parqueadero = Number(resumen.parqueadero?.total || 0);
  const lavadero = Number(resumen.lavadero?.total || 0);
  const taller = Number(resumen.taller?.total || 0);
  const total = parqueadero + lavadero + taller;

  if (total <= 0) {
    setSegmentWidth("rep-revenue-parqueadero-bar", 33.33);
    setSegmentWidth("rep-revenue-lavadero-bar", 33.33);
    setSegmentWidth("rep-revenue-taller-bar", 33.34);
    return;
  }

  setSegmentWidth("rep-revenue-parqueadero-bar", (parqueadero / total) * 100);
  setSegmentWidth("rep-revenue-lavadero-bar", (lavadero / total) * 100);
  setSegmentWidth("rep-revenue-taller-bar", (taller / total) * 100);
}

function getTopReportModule(resumen = {}) {
  const modules = [
    ["Parqueadero", Number(resumen.parqueadero?.total || 0)],
    ["Lavadero", Number(resumen.lavadero?.total || 0)],
    ["Taller", Number(resumen.taller?.total || 0)],
  ];
  modules.sort((a, b) => b[1] - a[1]);
  return modules[0][1] > 0 ? modules[0][0] : "-";
}

function getInclusiveDayCount(desde, hasta) {
  const start = parseDateParam(desde);
  const end = parseDateParam(hasta);
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff + 1);
}

function formatCashMethod(value) {
  const labels = {
    EFECTIVO: "Efectivo",
    TARJETA: "Tarjeta",
    TRANSFERENCIA: "Transferencia",
    MIXTO: "Mixto",
    MENSUALIDAD: "Mensualidad",
    OTRO: "Otro",
    SIN_METODO: "Sin método",
  };
  return labels[String(value || "").toUpperCase()] || value || "Sin método";
}

function formatModuleLabel(value) {
  const labels = {
    parqueadero: "Parqueadero",
    lavadero: "Lavadero",
    taller: "Taller",
  };
  return labels[String(value || "").toLowerCase()] || value || "Servicio";
}

function renderCashProgressList(items, { containerId, emptyId, countId, valueKey = "total", labelKey, total = 0 }) {
  const container = document.getElementById(containerId);
  const empty = document.getElementById(emptyId);
  if (!container || !empty) return;

  const safeItems = Array.isArray(items) ? items : [];
  if (countId) {
    setElementText(countId, `${safeItems.length} ${safeItems.length === 1 ? "registro" : "registros"}`);
  }

  container.innerHTML = safeItems.map((item) => {
    const value = Number(item[valueKey] || 0);
    const percentage = total > 0 ? Math.max(4, Math.min(100, (value / total) * 100)) : 0;
    const labelRaw = labelKey === "metodo_pago"
      ? formatCashMethod(item[labelKey])
      : item[labelKey] || "Sin responsable";
    const subValue = valueKey === "total"
      ? `${Number(item.cantidad || 0)} servicio${Number(item.cantidad || 0) === 1 ? "" : "s"}`
      : `${formatMoney(item.recaudado || 0)} recaudado · ${formatMoney(item.pendiente || 0)} pendiente`;

    return `
      <div class="cash-method-item">
        <div class="cash-method-row">
          <strong>${escapeHtml(labelRaw)}</strong>
          <span>${formatMoney(value)}</span>
        </div>
        <div class="cash-method-row muted-row">
          <small>${escapeHtml(subValue)}</small>
          <small>${total > 0 ? `${Math.round(percentage)}%` : "0%"}</small>
        </div>
        <div class="cash-progress"><span style="width:${percentage}%"></span></div>
      </div>
    `;
  }).join("");

  empty.hidden = safeItems.length > 0;
}

function renderCajaPendientes(pendientes = []) {
  const tbody = document.getElementById("rep-caja-pendientes-tbody");
  const empty = document.getElementById("rep-caja-pendientes-empty");
  if (!tbody || !empty) return;

  const visible = pendientes.slice(0, 10);
  tbody.innerHTML = visible.map((item) => `
    <tr>
      <td>
        <strong>${escapeHtml(formatModuleLabel(item.modulo))}</strong>
        <span class="table-subtext">${escapeHtml(item.placa || item.concepto || "Sin placa")}</span>
      </td>
      <td>${escapeHtml(item.cliente_nombre || item.responsable_nombre || "No registrado")}</td>
      <td>
        <strong>${formatMoney(item.saldo_pendiente || item.monto || 0)}</strong>
        <span class="table-subtext">Total ${formatMoney(item.monto || 0)} · Pagado ${formatMoney(item.monto_pagado || 0)}</span>
      </td>
      <td>
        <div class="table-actions">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick="abrirPagoPendiente('${escapeHtml(item.modulo || "")}','${escapeHtml(item.referencia_id || "")}')"
          >
            ${item.monto_pagado > 0 ? "Abonar" : "Cobrar"}
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  empty.hidden = visible.length > 0;
}

function renderCajaMovimientos(movimientos = []) {
  const tbody = document.getElementById("rep-caja-movimientos-tbody");
  const empty = document.getElementById("rep-caja-movimientos-empty");
  if (!tbody || !empty) return;

  const visible = movimientos.slice(0, 12);
  tbody.innerHTML = visible.map((item) => `
    <tr>
      <td>${formatDisplayDate(item.fecha)}</td>
      <td>
        <strong>${escapeHtml(formatModuleLabel(item.modulo))}</strong>
        <span class="table-subtext">${escapeHtml(item.placa || item.concepto || "Sin placa")}</span>
      </td>
      <td>${renderBadge(formatCashMethod(item.metodo_pago), "payment")}</td>
      <td>
        <strong>${formatMoney((item.estado_caja === "PENDIENTE" || item.estado_caja === "ABONADO") ? (item.saldo_pendiente || item.monto || 0) : (item.monto_pagado || item.monto || 0))}</strong>
        <span class="table-subtext">${escapeHtml(item.estado_caja || "PAGADO")}</span>
      </td>
    </tr>
  `).join("");

  empty.hidden = visible.length > 0;
}

function renderReportesCaja(caja = {}) {
  const resumen = caja.resumen || {};
  const totalFacturado = Number(resumen.total_facturado || 0);
  const totalRecaudado = Number(resumen.total_recaudado || 0);
  const totalPendiente = Number(resumen.total_pendiente || 0);
  const serviciosTotal = Number(resumen.servicios_total || 0);
  const serviciosPagados = Number(resumen.servicios_pagados || 0);
  const serviciosPendientes = Number(resumen.servicios_pendientes || 0);

  setElementText("rep-caja-recaudado", formatMoney(totalRecaudado));
  setElementText("rep-caja-pagados", `${serviciosPagados} servicio${serviciosPagados === 1 ? "" : "s"} pagado${serviciosPagados === 1 ? "" : "s"}`);
  setElementText("rep-caja-pendiente", formatMoney(totalPendiente));
  setElementText("rep-caja-pendientes-count", `${serviciosPendientes} servicio${serviciosPendientes === 1 ? "" : "s"} pendiente${serviciosPendientes === 1 ? "" : "s"}`);
  setElementText("rep-caja-facturado", formatMoney(totalFacturado));
  setElementText("rep-caja-servicios", `${serviciosTotal} servicio${serviciosTotal === 1 ? "" : "s"} cerrado${serviciosTotal === 1 ? "" : "s"}`);
  setElementText("rep-caja-diferencia", formatMoney(totalFacturado - totalRecaudado));
  setElementText("rep-caja-pendientes-badge", `${serviciosPendientes} pendiente${serviciosPendientes === 1 ? "" : "s"}`);
  setElementText("rep-caja-movimientos-count", `${(caja.movimientos || []).length} movimientos`);

  const status = document.getElementById("rep-caja-status");
  if (status) {
    if (serviciosPendientes > 0) {
      status.textContent = "Con pendientes";
      status.className = "badge badge-warning";
    } else if (serviciosTotal > 0) {
      status.textContent = "Cuadre al día";
      status.className = "badge badge-success";
    } else {
      status.textContent = "Sin movimientos";
      status.className = "badge badge-muted";
    }
  }

  setElementText("rep-caja-updated", caja.generado_en ? `Actualizado ${formatDateTime(caja.generado_en)}` : "Sin actualizar");
  setElementText("rep-caja-efectivo-sistema", formatMoney(getCajaEfectivoSistema(caja)));
  actualizarDiferenciaArqueo();

  renderCashProgressList(caja.metodos_pago, {
    containerId: "rep-caja-metodos-list",
    emptyId: "rep-caja-metodos-empty",
    countId: "rep-caja-metodos-count",
    labelKey: "metodo_pago",
    valueKey: "total",
    total: totalRecaudado,
  });

  renderCashProgressList(caja.responsables, {
    containerId: "rep-caja-responsables-list",
    emptyId: "rep-caja-responsables-empty",
    countId: "rep-caja-responsables-count",
    labelKey: "responsable_nombre",
    valueKey: "recaudado",
    total: totalRecaudado,
  });

  renderCajaPendientes(caja.pendientes || []);
  renderCajaMovimientos(caja.movimientos || []);
}

function getCajaEfectivoSistema(caja = reportesActuales?.caja) {
  const metodos = Array.isArray(caja?.metodos_pago) ? caja.metodos_pago : [];
  return Number(metodos.find((metodo) => String(metodo.metodo_pago || "").toUpperCase() === "EFECTIVO")?.total || 0);
}

function actualizarDiferenciaArqueo() {
  const input = document.getElementById("rep-caja-efectivo-contado");
  const diffEl = document.getElementById("rep-caja-efectivo-diferencia");
  if (!input || !diffEl) return;

  const sistema = getCajaEfectivoSistema();
  const contadoRaw = input.value;
  const diferencia = contadoRaw === "" ? 0 : Number(contadoRaw || 0) - sistema;
  diffEl.textContent = formatMoney(diferencia);
  diffEl.className = diferencia === 0 ? "" : diferencia > 0 ? "cash-diff-positive" : "cash-diff-negative";
}

function renderCajaArqueos(arqueos = []) {
  const tbody = document.getElementById("rep-caja-arqueos-tbody");
  const empty = document.getElementById("rep-caja-arqueos-empty");
  if (!tbody || !empty) return;

  tbody.innerHTML = arqueos.map((arqueo) => {
    const diferencia = Number(arqueo.diferencia || 0);
    const diffClass = diferencia === 0 ? "badge-success" : diferencia > 0 ? "badge-info" : "badge-danger";
    return `
      <tr>
        <td>
          <strong>${formatDisplayDate(arqueo.fecha_caja)}</strong>
          <span class="table-subtext">${formatDisplayDate(arqueo.desde)} - ${formatDisplayDate(arqueo.hasta)}</span>
        </td>
        <td>${formatMoney(arqueo.total_recaudado || 0)}</td>
        <td>
          <strong>${formatMoney(arqueo.efectivo_contado || 0)}</strong>
          <span class="table-subtext">Sistema ${formatMoney(arqueo.efectivo_sistema || 0)}</span>
        </td>
        <td><span class="badge ${diffClass}">${formatMoney(diferencia)}</span></td>
        <td>${escapeHtml(arqueo.usuario_nombre || "Usuario")}</td>
        <td>
          <button type="button" class="btn btn-sm btn-secondary" onclick="abrirReciboArqueo(${Number(arqueo.id)})">Comprobante</button>
        </td>
      </tr>
    `;
  }).join("");

  empty.hidden = arqueos.length > 0;
  setElementText("rep-caja-arqueos-count", `${arqueos.length} arqueo${arqueos.length === 1 ? "" : "s"}`);
}

async function cargarArqueosCaja() {
  try {
    const arqueos = await apiFetch("/api/reportes/caja/arqueos?limit=10");
    renderCajaArqueos(Array.isArray(arqueos) ? arqueos : []);
  } catch (err) {
    console.error("Error cargando arqueos de caja:", err);
    renderCajaArqueos([]);
  }
}

async function handleGuardarArqueoCaja(event) {
  event.preventDefault();

  if (!reportesActuales?.caja) {
    showMessage("rep-caja-arqueo-msg", "Genera el cierre de caja antes de guardar el arqueo.", true);
    return;
  }

  const efectivoContado = Number(document.getElementById("rep-caja-efectivo-contado")?.value || 0);
  const observaciones = document.getElementById("rep-caja-observaciones")?.value.trim() || "";

  try {
    const data = await apiFetch("/api/reportes/caja/arqueos", {
      method: "POST",
      body: JSON.stringify({
        desde: reportesActuales.desde,
        hasta: reportesActuales.hasta,
        fecha_caja: reportesActuales.hasta,
        efectivo_contado: efectivoContado,
        observaciones,
      }),
    });

    showMessage("rep-caja-arqueo-msg", data.mensaje || "Arqueo guardado.");
    document.getElementById("rep-caja-observaciones").value = "";
    await cargarArqueosCaja();
    if (data.arqueo?.id) {
      await abrirReciboArqueo(data.arqueo.id, "rep-caja-arqueo-msg");
    }
  } catch (err) {
    showMessage("rep-caja-arqueo-msg", err.message || "No se pudo guardar el arqueo.", true);
  }
}

async function abrirReciboArqueo(id, messageElementId = "rep-caja-arqueo-msg") {
  if (!id) return;

  try {
    const data = await apiFetch(`/api/reportes/caja/arqueos/${encodeURIComponent(id)}/comprobante`);
    mostrarRecibo(data);
  } catch (err) {
    showMessage(messageElementId, err.message || "No se pudo generar el comprobante del arqueo.", true);
  }
}

function renderReportesResumen(resumen = {}, diario = {}, desde, hasta) {
  const total = Number(resumen.total_general || 0);
  const cantidad = Number(resumen.cantidad_total || 0);
  const dayCount = getInclusiveDayCount(desde, hasta);

  setElementText("rep-pq-total", formatMoney(resumen.parqueadero?.total || 0));
  setElementText("rep-pq-cant", `${Number(resumen.parqueadero?.cantidad || 0)} servicios`);
  setElementText("rep-lav-total", formatMoney(resumen.lavadero?.total || 0));
  setElementText("rep-lav-cant", `${Number(resumen.lavadero?.cantidad || 0)} servicios`);
  setElementText("rep-tal-total", formatMoney(resumen.taller?.total || 0));
  setElementText("rep-tal-cant", `${Number(resumen.taller?.cantidad || 0)} servicios`);
  setElementText("rep-total", formatMoney(total));
  setElementText("rep-breakdown-total", formatMoney(total));
  setElementText("rep-cant-total", `${cantidad} servicios`);
  setElementText("rep-ticket-promedio", formatMoney(cantidad ? total / cantidad : 0));
  setElementText("rep-top-canal", getTopReportModule(resumen));
  setElementText("rep-promedio-diario", formatMoney(total / dayCount));
  setElementText("rep-generated-at", `${diario.dias?.length || 0} día(s) con actividad`);
  setElementText("rep-diario-count", `${diario.dias?.length || 0} días`);

  setRevenueSegmentWidths(resumen);
}

function renderReportesTablas(diario = {}, clientes = {}, empleados = {}) {
  const tbodyDiario = document.getElementById("rep-diario-tbody");
  const dias = diario.dias || [];
  if (tbodyDiario) {
    tbodyDiario.innerHTML = dias.map(dia => `
      <tr>
        <td>${formatDisplayDate(dia.fecha)}</td>
        <td>${formatMoney(dia.parqueadero.total)}</td>
        <td>${formatMoney(dia.lavadero.total)}</td>
        <td>${formatMoney(dia.taller.total)}</td>
        <td><strong>${formatMoney(dia.total_general)}</strong></td>
      </tr>
    `).join("");
    document.getElementById("rep-diario-empty").hidden = dias.length > 0;
  }

  const tbodyClientes = document.getElementById("rep-clientes-tbody");
  const clientesLista = clientes.clientes || [];
  if (tbodyClientes) {
    tbodyClientes.innerHTML = clientesLista.map(cli => `
      <tr>
        <td>
          <strong>${cli.nombre}</strong>
          <span class="table-subtext">${cli.telefono || cli.documento || "Sin contacto"}</span>
        </td>
        <td>${Number(cli.total_servicios || 0)}</td>
        <td><strong>${formatMoney(cli.total_gastado || 0)}</strong></td>
      </tr>
    `).join("");
    document.getElementById("rep-clientes-empty").hidden = clientesLista.length > 0;
  }
  setElementText("rep-clientes-count", `${clientesLista.length} clientes`);

  const tbodyEmpleados = document.getElementById("rep-empleados-tbody");
  const empleadosLista = empleados.empleados || [];
  if (tbodyEmpleados) {
    tbodyEmpleados.innerHTML = empleadosLista.map(emp => {
      const servicios = Number(emp.lavados_realizados || 0) + Number(emp.ordenes_taller || 0);
      return `
        <tr>
          <td>${emp.nombre}</td>
          <td>${renderBadge(emp.rol || "Sin rol", "status")}</td>
          <td>${servicios}</td>
          <td><strong>${formatMoney(emp.total_general || 0)}</strong></td>
        </tr>
      `;
    }).join("");
    document.getElementById("rep-empleados-empty").hidden = empleadosLista.length > 0;
  }
  setElementText("rep-empleados-count", `${empleadosLista.length} empleados`);
}

async function handleGenerarReportes(event) {
  event?.preventDefault();
  const desde = document.getElementById("rep-desde").value;
  const hasta = document.getElementById("rep-hasta").value;

  if (!desde || !hasta) {
    alert("Seleccione rango de fechas.");
    return;
  }

  try {
    const [resumen, diario, caja, clientes, empleados] = await Promise.all([
      apiFetch(`/api/reportes/resumen?desde=${desde}&hasta=${hasta}`),
      apiFetch(`/api/reportes/diario?desde=${desde}&hasta=${hasta}`),
      apiFetch(`/api/reportes/caja?desde=${desde}&hasta=${hasta}`),
      apiFetch(`/api/reportes/clientes?desde=${desde}&hasta=${hasta}`),
      apiFetch(`/api/reportes/empleados?desde=${desde}&hasta=${hasta}`),
    ]);

    reportesActuales = { desde, hasta, resumen, diario, caja, clientes, empleados };
    updateReportRangeLabel(desde, hasta);
    renderReportesResumen(resumen, diario, desde, hasta);
    renderReportesCaja(caja);
    renderReportesTablas(diario, clientes, empleados);
    await cargarArqueosCaja();
  } catch (err) {
    alert("Error generando reportes: " + err.message);
  }
}

function csvCell(value) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function buildReportesCSV() {
  if (!reportesActuales) return "";

  const rows = [
    ["Reporte", `${reportesActuales.desde} a ${reportesActuales.hasta}`],
    [],
    ["Resumen"],
    ["Módulo", "Servicios", "Ingresos"],
    ["Parqueadero", reportesActuales.resumen.parqueadero?.cantidad || 0, reportesActuales.resumen.parqueadero?.total || 0],
    ["Lavadero", reportesActuales.resumen.lavadero?.cantidad || 0, reportesActuales.resumen.lavadero?.total || 0],
    ["Taller", reportesActuales.resumen.taller?.cantidad || 0, reportesActuales.resumen.taller?.total || 0],
    ["Total", reportesActuales.resumen.cantidad_total || 0, reportesActuales.resumen.total_general || 0],
    [],
    ["Cierre de caja"],
    ["Concepto", "Servicios", "Valor"],
    ["Facturado", reportesActuales.caja?.resumen?.servicios_total || 0, reportesActuales.caja?.resumen?.total_facturado || 0],
    ["Recaudado", reportesActuales.caja?.resumen?.servicios_pagados || 0, reportesActuales.caja?.resumen?.total_recaudado || 0],
    ["Pendiente", reportesActuales.caja?.resumen?.servicios_pendientes || 0, reportesActuales.caja?.resumen?.total_pendiente || 0],
    [],
    ["Métodos de pago"],
    ["Método", "Servicios", "Total"],
    ...(reportesActuales.caja?.metodos_pago || []).map((metodo) => [
      formatCashMethod(metodo.metodo_pago),
      metodo.cantidad || 0,
      metodo.total || 0,
    ]),
    [],
    ["Pendientes por cobrar"],
    ["Fecha", "Módulo", "Placa", "Cliente", "Monto"],
    ...(reportesActuales.caja?.pendientes || []).map((item) => [
      item.fecha || "",
      formatModuleLabel(item.modulo),
      item.placa || "",
      item.cliente_nombre || item.responsable_nombre || "",
      item.monto || 0,
    ]),
    [],
    ["Arqueo actual"],
    ["Efectivo sistema", "Efectivo contado", "Diferencia"],
    [
      getCajaEfectivoSistema(reportesActuales.caja),
      document.getElementById("rep-caja-efectivo-contado")?.value || 0,
      (Number(document.getElementById("rep-caja-efectivo-contado")?.value || 0) - getCajaEfectivoSistema(reportesActuales.caja)),
    ],
    [],
    ["Ingresos por día"],
    ["Fecha", "Parqueadero", "Lavadero", "Taller", "Total"],
    ...(reportesActuales.diario.dias || []).map((dia) => [
      dia.fecha,
      dia.parqueadero?.total || 0,
      dia.lavadero?.total || 0,
      dia.taller?.total || 0,
      dia.total_general || 0,
    ]),
    [],
    ["Clientes más activos"],
    ["Cliente", "Servicios", "Total gastado"],
    ...(reportesActuales.clientes.clientes || []).map((cliente) => [
      cliente.nombre,
      cliente.total_servicios || 0,
      cliente.total_gastado || 0,
    ]),
    [],
    ["Equipo productivo"],
    ["Empleado", "Rol", "Servicios", "Ingresos"],
    ...(reportesActuales.empleados.empleados || []).map((empleado) => [
      empleado.nombre,
      empleado.rol,
      Number(empleado.lavados_realizados || 0) + Number(empleado.ordenes_taller || 0),
      empleado.total_general || 0,
    ]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function exportReportesCSV() {
  if (!reportesActuales) {
    alert("Genera un reporte antes de exportar.");
    return;
  }

  const csv = buildReportesCSV();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-autogestion360-${reportesActuales.desde}-${reportesActuales.hasta}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
