/* =========================================================
   EMPRESAS — panel SuperAdmin
   Usa:
     /api/admin/*          → sistema nuevo (planes, suscripciones, módulos)
     /api/empresas/*       → CRUD existente (compatibilidad)
   Depende de: ui.js, api.js, auth.js
   ========================================================= */

// ─── Estado del módulo ────────────────────────────────────────
let empresasAdminData     = [];
let planesAdminData       = [];   // ← nuevo: catálogo de planes (tabla planes)
let modulosEmpresaActual  = [];   // ← nuevo: módulos de la empresa seleccionada
let proximasAVencerData   = [];   // ← nuevo: suscripciones por vencer
let empresaModuloTarget   = null; // empresa_id actualmente en panel de módulos

// Datos legacy (para retrocompat con formularios viejos)
let licenciasCatalogoData = [];
let suscripcionesAdminData = [];
let saasResumenData = null;
let facturasSaasData = [];

// ─── Helpers ─────────────────────────────────────────────────

function fmtDate(v)  { return v ? new Date(v).toLocaleDateString('es-CO') : '—'; }
function fmtMoney(v) { return typeof formatMoney === 'function' ? formatMoney(v) : `$${Number(v || 0).toLocaleString('es-CO')}`; }
function fmtInput(v) { return v ? String(v).split('T')[0] : ''; }

function planBadge(codigo) {
  const colors = { starter: 'badge-blue', pro: 'badge-teal', enterprise: 'badge-purple' };
  return `<span class="badge ${colors[codigo] || 'badge-muted'}">${codigo || '—'}</span>`;
}

function estadoBadge(estado) {
  if (typeof renderBadge === 'function') return renderBadge(estado);
  const map = { ACTIVA: 'badge-green', TRIAL: 'badge-blue', VENCIDA: 'badge-red',
                SUSPENDIDA: 'badge-orange', CANCELADA: 'badge-muted' };
  return `<span class="badge ${map[estado] || 'badge-muted'}">${estado || '—'}</span>`;
}

