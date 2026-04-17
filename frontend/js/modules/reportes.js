/* =========================================================
   REPORTES — resumen, caja, arqueos, CSV
   Depende de: ui.js, api.js
   ========================================================= */

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
  if (label) label.textContent = `${formatDisplayDate(desde)} - ${formatDisplayDate(hasta)}`;
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
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
}

// ── Render caja ───────────────────────────────────────────

function renderCashProgressList(items, { containerId, emptyId, countId, valueKey = "total", labelKey, total = 0 }) {
  const container = document.getElementById(containerId);
  const empty = document.getElementById(emptyId);
  if (!container || !empty) return;

  const safeItems = Array.isArray(items) ? items : [];
  if (countId) setElementText(countId, `${safeItems.length} ${safeItems.length === 1 ? "registro" : "registros"}`);

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
          <button type="button" class="btn btn-sm btn-primary"
            onclick="abrirPagoPendiente('${escapeHtml(item.modulo || "")}','${escapeHtml(item.referencia_id || "")}')">
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
    if (serviciosPendientes > 0) { status.textContent = "Con pendientes"; status.className = "badge badge-warning"; }
    else if (serviciosTotal > 0) { status.textContent = "Cuadre al día"; status.className = "badge badge-success"; }
    else { status.textContent = "Sin movimientos"; status.className = "badge badge-muted"; }
  }

  setElementText("rep-caja-updated", caja.generado_en ? `Actualizado ${formatDateTime(caja.generado_en)}` : "Sin actualizar");
  setElementText("rep-caja-efectivo-sistema", formatMoney(getCajaEfectivoSistema(caja)));
  actualizarDiferenciaArqueo();

  renderCashProgressList(caja.metodos_pago, {
    containerId: "rep-caja-metodos-list", emptyId: "rep-caja-metodos-empty",
    countId: "rep-caja-metodos-count", labelKey: "metodo_pago", valueKey: "total", total: totalRecaudado,
  });
  renderCashProgressList(caja.responsables, {
    containerId: "rep-caja-responsables-list", emptyId: "rep-caja-responsables-empty",
    countId: "rep-caja-responsables-count", labelKey: "responsable_nombre", valueKey: "recaudado", total: totalRecaudado,
  });

  renderCajaPendientes(caja.pendientes || []);
  renderCajaMovimientos(caja.movimientos || []);
}

function getCajaEfectivoSistema(caja = reportesActuales?.caja) {
  const metodos = Array.isArray(caja?.metodos_pago) ? caja.metodos_pago : [];
  return Number(metodos.find((m) => String(m.metodo_pago || "").toUpperCase() === "EFECTIVO")?.total || 0);
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
    if (data.arqueo?.id) await abrirReciboArqueo(data.arqueo.id, "rep-caja-arqueo-msg");
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

// ── Resumen y tablas ──────────────────────────────────────

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
    tbodyDiario.innerHTML = dias.map((dia) => `
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
    tbodyClientes.innerHTML = clientesLista.map((cli) => `
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
    tbodyEmpleados.innerHTML = empleadosLista.map((emp) => {
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

  if (!desde || !hasta) { alert("Seleccione rango de fechas."); return; }

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

// ── CSV export ────────────────────────────────────────────

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildReportesCSV() {
  if (!reportesActuales) return "";
  const rows = [
    ["Reporte", `${reportesActuales.desde} a ${reportesActuales.hasta}`], [],
    ["Resumen"], ["Módulo", "Servicios", "Ingresos"],
    ["Parqueadero", reportesActuales.resumen.parqueadero?.cantidad || 0, reportesActuales.resumen.parqueadero?.total || 0],
    ["Lavadero", reportesActuales.resumen.lavadero?.cantidad || 0, reportesActuales.resumen.lavadero?.total || 0],
    ["Taller", reportesActuales.resumen.taller?.cantidad || 0, reportesActuales.resumen.taller?.total || 0],
    ["Total", reportesActuales.resumen.cantidad_total || 0, reportesActuales.resumen.total_general || 0], [],
    ["Cierre de caja"], ["Concepto", "Servicios", "Valor"],
    ["Facturado", reportesActuales.caja?.resumen?.servicios_total || 0, reportesActuales.caja?.resumen?.total_facturado || 0],
    ["Recaudado", reportesActuales.caja?.resumen?.servicios_pagados || 0, reportesActuales.caja?.resumen?.total_recaudado || 0],
    ["Pendiente", reportesActuales.caja?.resumen?.servicios_pendientes || 0, reportesActuales.caja?.resumen?.total_pendiente || 0], [],
    ["Métodos de pago"], ["Método", "Servicios", "Total"],
    ...(reportesActuales.caja?.metodos_pago || []).map((m) => [formatCashMethod(m.metodo_pago), m.cantidad || 0, m.total || 0]), [],
    ["Pendientes por cobrar"], ["Fecha", "Módulo", "Placa", "Cliente", "Monto"],
    ...(reportesActuales.caja?.pendientes || []).map((item) => [
      item.fecha || "", formatModuleLabel(item.modulo), item.placa || "",
      item.cliente_nombre || item.responsable_nombre || "", item.monto || 0,
    ]), [],
    ["Arqueo actual"], ["Efectivo sistema", "Efectivo contado", "Diferencia"],
    [
      getCajaEfectivoSistema(reportesActuales.caja),
      document.getElementById("rep-caja-efectivo-contado")?.value || 0,
      Number(document.getElementById("rep-caja-efectivo-contado")?.value || 0) - getCajaEfectivoSistema(reportesActuales.caja),
    ], [],
    ["Ingresos por día"], ["Fecha", "Parqueadero", "Lavadero", "Taller", "Total"],
    ...(reportesActuales.diario.dias || []).map((dia) => [
      dia.fecha, dia.parqueadero?.total || 0, dia.lavadero?.total || 0, dia.taller?.total || 0, dia.total_general || 0,
    ]), [],
    ["Clientes más activos"], ["Cliente", "Servicios", "Total gastado"],
    ...(reportesActuales.clientes.clientes || []).map((c) => [c.nombre, c.total_servicios || 0, c.total_gastado || 0]), [],
    ["Equipo productivo"], ["Empleado", "Rol", "Servicios", "Ingresos"],
    ...(reportesActuales.empleados.empleados || []).map((e) => [
      e.nombre, e.rol,
      Number(e.lavados_realizados || 0) + Number(e.ordenes_taller || 0),
      e.total_general || 0,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function exportReportesCSV() {
  if (!reportesActuales) { alert("Genera un reporte antes de exportar."); return; }
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
