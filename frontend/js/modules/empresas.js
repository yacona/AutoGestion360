/* =========================================================
   EMPRESAS — gestión multi-empresa (solo superadmin)
   Depende de: ui.js, api.js, auth.js
   ========================================================= */

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
  const activas = empresas.filter((e) => e.activa).length;
  const usuarios = empresas.reduce((sum, e) => sum + Number(e.usuarios_total || 0), 0);
  setElementText("empresas-total", total);
  setElementText("empresas-activas", activas);
  setElementText("empresas-usuarios", usuarios);
}

function getLicenciaById(id) {
  return licenciasCatalogoData.find((l) => Number(l.id) === Number(id));
}

function getLicenciaForEmpresa(empresa = {}) {
  if (empresa.licencia_id) return getLicenciaById(empresa.licencia_id);
  const tipo = normalizeRole(empresa.licencia_nombre || empresa.licencia_tipo);
  return licenciasCatalogoData.find((l) => normalizeRole(l.nombre) === tipo);
}

function getSuscripcionForEmpresa(empresa = {}) {
  return suscripcionesAdminData.find((s) => Number(s.empresa_id) === Number(empresa.id));
}

function renderSaasSummary(resumen = null) {
  const data = resumen || { mrr: 0, arr: 0, trial: 0, vencidas: 0 };
  setElementText("saas-total-mrr", formatMoney(Number(data.mrr || 0)));
  setElementText("saas-total-arr", formatMoney(Number(data.arr || 0)));
  setElementText("saas-total-trial", Number(data.trial || 0));
  setElementText("saas-total-vencidas", Number(data.vencidas || 0));
}

function populateLicenciaPlanSelect() {
  const select = document.getElementById("licencia-plan-id");
  if (!select) return;
  select.innerHTML = licenciasCatalogoData.map((l) =>
    `<option value="${l.id}">${l.nombre} - ${formatMoney(l.precio || 0)}</option>`
  ).join("");
}

function populateLicenciaEmpresaSelect() {
  const select = document.getElementById("licencia-empresa-id");
  if (!select) return;
  select.innerHTML = empresasAdminData.map((e) =>
    `<option value="${e.id}">${e.nombre}</option>`
  ).join("");
}

function populateSuscripcionEmpresaSelect() {
  const select = document.getElementById("suscripcion-empresa-id");
  if (!select) return;
  select.innerHTML = empresasAdminData.map((e) =>
    `<option value="${e.id}">${e.nombre}</option>`
  ).join("");
}

function populateSuscripcionPlanSelect() {
  const select = document.getElementById("suscripcion-plan-id");
  if (!select) return;
  select.innerHTML = licenciasCatalogoData.map((l) =>
    `<option value="${l.id}">${l.nombre} - ${formatMoney(l.precio || 0)}</option>`
  ).join("");
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
  panel.innerHTML = modulos.map((m) => `<span class="badge badge-teal">${m.nombre}</span>`).join("");
}

function renderFacturasSaasTable() {
  const tbody = document.getElementById("facturas-saas-tbody");
  const empty = document.getElementById("facturas-saas-empty");
  if (!tbody || !empty) return;
  tbody.innerHTML = "";
  if (!facturasSaasData.length) { empty.hidden = false; return; }
  empty.hidden = true;
  tbody.innerHTML = facturasSaasData.map((f) => `
    <tr>
      <td>
        <strong>${f.numero_factura || "-"}</strong>
        <span class="table-subtext">${formatDisplayDate(f.fecha_emision)}</span>
      </td>
      <td>${f.concepto || "-"}</td>
      <td>${formatDisplayDate(f.periodo_inicio)} - ${formatDisplayDate(f.periodo_fin)}</td>
      <td>${formatMoney(Number(f.total || 0))}</td>
      <td>${renderBadge(f.estado || "PENDIENTE")}</td>
      <td>${f.metodo_pago || f.referencia_pago || "-"}</td>
    </tr>
  `).join("");
}