function moduloEstadoBadge(estado) {
  const map = {
    incluido:    ['badge-teal',   'En plan'],
    addon:       ['badge-blue',   'Add-on'],
    desactivado: ['badge-red',    'Desactivado'],
    no_incluido: ['badge-muted',  'No incluido'],
  };
  const [cls, label] = map[estado] || ['badge-muted', estado];
  return `<span class="badge ${cls}">${label}</span>`;
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

function populateLicenciaPlanSelect() {
  const select = document.getElementById("licencia-plan-id");
  if (!select) return;
  select.innerHTML = licenciasCatalogoData.map((licencia) =>
    `<option value="${licencia.id}">${licencia.nombre} - ${fmtMoney(licencia.precio || 0)}</option>`
  ).join("");
}

function populateLicenciaEmpresaSelect() {
  const select = document.getElementById("licencia-empresa-id");
  if (!select) return;
  select.innerHTML = empresasAdminData.map((empresa) =>
    `<option value="${empresa.id}">${empresa.nombre}</option>`
  ).join("");
}

function populateSuscripcionEmpresaSelect() {
  const select = document.getElementById("suscripcion-empresa-id");
  if (!select) return;
  select.innerHTML = empresasAdminData.map((empresa) =>
    `<option value="${empresa.id}">${empresa.nombre}</option>`
  ).join("");
}

function populateSuscripcionPlanSelect() {
  const select = document.getElementById("suscripcion-plan-id");
  if (!select) return;
  select.innerHTML = licenciasCatalogoData.map((licencia) =>
    `<option value="${licencia.id}">${licencia.nombre} - ${fmtMoney(licencia.precio || 0)}</option>`
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

  panel.innerHTML = modulos.map((modulo) => `<span class="badge badge-teal">${modulo.nombre}</span>`).join("");
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
    if (typeof showMessage === "function") showMessage("factura-saas-msg", error.message, true);
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
  document.getElementById("suscripcion-fecha-inicio").value = fmtInput(
    suscripcion?.fecha_inicio || empresa?.licencia_asignacion_inicio || empresa?.licencia_inicio || new Date()
  );
  document.getElementById("suscripcion-fecha-fin").value = fmtInput(
    suscripcion?.fecha_fin || empresa?.licencia_asignacion_fin || empresa?.licencia_fin
  );
  document.getElementById("suscripcion-precio-plan").value = String(
    Math.round(Number(suscripcion?.precio_plan ?? licencia?.precio ?? 0))
  );
  document.getElementById("suscripcion-referencia-externa").value = suscripcion?.referencia_externa || "";
  document.getElementById("suscripcion-renovacion-automatica").checked = Boolean(suscripcion?.renovacion_automatica);
  document.getElementById("suscripcion-observaciones").value = suscripcion?.observaciones || "";

  setElementText("suscripcion-estado-actual", empresa ? `${empresa.nombre} · ${suscripcion?.estado_real || "SIN SUSCRIPCION"}` : "Sin suscripción");
  setElementText("facturas-saas-empresa-actual", empresa ? `${empresa.nombre}${suscripcion?.licencia_nombre ? ` · ${suscripcion.licencia_nombre}` : ""}` : "Sin empresa");

  document.getElementById("factura-saas-total").value = String(
    Math.round(Number(suscripcion?.precio_plan ?? licencia?.precio ?? 0))
  );
  document.getElementById("factura-saas-periodo-inicio").value = fmtInput(suscripcion?.fecha_inicio || new Date());
  document.getElementById("factura-saas-periodo-fin").value = fmtInput(suscripcion?.fecha_fin);

  await cargarFacturasSaas(empresa?.id);
}

function syncLicenciaEmpresaForm(empresaId = null) {
  const selectEmpresa = document.getElementById("licencia-empresa-id");
  const selectPlan = document.getElementById("licencia-plan-id");
  if (!selectEmpresa || !selectPlan) return;

  if (empresaId) selectEmpresa.value = String(empresaId);

  const empresa = empresasAdminData.find((item) => Number(item.id) === Number(selectEmpresa.value));
  const licencia = getLicenciaForEmpresa(empresa || {});
  if (licencia) selectPlan.value = String(licencia.id);

  document.getElementById("licencia-fecha-inicio").value = fmtInput(
    empresa?.licencia_asignacion_inicio || empresa?.licencia_inicio || new Date()
  );
  document.getElementById("licencia-fecha-fin").value = fmtInput(
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

// ─── KPIs ─────────────────────────────────────────────────────

function renderEmpresasSummary(empresas = []) {
  const total   = empresas.length;
  const activas = empresas.filter(e => e.activa).length;
  const usuarios = empresas.reduce((s, e) => s + Number(e.usuarios_total || 0), 0);
  if (typeof setElementText === 'function') {
    setElementText('empresas-total',   total);
    setElementText('empresas-activas', activas);
    setElementText('empresas-usuarios',usuarios);
  }
}

function renderSaasSummary(resumen = null) {
  const d = resumen || { mrr: 0, arr: 0, trial: 0, vencidas: 0 };
  if (typeof setElementText !== 'function') return;
  setElementText('saas-total-mrr',     fmtMoney(Number(d.mrr     || 0)));
  setElementText('saas-total-arr',     fmtMoney(Number(d.arr     || 0)));
  setElementText('saas-total-trial',   Number(d.trial    || 0));
  setElementText('saas-total-vencidas',Number(d.vencidas || 0));
}

// ─── TABLA DE EMPRESAS ────────────────────────────────────────

function renderEmpresasTable() {
  const tbody = document.getElementById('empresas-tbody');
  const empty = document.getElementById('empresas-empty');
  if (!tbody || !empty) return;

  const search = (document.getElementById('empresas-buscar')?.value || '').trim().toLowerCase();
  const lista  = search
    ? empresasAdminData.filter(e =>
        `${e.nombre} ${e.nit || ''} ${e.ciudad || ''} ${e.email_contacto || ''}`.toLowerCase().includes(search))
    : empresasAdminData;

  tbody.innerHTML = '';
  empty.hidden = lista.length > 0;
  if (!lista.length) return;

  tbody.innerHTML = lista.map(e => {
    const btnToggle  = e.activa
      ? `<button type="button" class="btn btn-sm btn-danger" data-empresa-action="toggle" data-empresa-id="${e.id}" data-empresa-activa="false">Suspender</button>`
      : `<button type="button" class="btn btn-sm btn-success" data-empresa-action="toggle" data-empresa-id="${e.id}" data-empresa-activa="true">Activar</button>`;
    return `
      <tr>
        <td>
          <strong>${e.nombre}</strong>
          <span class="table-subtext">${e.email_contacto || '—'}</span>
        </td>
        <td>${e.nit || '—'}</td>
        <td>${e.ciudad || '—'}</td>
        <td>
          ${planBadge(e.plan_codigo)}
          <span class="table-subtext">${estadoBadge(e.suscripcion_estado || 'SIN_PLAN')}</span>
        </td>
        <td>${fmtDate(e.suscripcion_fin || e.trial_hasta)}</td>
        <td>${e.usuarios_total || 0}</td>
        <td>${e.clientes_total || 0}</td>
        <td>${estadoBadge(e.activa ? 'Activa' : 'Inactiva')}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn btn-sm btn-secondary" data-empresa-action="editar" data-empresa-id="${e.id}">Editar</button>
            <button type="button" class="btn btn-sm btn-secondary" data-empresa-action="plan" data-empresa-id="${e.id}">Plan</button>
            <button type="button" class="btn btn-sm btn-secondary" data-empresa-action="modulos" data-empresa-id="${e.id}">Módulos</button>
            ${btnToggle}
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ─── TABLA PRÓXIMAS A VENCER ──────────────────────────────────

function renderProximasAVencer() {
  const tbody = document.getElementById('proximas-vencer-tbody');
  const empty = document.getElementById('proximas-vencer-empty');
  if (!tbody || !empty) return;

  tbody.innerHTML = '';
  empty.hidden = proximasAVencerData.length > 0;
  if (!proximasAVencerData.length) return;

  tbody.innerHTML = proximasAVencerData.map(s => {
    const dias = Math.ceil(Number(s.dias_restantes || 0));
    const urgencia = dias <= 3 ? 'badge-red' : dias <= 7 ? 'badge-orange' : 'badge-yellow';
    return `
      <tr>
        <td>
          <strong>${s.empresa_nombre}</strong>
          <span class="table-subtext">${s.email_contacto || '—'}</span>
        </td>
        <td>${planBadge(s.plan_codigo)}</td>
        <td>${estadoBadge(s.estado)}</td>
        <td>${fmtDate(s.trial_hasta || s.fecha_fin)}</td>
        <td><span class="badge ${urgencia}">${dias} día${dias !== 1 ? 's' : ''}</span></td>
        <td>
          <button type="button" class="btn btn-sm btn-primary" data-empresa-action="plan" data-empresa-id="${s.empresa_id}">Renovar</button>
        </td>
      </tr>`;
  }).join('');
}

// ─── PANEL DE MÓDULOS (SOBREESCRITURAS) ───────────────────────

async function abrirPanelModulos(empresaId) {
  empresaModuloTarget = empresaId;
  const empresa = empresasAdminData.find(e => Number(e.id) === Number(empresaId));

  const titulo = document.getElementById('modulos-panel-titulo');
  if (titulo) titulo.textContent = `Módulos — ${empresa?.nombre || `Empresa ${empresaId}`}`;

  const panel = document.getElementById('panel-empresa-modulos');
  if (panel) {
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  await recargarModulosEmpresa(empresaId);
}

async function recargarModulosEmpresa(empresaId) {
  const tbody = document.getElementById('modulos-empresa-tbody');
  const empty = document.getElementById('modulos-empresa-empty');
  if (!tbody) return;

  try {
    modulosEmpresaActual = await apiFetch(`/api/admin/empresa-modulos/${empresaId}`);
    renderModulosEmpresa();
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('modulos-empresa-msg', err.message, true);
  }
}

function renderModulosEmpresa() {
  const tbody = document.getElementById('modulos-empresa-tbody');
  const empty = document.getElementById('modulos-empresa-empty');
  if (!tbody || !empty) return;

  tbody.innerHTML = '';
  empty.hidden = modulosEmpresaActual.length > 0;
  if (!modulosEmpresaActual.length) return;

  tbody.innerHTML = modulosEmpresaActual.map(m => {
    const enPlan     = m.en_plan;
    const override   = m.tiene_override;
    const activo     = m.override_activo;
    const estado     = m.estado_efectivo;

    // Toggle: si está en plan → ofrecer desactivar; si no está → ofrecer add-on
    let accion = '';
    if (enPlan && (!override || activo)) {
      accion = `<button type="button" class="btn btn-sm btn-warning"
                  data-modulos-action="override"
                  data-modulo-id="${m.id}"
                  data-modulo-activo="false"
                  title="Desactivar para esta empresa aunque esté en el plan">
                  Desactivar
                </button>`;
    } else if (!enPlan && (!override || !activo)) {
      accion = `<button type="button" class="btn btn-sm btn-primary"
                  data-modulos-action="override"
                  data-modulo-id="${m.id}"
                  data-modulo-activo="true"
                  title="Añadir como add-on fuera del plan">
                  Add-on
                </button>`;
    } else {
      accion = `<button type="button" class="btn btn-sm btn-secondary"
                  data-modulos-action="reset"
                  data-modulo-id="${m.id}"
                  title="Volver al comportamiento del plan">
                  Restablecer
                </button>`;
    }

    const limiteLabel = m.limite_override !== null
      ? `<span class="table-subtext">Límite: ${m.limite_override === 0 ? '∞' : m.limite_override}</span>`
      : (m.limite_plan !== null ? `<span class="table-subtext">Límite plan: ${m.limite_plan}</span>` : '');

    return `
      <tr>
        <td>
          <strong>${m.nombre}</strong>
          ${m.descripcion ? `<span class="table-subtext">${m.descripcion}</span>` : ''}
        </td>
        <td>${estadoBadge(m.en_plan ? 'Activa' : 'Inactiva')} <span class="table-subtext">En plan</span></td>
        <td>${moduloEstadoBadge(estado)} ${limiteLabel}</td>
        <td>${accion}</td>
      </tr>`;
  }).join('');
}

async function guardarOverrideModulo(moduloId, activo) {
  if (!empresaModuloTarget) return;
  try {
    await apiFetch(`/api/admin/empresa-modulos/${empresaModuloTarget}/${moduloId}`, {
      method: 'PUT',
      body: JSON.stringify({ activo }),
    });
    await recargarModulosEmpresa(empresaModuloTarget);
    if (typeof showMessage === 'function') {
      showMessage('modulos-empresa-msg', activo ? 'Módulo habilitado como add-on.' : 'Módulo desactivado para esta empresa.');
    }
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('modulos-empresa-msg', err.message, true);
  }
}

async function eliminarOverrideModulo(moduloId) {
  if (!empresaModuloTarget) return;
  try {
    await apiFetch(`/api/admin/empresa-modulos/${empresaModuloTarget}/${moduloId}`, {
      method: 'DELETE',
    });
    await recargarModulosEmpresa(empresaModuloTarget);
    if (typeof showMessage === 'function') showMessage('modulos-empresa-msg', 'Override eliminado. El módulo sigue el plan.');
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('modulos-empresa-msg', err.message, true);
  }
}

function cerrarPanelModulos() {
  empresaModuloTarget = null;
  document.getElementById('panel-empresa-modulos')?.classList.add('hidden');
}

// ─── PANEL DE PLAN / SUSCRIPCIÓN ──────────────────────────────

async function abrirPanelPlan(empresaId) {
  const empresa = empresasAdminData.find(e => Number(e.id) === Number(empresaId));
  const titulo  = document.getElementById('plan-panel-titulo');
  if (titulo) titulo.textContent = `Plan — ${empresa?.nombre || `Empresa ${empresaId}`}`;

  const hiddenId = document.getElementById('plan-empresa-id');
  if (hiddenId) hiddenId.value = empresaId;

  // Cargar suscripción actual desde el nuevo sistema
  try {
    const sus = await apiFetch(`/api/admin/suscripcion/${empresaId}`);
    if (sus && sus.plan_id) {
      const selPlan = document.getElementById('plan-select-plan-id');
      if (selPlan) selPlan.value = sus.plan_id;
      const selEstado = document.getElementById('plan-select-estado');
      if (selEstado) selEstado.value = sus.estado || 'ACTIVA';
      const selCiclo = document.getElementById('plan-select-ciclo');
      if (selCiclo) selCiclo.value = sus.ciclo || 'MENSUAL';
      const inpPrecio = document.getElementById('plan-input-precio');
      if (inpPrecio) inpPrecio.value = sus.precio_pactado || 0;
      const inpFin = document.getElementById('plan-input-fecha-fin');
      if (inpFin) inpFin.value = fmtInput(sus.fecha_fin);
    }
  } catch (_) { /* sin suscripción aún */ }

  const panel = document.getElementById('panel-empresa-plan');
  if (panel) {
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function cerrarPanelPlan() {
  document.getElementById('panel-empresa-plan')?.classList.add('hidden');
}

async function handleAsignarPlan(event) {
  event.preventDefault();
  const empresaId = Number(document.getElementById('plan-empresa-id')?.value || 0);
  const planId    = Number(document.getElementById('plan-select-plan-id')?.value || 0);
  if (!empresaId || !planId) {
    if (typeof showMessage === 'function') showMessage('plan-msg', 'Selecciona empresa y plan.', true);
    return;
  }

  try {
    await apiFetch(`/api/admin/suscripcion/${empresaId}`, {
      method: 'POST',
      body: JSON.stringify({
        plan_id:       planId,
        estado:        document.getElementById('plan-select-estado')?.value || 'ACTIVA',
        ciclo:         document.getElementById('plan-select-ciclo')?.value  || 'MENSUAL',
        precio_pactado: Number(document.getElementById('plan-input-precio')?.value || 0),
        fecha_fin:     document.getElementById('plan-input-fecha-fin')?.value || null,
        observaciones: document.getElementById('plan-input-obs')?.value || null,
      }),
    });
    if (typeof showMessage === 'function') showMessage('plan-msg', 'Plan asignado correctamente.');
    await cargarEmpresas();
    cerrarPanelPlan();
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('plan-msg', err.message, true);
  }
}

async function handleCambiarEstadoPlan(estado) {
  const empresaId = Number(document.getElementById('plan-empresa-id')?.value || 0);
  if (!empresaId) { if (typeof showMessage === 'function') showMessage('plan-msg', 'Selecciona una empresa.', true); return; }
  if (!confirm(`¿Deseas cambiar el estado de la suscripción a ${estado}?`)) return;
  try {
    await apiFetch(`/api/admin/suscripcion/${empresaId}/estado`, {
      method: 'POST',
      body: JSON.stringify({ estado }),
    });
    if (typeof showMessage === 'function') showMessage('plan-msg', `Suscripción ${estado.toLowerCase()}.`);
    await cargarEmpresas();
    cerrarPanelPlan();
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('plan-msg', err.message, true);
  }
}

// ─── FORMULARIO DE EMPRESA (CREAR / EDITAR) ───────────────────

function resetEmpresaAdminForm() {
  document.getElementById('form-empresa-admin')?.reset();
  if (typeof setElementText === 'function') {
    setElementText('empresa-admin-form-title', 'Crear empresa');
    setElementText('btn-empresa-admin-submit', 'Crear empresa');
  }
  document.getElementById('empresa-admin-id').value = '';
  const zonaEl = document.getElementById('empresa-admin-zona');
  if (zonaEl) zonaEl.value = 'America/Bogota';
  // Modo crear: mostrar usuario y plan; ocultar cancelar
  document.getElementById('empresa-admin-usuario-fields')?.classList.remove('hidden');
  document.getElementById('empresa-admin-plan-row')?.classList.remove('hidden');
  document.getElementById('btn-empresa-cancelar-edicion')?.classList.add('hidden');
}

function editarEmpresaAdmin(id) {
  const e = empresasAdminData.find(e => Number(e.id) === Number(id));
  if (!e) return;

  document.getElementById('empresa-admin-id').value        = e.id;
  document.getElementById('empresa-admin-nombre').value    = e.nombre || '';
  document.getElementById('empresa-admin-nit').value       = e.nit || '';
  document.getElementById('empresa-admin-ciudad').value    = e.ciudad || '';
  document.getElementById('empresa-admin-direccion').value = e.direccion || '';
  document.getElementById('empresa-admin-telefono').value  = e.telefono || '';
  document.getElementById('empresa-admin-email').value     = e.email_contacto || '';
  const zonaEl = document.getElementById('empresa-admin-zona');
  if (zonaEl) zonaEl.value = e.zona_horaria || 'America/Bogota';
  const activaEl = document.getElementById('empresa-admin-activa');
  if (activaEl) activaEl.value = e.activa ? 'true' : 'false';

  if (typeof setElementText === 'function') {
    setElementText('empresa-admin-form-title', 'Editar empresa');
    setElementText('btn-empresa-admin-submit', 'Guardar cambios');
  }
  // Modo editar: ocultar campos de usuario y plan inicial
  document.getElementById('empresa-admin-usuario-fields')?.classList.add('hidden');
  document.getElementById('empresa-admin-plan-row')?.classList.add('hidden');
  document.getElementById('btn-empresa-cancelar-edicion')?.classList.remove('hidden');
  document.getElementById('form-empresa-admin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleGuardarEmpresaAdmin(event) {
  event.preventDefault();
  const empresaId = document.getElementById('empresa-admin-id')?.value;
  const isEditing = Boolean(empresaId);

  const planSelect   = document.getElementById('empresa-admin-plan');
  const adminNombre  = document.getElementById('empresa-admin-user-nombre')?.value.trim() || null;
  const adminEmail   = document.getElementById('empresa-admin-user-email')?.value.trim()  || null;
  const adminPass    = document.getElementById('empresa-admin-user-password')?.value.trim() || '';

  const payload = {
    nombre:        document.getElementById('empresa-admin-nombre')?.value.trim(),
    nit:           document.getElementById('empresa-admin-nit')?.value.trim()       || null,
    ciudad:        document.getElementById('empresa-admin-ciudad')?.value.trim()    || null,
    direccion:     document.getElementById('empresa-admin-direccion')?.value.trim() || null,
    telefono:      document.getElementById('empresa-admin-telefono')?.value.trim()  || null,
    emailContacto: document.getElementById('empresa-admin-email')?.value.trim()     || null,
    zonaHoraria:   document.getElementById('empresa-admin-zona')?.value             || 'America/Bogota',
    activa:        document.getElementById('empresa-admin-activa')?.value !== 'false',
  };

  if (!payload.nombre) {
    if (typeof showMessage === 'function') showMessage('empresa-admin-msg', 'El nombre de la empresa es obligatorio.', true);
    return;
  }

  try {
    if (isEditing) {
      // Edición: usa endpoint existente
      await apiFetch(`/api/empresas/${empresaId}`, {
        method: 'PUT',
        body: JSON.stringify({
          nombre:        payload.nombre,
          nit:           payload.nit,
          ciudad:        payload.ciudad,
          direccion:     payload.direccion,
          telefono:      payload.telefono,
          email_contacto: payload.emailContacto,
          zona_horaria:  payload.zonaHoraria,
          activa:        payload.activa,
          licencia_tipo: 'demo', // campo legacy requerido por el endpoint existente
        }),
      });
      if (typeof showMessage === 'function') showMessage('empresa-admin-msg', 'Empresa actualizada.');
    } else {
      // Creación: usa endpoint de onboarding (nuevo sistema)
      await apiFetch('/api/admin/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          planCodigo:    planSelect?.value || 'starter',
          adminNombre,
          adminEmail,
          adminPassword: adminPass,
        }),
      });
      if (typeof showMessage === 'function') showMessage('empresa-admin-msg', 'Empresa creada con plan asignado.');
    }
    resetEmpresaAdminForm();
    await cargarEmpresas();
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('empresa-admin-msg', err.message, true);
  }
}

async function toggleEmpresaAdmin(id, activa) {
  if (!confirm(`¿Deseas ${activa ? 'activar' : 'suspender'} esta empresa?`)) return;
  try {
    await apiFetch(`/api/empresas/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ activa }),
    });
    await cargarEmpresas();
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('empresa-admin-msg', err.message, true);
  }
}

// ─── CARGA PRINCIPAL ──────────────────────────────────────────

function populatePlanesSelect(targetId) {
  const select = document.getElementById(targetId);
  if (!select) return;
  select.innerHTML = planesAdminData.map(p =>
    `<option value="${p.id}">${p.nombre} — ${fmtMoney(p.precio_mensual)}/mes</option>`
  ).join('');
}

async function cargarEmpresas() {
  try {
    const [empresas, planes, resumen, proximas, licenciasData, suscripciones] = await Promise.all([
      apiFetch('/api/admin/empresas'),
      apiFetch('/api/admin/planes'),
      apiFetch('/api/admin/resumen').catch(() => null),
      apiFetch('/api/admin/proximas-vencer?dias=30').catch(() => []),
      apiFetch('/api/licencias/catalogo/completo').catch(() => ({ licencias: [] })),
      apiFetch('/api/suscripciones').catch(() => []),
    ]);

    empresasAdminData    = empresas  || [];
    planesAdminData      = planes    || [];
    saasResumenData      = resumen;
    proximasAVencerData  = proximas  || [];
    licenciasCatalogoData = licenciasData?.licencias || [];
    suscripcionesAdminData = Array.isArray(suscripciones) ? suscripciones : [];

    // Poblar selects de planes
    populatePlanesSelect('empresa-admin-plan');
    populatePlanesSelect('plan-select-plan-id');
    populateLicenciaPlanSelect();
    populateLicenciaEmpresaSelect();
    populateSuscripcionEmpresaSelect();
    populateSuscripcionPlanSelect();

    renderEmpresasSummary(empresasAdminData);
    renderSaasSummary(saasResumenData);
    renderEmpresasTable();
    renderProximasAVencer();
    renderLicenciaPlanModulos();
    syncLicenciaEmpresaForm();
    await syncSuscripcionSaasForm();
  } catch (err) {
    empresasAdminData   = [];
    planesAdminData     = [];
    proximasAVencerData = [];
    licenciasCatalogoData = [];
    suscripcionesAdminData = [];
    renderEmpresasSummary([]);
    renderSaasSummary(null);
    renderEmpresasTable();
    renderProximasAVencer();
    renderFacturasSaasTable();
    if (typeof showMessage === 'function') showMessage('empresa-admin-msg', err.message, true);
  }
}

// ─── LEGACY: Retrocompat formularios de licencia/suscripción ──
// Estos bloques mantienen funcionando los formularios heredados del HTML
// hasta que se migren a los nuevos paneles.

function renderEmpresasSummaryLegacy(empresas = []) { renderEmpresasSummary(empresas); }

async function handleAsignarLicenciaEmpresa(event) {
  event.preventDefault();
  const empresaId  = document.getElementById('licencia-empresa-id')?.value;
  const licenciaId = document.getElementById('licencia-plan-id')?.value;
  if (!empresaId || !licenciaId) {
    if (typeof showMessage === 'function') showMessage('licencia-empresa-msg', 'Selecciona empresa y licencia.', true);
    return;
  }
  try {
    await apiFetch('/api/licencias/asignar', {
      method: 'POST',
      body: JSON.stringify({
        empresa_id:  Number(empresaId),
        licencia_id: Number(licenciaId),
        fecha_inicio: document.getElementById('licencia-fecha-inicio')?.value || null,
        fecha_fin:    document.getElementById('licencia-fecha-fin')?.value    || null,
      }),
    });
    if (typeof showMessage === 'function') showMessage('licencia-empresa-msg', 'Licencia asignada correctamente.');
    await cargarEmpresas();
    if (typeof loadLicensePermissions === 'function') {
      await loadLicensePermissions();
      if (typeof applyPermissionVisibility === 'function') applyPermissionVisibility();
    }
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('licencia-empresa-msg', err.message, true);
  }
}

async function handleGuardarSuscripcionSaas(event) {
  event.preventDefault();
  const empresaId  = Number(document.getElementById('suscripcion-empresa-id')?.value || 0);
  const licenciaId = Number(document.getElementById('suscripcion-plan-id')?.value    || 0);
  if (!empresaId || !licenciaId) {
    if (typeof showMessage === 'function') showMessage('suscripcion-saas-msg', 'Selecciona empresa y plan.', true);
    return;
  }
  try {
    await apiFetch('/api/suscripciones/upsert', {
      method: 'POST',
      body: JSON.stringify({
        empresa_id:            empresaId,
        licencia_id:           licenciaId,
        estado:                document.getElementById('suscripcion-estado')?.value          || 'ACTIVA',
        fecha_inicio:          document.getElementById('suscripcion-fecha-inicio')?.value    || null,
        fecha_fin:             document.getElementById('suscripcion-fecha-fin')?.value       || null,
        precio_plan:           Number(document.getElementById('suscripcion-precio-plan')?.value || 0),
        pasarela:              document.getElementById('suscripcion-pasarela')?.value        || 'MANUAL',
        referencia_externa:    document.getElementById('suscripcion-referencia-externa')?.value?.trim() || null,
        renovacion_automatica: document.getElementById('suscripcion-renovacion-automatica')?.checked || false,
        observaciones:         document.getElementById('suscripcion-observaciones')?.value?.trim()   || null,
      }),
    });
    if (typeof showMessage === 'function') showMessage('suscripcion-saas-msg', 'Suscripción guardada.');
    await cargarEmpresas();
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('suscripcion-saas-msg', err.message, true);
  }
}

async function handleCambiarEstadoSuscripcionSaas(estado) {
  const empresaId = Number(document.getElementById('suscripcion-empresa-id')?.value || 0);
  if (!empresaId) { if (typeof showMessage === 'function') showMessage('suscripcion-saas-msg', 'Selecciona una empresa.', true); return; }
  if (!confirm(`¿Deseas cambiar el estado a ${estado}?`)) return;
  try {
    await apiFetch(`/api/suscripciones/${empresaId}/estado`, {
      method: 'POST',
      body: JSON.stringify({ estado }),
    });
    if (typeof showMessage === 'function') showMessage('suscripcion-saas-msg', `Suscripción ${estado.toLowerCase()}.`);
    await cargarEmpresas();
  } catch (err) {
    if (typeof showMessage === 'function') showMessage('suscripcion-saas-msg', err.message, true);
  }
}

async function handleRenovarSuscripcionSaas() {
  const empresaId = Number(document.getElementById("suscripcion-empresa-id")?.value || 0);
  if (!empresaId) {
    if (typeof showMessage === "function") showMessage("suscripcion-saas-msg", "Selecciona una empresa para renovar.", true);
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

    if (typeof showMessage === "function") showMessage("suscripcion-saas-msg", "Suscripción renovada por 30 días.");
    await cargarEmpresas();
    await syncSuscripcionSaasForm(empresaId);
  } catch (err) {
    if (typeof showMessage === "function") showMessage("suscripcion-saas-msg", err.message, true);
  }
}

async function handleRegistrarFacturaSaas(event) {
  event.preventDefault();

  const empresaId = Number(document.getElementById("suscripcion-empresa-id")?.value || 0);
  if (!empresaId) {
    if (typeof showMessage === "function") showMessage("factura-saas-msg", "Selecciona una empresa.", true);
    return;
  }

  const total = Number(document.getElementById("factura-saas-total")?.value || 0);
  if (!Number.isFinite(total) || total <= 0) {
    if (typeof showMessage === "function") {
      showMessage("factura-saas-msg", "El total de la factura debe ser mayor a cero.", true);
    }
    return;
  }

  const impuestos = Number(document.getElementById("factura-saas-impuestos")?.value || 0);
  const subtotal = Math.max(total - impuestos, 0);

  try {
    await apiFetch(`/api/suscripciones/${empresaId}/facturas`, {
      method: "POST",
      body: JSON.stringify({
        concepto: document.getElementById("factura-saas-concepto")?.value.trim() || "Cobro de suscripcion SaaS",
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

    if (typeof showMessage === "function") {
      showMessage("factura-saas-msg", "Factura SaaS registrada correctamente.");
    }
    await cargarEmpresas();
  } catch (err) {
    if (typeof showMessage === "function") showMessage("factura-saas-msg", err.message, true);
  }
}

let empresasEventsBound = false;

function bindEmpresasEvents() {
  if (empresasEventsBound) return;
  empresasEventsBound = true;

  document.getElementById("form-empresa-admin")?.addEventListener("submit", handleGuardarEmpresaAdmin);
  document.getElementById("empresas-buscar")?.addEventListener("input", renderEmpresasTable);
  document.getElementById("btn-empresa-cancelar-edicion")?.addEventListener("click", () => {
    resetEmpresaAdminForm();
    document.getElementById("empresa-admin-plan-row")?.classList.remove("hidden");
  });
  document.getElementById("btn-plan-panel-close")?.addEventListener("click", cerrarPanelPlan);
  document.getElementById("btn-plan-suspender")?.addEventListener("click", () => handleCambiarEstadoPlan("SUSPENDIDA"));
  document.getElementById("btn-plan-cancelar")?.addEventListener("click", () => handleCambiarEstadoPlan("CANCELADA"));
  document.getElementById("btn-modulos-panel-close")?.addEventListener("click", cerrarPanelModulos);
  document.getElementById("form-panel-plan")?.addEventListener("submit", handleAsignarPlan);
  document.getElementById("form-licencia-empresa")?.addEventListener("submit", handleAsignarLicenciaEmpresa);
  document.getElementById("licencia-plan-id")?.addEventListener("change", renderLicenciaPlanModulos);
  document.getElementById("licencia-empresa-id")?.addEventListener("change", () => syncLicenciaEmpresaForm());
  document.getElementById("form-suscripcion-saas")?.addEventListener("submit", handleGuardarSuscripcionSaas);
  document.getElementById("suscripcion-empresa-id")?.addEventListener("change", () => syncSuscripcionSaasForm());
  document.getElementById("suscripcion-plan-id")?.addEventListener("change", () => {
    const licencia = getLicenciaById(document.getElementById("suscripcion-plan-id")?.value);
    if (licencia) {
      document.getElementById("suscripcion-precio-plan").value = String(Math.round(Number(licencia.precio || 0)));
    }
  });
  document.getElementById("btn-suscripcion-renovar")?.addEventListener("click", handleRenovarSuscripcionSaas);
  document.getElementById("btn-suscripcion-suspender")?.addEventListener("click", () => handleCambiarEstadoSuscripcionSaas("SUSPENDIDA"));
  document.getElementById("btn-suscripcion-cancelar")?.addEventListener("click", () => handleCambiarEstadoSuscripcionSaas("CANCELADA"));
  document.getElementById("form-factura-saas")?.addEventListener("submit", handleRegistrarFacturaSaas);
  document.getElementById("empresas-tbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-empresa-action]");
    if (!button) return;
    const { empresaAction, empresaId, empresaActiva } = button.dataset;
    if (empresaAction === "editar") editarEmpresaAdmin(empresaId);
    if (empresaAction === "plan") abrirPanelPlan(empresaId);
    if (empresaAction === "modulos") abrirPanelModulos(empresaId);
    if (empresaAction === "toggle") toggleEmpresaAdmin(empresaId, empresaActiva === "true");
  });
  document.getElementById("proximas-vencer-tbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-empresa-action='plan']");
    if (!button) return;
    abrirPanelPlan(button.dataset.empresaId);
  });
  document.getElementById("modulos-empresa-tbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-modulos-action]");
    if (!button) return;
    const { modulosAction, moduloId, moduloActivo } = button.dataset;
    if (modulosAction === "override") guardarOverrideModulo(moduloId, moduloActivo === "true");
    if (modulosAction === "reset") eliminarOverrideModulo(moduloId);
  });
}

window.AG360.registerModule({
  id: "empresas",
  title: "Empresas",
  licenseModule: "empresas",
  icon: "🏢",
  order: 30,
  isVisible: userIsSuperAdmin,
  bindEvents: bindEmpresasEvents,
  onEnter: cargarEmpresas,
});
