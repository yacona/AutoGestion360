/* =========================================================
   UTILIDADES DE UI — formateo, mensajes, modal de cobro
   Depende de: storage.js (STORAGE), api.js (apiFetch)
   ========================================================= */

// ── Formateo ─────────────────────────────────────────────

function normalizeRole(role) {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function formatMoney(value) {
  return Number(value).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO");
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

function getDaysRemaining(dateValue) {
  if (!dateValue) return null;
  const end = new Date(dateValue);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
}

function getLicenseProgress(startValue, endValue) {
  if (!startValue || !endValue) return 100;
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 100;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

// ── DOM helpers ───────────────────────────────────────────

function setElementText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function setSegmentWidth(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function getActiveViewName() {
  return document.querySelector(".view.visible")?.id?.replace(/^view-/, "") || "";
}

// ── Mensajes ──────────────────────────────────────────────

function showMessage(elementId, message, isError = false) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.className = "small-message " + (isError ? "error" : "ok");
    el.hidden = false;
    setTimeout(() => (el.hidden = true), 4000);
  }
}

function showError(message, elementId = "login-error") {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.hidden = false;
    setTimeout(() => (element.hidden = true), 5000);
  }
}

function showSuccess(message, elementId = "empresa-success") {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.hidden = false;
    setTimeout(() => (element.hidden = true), 5000);
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

// ── Badges ────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

// ── Tema ──────────────────────────────────────────────────

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

// ── Logo ─────────────────────────────────────────────────

function updateLogoPreview(logoUrl, empresaNombre) {
  const preview = document.getElementById("logo-preview");
  if (!preview) return;
  preview.innerHTML = "";
  if (logoUrl) {
    const img = document.createElement("img");
    img.src = logoUrl;
    img.alt = "Logo de la empresa";
    preview.appendChild(img);
  } else {
    preview.textContent = "Sin logo";
  }
  updateSidebarLogo(logoUrl, empresaNombre);
}

function updateSidebarLogo(logoUrl, empresaNombre) {
  const logoCircle = document.querySelector(".sidebar-logo-circle");
  if (!logoCircle) return;
  if (logoUrl) {
    logoCircle.style.backgroundImage = `url(${logoUrl})`;
    logoCircle.style.backgroundSize = "cover";
    logoCircle.style.backgroundPosition = "center";
    logoCircle.textContent = "";
  } else {
    logoCircle.style.backgroundImage = "none";
    logoCircle.textContent = empresaNombre ? empresaNombre.slice(0, 1).toUpperCase() : "A";
  }
}

// ── Pago — modal de salida ────────────────────────────────

function actualizarCamposPagoServicio(selectId, referenciaGroupId, detalleGroupId) {
  const metodo = document.getElementById(selectId)?.value || "";
  const referenciaGroup = document.getElementById(referenciaGroupId);
  const detalleGroup = document.getElementById(detalleGroupId);
  if (referenciaGroup) referenciaGroup.hidden = !(metodo === "TARJETA" || metodo === "TRANSFERENCIA");
  if (detalleGroup) detalleGroup.hidden = !(metodo === "OTRO" || metodo === "MIXTO");
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

// ── Modal de cobro de servicio (lavadero / taller) ────────

let cobroServicioActual = null;

function limpiarModalCobroServicio() {
  ["cobro-metodo-pago", "cobro-referencia", "cobro-detalle-pago", "cobro-observaciones", "cobro-monto-pago"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  actualizarCamposPagoServicio("cobro-metodo-pago", "cobro-referencia-group", "cobro-detalle-pago-group");
}

function configureCobroMonto({ total = 0, pagado = 0, saldo = 0, montoSugerido = null, allowPartial = false, requireAmount = true }) {
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
    if (montoHelp) montoHelp.textContent = "Este cierre no requiere cobro adicional.";
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

function setCobroServicioActionLabel(label) {
  const button = document.getElementById("btn-confirmar-cobro-servicio");
  if (button) button.textContent = label || "✓ Confirmar servicio y pago";
}

function buildCobroDetallePayload({ referencia, detalle, observaciones }) {
  const payload = {};
  if (referencia) payload.referencia = referencia;
  if (detalle) payload.detalle = detalle;
  if (observaciones) payload.observaciones = observaciones;
  return Object.keys(payload).length ? payload : null;
}

function populateCobroServicioModal({
  title, placa, tipo, responsable, estado, cliente, inicio, fin, tiempo,
  valor, pagado = 0, saldo = null, montoSugerido = null,
  allowPartial = false, requireAmount = true, actionLabel = "✓ Confirmar servicio y pago",
}) {
  const total = Number(valor || 0);
  const pagadoNum = Number(pagado || 0);
  const saldoNum = saldo === null || saldo === undefined ? Math.max(total - pagadoNum, 0) : Number(saldo || 0);

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
  configureCobroMonto({ total, pagado: pagadoNum, saldo: saldoNum, montoSugerido, allowPartial, requireAmount });
  setCobroServicioActionLabel(actionLabel);
  document.getElementById("modal-cobro-servicio")?.classList.remove("hidden");
}

function cerrarModalCobroServicio() {
  document.getElementById("modal-cobro-servicio")?.classList.add("hidden");
  setCobroServicioActionLabel("✓ Confirmar servicio y pago");
  cobroServicioActual = null;
}

async function refrescarContextoDespuesDeCobro() {
  const tareas = [loadDashboard()];
  const activeView = getActiveViewName();

  if (activeView === "parqueadero") {
    tareas.push(cargarParqueaderoActivo(), cargarHistorialParqueadero(), cargarMensualidadesParqueadero());
  }
  if (activeView === "lavadero") tareas.push(cargarOrdeneesLavadero());
  if (activeView === "taller") tareas.push(cargarOrdensTaller());
  if (activeView === "reportes" && reportesActuales) {
    tareas.push(handleGenerarReportes(), cargarArqueosCaja());
  }

  const clienteId = clientePerfilActual?.cliente?.id;
  if (clienteId) {
    tareas.push((async () => {
      const data = await apiFetch(`/api/clientes/${clienteId}`);
      if (String(clientePerfilActual?.cliente?.id || "") === String(clienteId)) renderClientePerfil(data);
    })());
  }

  const placa = getVehiculoPerfilPlaca();
  if (placa) {
    tareas.push((async () => {
      const data = await apiFetch(`/api/vehiculos/perfil/${encodeURIComponent(placa)}`);
      if (getVehiculoPerfilPlaca() === placa) renderVehiculo360(data);
    })());
  }

  const resultados = await Promise.allSettled(tareas);
  resultados
    .filter((r) => r.status === "rejected")
    .forEach((r) => console.error("Error refrescando contexto después del cobro:", r.reason));
}

async function abrirModalCobroServicio(modulo, id) {
  limpiarModalCobroServicio();

  if (modulo === "lavadero") {
    const orden = await apiFetch(`/api/lavadero/${id}`);
    const fin = new Date();
    const total = Number(orden.precio || 0);

    cobroServicioActual = {
      modulo, id,
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
      valor: total, pagado: 0, saldo: total, montoSugerido: total,
      allowPartial: total > 0, requireAmount: total > 0,
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
      modulo, id,
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
      valor: total, pagado: 0, saldo: total, montoSugerido: total,
      allowPartial: total > 0, requireAmount: total > 0,
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
  const servicio = await apiFetch(`/api/pagos/servicio/${encodeURIComponent(moduloNormalizado)}/${encodeURIComponent(id)}`);

  cobroServicioActual = {
    modulo: moduloNormalizado, id,
    method: "POST",
    successMessageId: messageId,
    reload: async () => refrescarContextoDespuesDeCobro(),
    successMessageResolver: (data) => data?.mensaje || "Pago registrado correctamente.",
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
  const detallePago = buildCobroDetallePayload({ referencia, detalle, observaciones });

  const requiereMonto = cobroServicioActual.buildBody && cobroServicioActual.requireAmount !== false;
  if (requiereMonto && (!Number.isFinite(montoPago) || montoPago <= 0)) {
    alert("Debe ingresar un monto válido para registrar el pago.");
    return;
  }

  try {
    const body = cobroServicioActual.buildBody
      ? cobroServicioActual.buildBody({ metodoPago, referencia, detalle, observaciones, detallePago, montoPago })
      : { estado: cobroServicioActual.estadoFinal, metodo_pago: metodoPago, detalle_pago: detallePago };

    const response = await apiFetch(cobroServicioActual.endpoint, {
      method: cobroServicioActual.method || "PATCH",
      body: JSON.stringify(body),
    });

    const successMessage = typeof cobroServicioActual.successMessageResolver === "function"
      ? cobroServicioActual.successMessageResolver(response)
      : cobroServicioActual.successMessage;
    const { successMessageId, reload } = cobroServicioActual;

    cerrarModalCobroServicio();
    if (typeof reload === "function") {
      try { await reload(); } catch (err) { console.error("Error refrescando vistas:", err); }
    }
    showCobroServicioMessage(successMessageId, successMessage);
  } catch (err) {
    showCobroServicioMessage(cobroServicioActual.successMessageId, err.message, true);
  }
}

function renderSidebarMenu(items = []) {
  const nav = document.getElementById("sidebar-nav") || document.querySelector(".sidebar-nav");
  if (!nav) return;

  nav.innerHTML = items.map((item) => {
    const classes = ["nav-link"];
    if (item.active) classes.push("active");
    if (!item.allowed) classes.push("module-locked");
    if (item.allowed) classes.push("module-included");

    const icon = item.icon ? `<span class="nav-link-icon" aria-hidden="true">${item.icon}</span>` : "";
    const tooltip = item.allowed ? "" : getModuleBlockedMessage(item.licenseModule);

    return `
      <button
        type="button"
        class="${classes.join(" ")}"
        data-view="${escapeHtml(item.id)}"
        ${item.licenseModule ? `data-license-module="${escapeHtml(item.licenseModule)}"` : ""}
        aria-disabled="${String(!item.allowed)}"
        title="${escapeHtml(tooltip)}"
      >
        ${icon}
        <span>${escapeHtml(item.label)}</span>
      </button>
    `;
  }).join("");
}

let globalUiEventsBound = false;

function bindGlobalUiEvents() {
  if (globalUiEventsBound) return;
  globalUiEventsBound = true;

  document.getElementById("cobro-metodo-pago")?.addEventListener("change", () => {
    actualizarCamposPagoServicio("cobro-metodo-pago", "cobro-referencia-group", "cobro-detalle-pago-group");
  });
  document.getElementById("btn-confirmar-cobro-servicio")?.addEventListener("click", confirmarCobroServicio);
  document.getElementById("btn-cobro-servicio-close")?.addEventListener("click", cerrarModalCobroServicio);
  document.getElementById("btn-cobro-servicio-cancel")?.addEventListener("click", cerrarModalCobroServicio);
}
