/* =========================================================
   DASHBOARD — KPIs, gráfica, alertas inteligentes
   Depende de: ui.js, api.js
   ========================================================= */

function getDashboardDate() {
  const input = document.getElementById("dash-fecha");
  const todayParam = formatDateParam(new Date());
  if (!input) return new Date();
  if (!input.value) input.value = todayParam;
  return parseDateParam(input.value);
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

  const maxTotal = Math.max(...dias.map((dia) => Number(dia.total_general || 0)), 0);

  chart.innerHTML = "";
  line.setAttribute("points", "");
  area.setAttribute("d", "");
  pointsGroup.innerHTML = "";

  if (!dias.length || maxTotal <= 0) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  const width = 640, height = 220, paddingX = 24, paddingY = 24;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;

  const points = dias.map((dia, index) => {
    const x = dias.length === 1 ? width / 2 : paddingX + (index / (dias.length - 1)) * usableWidth;
    const y = height - paddingY - (Number(dia.total_general || 0) / maxTotal) * usableHeight;
    return { x, y, dia, total: Number(dia.total_general || 0) };
  });

  line.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
  area.setAttribute(
    "d",
    `M ${points[0].x} ${height - paddingY} L ${points.map((p) => `${p.x} ${p.y}`).join(" L ")} L ${points[points.length - 1].x} ${height - paddingY} Z`
  );
  pointsGroup.innerHTML = points.map((p) => `<circle class="trend-point" cx="${p.x}" cy="${p.y}" r="4"></circle>`).join("");

  chart.innerHTML = dias.map((dia) => {
    const total = Number(dia.total_general || 0);
    const barWidth = total > 0 ? Math.max((total / maxTotal) * 100, 4) : 0;
    return `
      <div class="chart-row">
        <span class="chart-date">${dia.fecha}</span>
        <div class="chart-bar-wrapper">
          <div class="chart-bar" data-width="${barWidth}"></div>
        </div>
        <span class="chart-value">${formatMoney(total)}</span>
      </div>
    `;
  }).join("");

  chart.querySelectorAll(".chart-bar").forEach((bar) => {
    bar.style.width = `${bar.dataset.width}%`;
  });
}

// ── Alertas inteligentes ──────────────────────────────────

function getAlertSeverityClass(severidad) {
  const n = String(severidad || "INFO").toUpperCase();
  if (n === "CRITICA") return "badge-danger";
  if (n === "ADVERTENCIA") return "badge-warning";
  return "badge-info";
}

function getAlertSeverityLabel(severidad) {
  const n = String(severidad || "INFO").toUpperCase();
  if (n === "CRITICA") return "Crítica";
  if (n === "ADVERTENCIA") return "Atención";
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
  return parts.length ? parts.map((p) => `<span>${p}</span>`).join("") : "<span>Sin detalle adicional</span>";
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
  list.innerHTML = topAlerts.map((alerta) => {
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
        <button type="button" class="btn btn-sm btn-secondary smart-alert-action" data-alert-action
          data-alert-module="${escapeHtml(alerta.modulo || "dashboard")}"
          data-alert-reference-type="${escapeHtml(alerta.referencia_tipo || "")}"
        >${escapeHtml(alerta.accion || "Revisar")}</button>
      </article>
    `;
  }).join("");

  empty.hidden = topAlerts.length > 0;
  if (updated) {
    updated.textContent = data.generado_en ? `Actualizado ${formatDateTime(data.generado_en)}` : "Sin actualizar";
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
    if (empty) { empty.hidden = false; empty.textContent = "No se pudieron cargar las alertas."; }
  }
}

function abrirAccionAlerta(modulo, referenciaTipo) {
  const viewMap = {
    dashboard: "dashboard", config: "config", configuracion: "config",
    clientes: "clientes", parqueadero: "parqueadero", lavadero: "lavadero",
    taller: "taller", empresas: "empresas", usuarios: "usuarios",
    empleados: "empleados", reportes: "reportes",
  };
  const targetView = viewMap[modulo] || "dashboard";
  const changed = changeView(targetView);
  if (!changed) return;
  if (targetView === "config" && ["licencia", "empresa"].includes(referenciaTipo)) setConfigTab("licencias");
  if (targetView === "parqueadero" && referenciaTipo === "mensualidad") seleccionarFlujoParqueadero("alta");
}

async function loadDashboard() {
  const selectedDate = getDashboardDate();
  const selectedParam = formatDateParam(selectedDate);
  const todayParam = formatDateParam(new Date());

  setElementText("dash-date-eyebrow", selectedParam === todayParam ? "Hoy" : "Consulta");
  setElementText("dash-current-date", selectedDate.toLocaleDateString("es-CO", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
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
    const diario = await apiFetch(`/api/reportes/diario?desde=${formatDateParam(desde)}&hasta=${formatDateParam(hasta)}`);
    renderDashboardChart(diario.dias || []);
  } catch (err) {
    console.error("Error cargando gráfica dashboard:", err);
    renderDashboardChart([]);
  }

  await cargarAlertasInteligentes();
}

let dashboardEventsBound = false;

function bindDashboardEvents() {
  if (dashboardEventsBound) return;
  dashboardEventsBound = true;

  document.getElementById("dash-fecha")?.addEventListener("change", loadDashboard);
  document.getElementById("btn-refresh-alertas")?.addEventListener("click", cargarAlertasInteligentes);
  document.getElementById("dash-alertas-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-alert-action]");
    if (!button) return;
    abrirAccionAlerta(button.dataset.alertModule, button.dataset.alertReferenceType);
  });
  document.getElementById("btn-dash-hoy")?.addEventListener("click", () => {
    const input = document.getElementById("dash-fecha");
    if (input) input.value = formatDateParam(new Date());
    loadDashboard();
  });
}

window.AG360.registerModule({
  id: "dashboard",
  title: "Dashboard",
  licenseModule: "dashboard",
  icon: "🧭",
  order: 10,
  bindEvents: bindDashboardEvents,
  onEnter: loadDashboard,
});