async function cargarFacturasSaas(empresaId) {
  const id = Number(empresaId || 0);
  facturasSaasData = [];
  renderFacturasSaasTable();
  if (!id) return;
  try {
    facturasSaasData = await apiFetch(`/api/suscripciones/${id}/facturas`);
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

  if (empresaId) selectEmpresa.value = String(empresaId);

  const empresa = empresasAdminData.find((e) => Number(e.id) === Number(selectEmpresa.value));
  const suscripcion = getSuscripcionForEmpresa(empresa || {});
  const licencia = suscripcion?.licencia_id
    ? getLicenciaById(suscripcion.licencia_id)
    : getLicenciaForEmpresa(empresa || {});

  if (licencia) selectPlan.value = String(licencia.id);

  document.getElementById("suscripcion-estado").value = suscripcion?.estado_real || (licencia?.nombre === "Demo" ? "TRIAL" : "ACTIVA");
  document.getElementById("suscripcion-pasarela").value = suscripcion?.pasarela || "MANUAL";
  document.getElementById("suscripcion-fecha-inicio").value = formatDateForInput(suscripcion?.fecha_inicio || empresa?.licencia_asignacion_inicio || empresa?.licencia_inicio || new Date());
  document.getElementById("suscripcion-fecha-fin").value = formatDateForInput(suscripcion?.fecha_fin || empresa?.licencia_asignacion_fin || empresa?.licencia_fin);
  document.getElementById("suscripcion-precio-plan").value = String(Math.round(Number(suscripcion?.precio_plan ?? licencia?.precio ?? 0)));
  document.getElementById("suscripcion-referencia-externa").value = suscripcion?.referencia_externa || "";
  document.getElementById("suscripcion-renovacion-automatica").checked = Boolean(suscripcion?.renovacion_automatica);
  document.getElementById("suscripcion-observaciones").value = suscripcion?.observaciones || "";

  setElementText("suscripcion-estado-actual", empresa
    ? `${empresa.nombre} · ${suscripcion?.estado_real || "SIN SUSCRIPCION"}`
    : "Sin suscripción"
  );
  setElementText("facturas-saas-empresa-actual", empresa
    ? `${empresa.nombre}${suscripcion?.licencia_nombre ? ` · ${suscripcion.licencia_nombre}` : ""}`
    : "Sin empresa"
  );

  document.getElementById("factura-saas-total").value = String(Math.round(Number(suscripcion?.precio_plan ?? licencia?.precio ?? 0)));
  document.getElementById("factura-saas-periodo-inicio").value = formatDateForInput(suscripcion?.fecha_inicio || new Date());
  document.getElementById("factura-saas-periodo-fin").value = formatDateForInput(suscripcion?.fecha_fin);

  await cargarFacturasSaas(empresa?.id);
}

function syncLicenciaEmpresaForm(empresaId = null) {
  const selectEmpresa = document.getElementById("licencia-empresa-id");
  const selectPlan = document.getElementById("licencia-plan-id");
  if (!selectEmpresa || !selectPlan) return;

  if (empresaId) selectEmpresa.value = String(empresaId);

  const empresa = empresasAdminData.find((e) => Number(e.id) === Number(selectEmpresa.value));
  const licencia = getLicenciaForEmpresa(empresa);
  if (licencia) selectPlan.value = String(licencia.id);

  document.getElementById("licencia-fecha-inicio").value = formatDateForInput(empresa?.licencia_asignacion_inicio || empresa?.licencia_inicio || new Date());
  document.getElementById("licencia-fecha-fin").value = formatDateForInput(empresa?.licencia_asignacion_fin || empresa?.licencia_fin);

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
    ? empresasAdminData.filter((e) =>
        `${e.nombre || ""} ${e.nit || ""} ${e.ciudad || ""} ${e.email_contacto || ""}`.toLowerCase().includes(search)
      )
    : empresasAdminData;

  tbody.innerHTML = "";
  if (empresas.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  tbody.innerHTML = empresas.map((empresa) => {
    const licencia = getLicenciaForEmpresa(empresa);
    const suscripcion = getSuscripcionForEmpresa(empresa);
    const licenciaNombre = licencia?.nombre || empresa.licencia_nombre || empresa.licencia_tipo || "demo";
    const licenciaFinRaw = empresa.licencia_asignacion_fin || empresa.licencia_fin;
    const licenciaFin = licenciaFinRaw ? new Date(licenciaFinRaw).toLocaleDateString() : "Sin vencimiento";
    const suscripcionEstado = suscripcion?.estado_real || "SIN SUSCRIPCION";
    const suscripcionFin = suscripcion?.fecha_fin ? new Date(suscripcion.fecha_fin).toLocaleDateString() : "Sin fecha";
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
  const empresa = empresasAdminData.find((e) => Number(e.id) === Number(id));
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
    (o) => normalizeRole(o.value) === normalizeRole(empresa.licencia_tipo || empresa.licencia_nombre)
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
  if (!confirm(`¿Deseas ${activa ? "activar" : "desactivar"} esta empresa?`)) return;
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
  if (!empresaId) { showMessage("suscripcion-saas-msg", "Selecciona una empresa para renovar.", true); return; }

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
  if (!empresaId) { showMessage("suscripcion-saas-msg", "Selecciona una empresa.", true); return; }

  const mensaje = estado === "SUSPENDIDA" ? "¿Deseas suspender esta suscripción?" : "¿Deseas cancelar esta suscripción?";
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
  if (!empresaId) { showMessage("factura-saas-msg", "Selecciona una empresa.", true); return; }

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
