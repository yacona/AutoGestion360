/* =========================================================
   CONFIGURACIÓN — empresa, licencia, parqueadero, tema
   Depende de: ui.js, api.js, auth.js
   Nota: setConfigTab vive en router.js
   ========================================================= */

// ── Overview ──────────────────────────────────────────────

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
  const currentUser = getCurrentUser();
  const isPlatformUser = currentUser.scope === "platform";

  try {
    if (isPlatformUser) {
      updateConfigOverview({
        nombre: "Plataforma",
        email_contacto: currentUser.email || "Sin contacto",
        ciudad: "Multiempresa",
      }, null);

      setElementText("config-summary-plan", "Platform");
      setElementText("config-summary-modulos", "Acceso administrativo");
      setElementText("config-summary-vigencia", "Sin vencimiento");
      setElementText("empresa-identidad-nombre", currentUser.nombre || "Usuario de plataforma");
      setElementText("empresa-identidad-contacto", currentUser.email || "Sin contacto");
      setElementText("empresa-identidad-ciudad", "Scope platform");
      updateCurrentSessionHint();

      const activeTab = document.querySelector(".config-tab.active")?.dataset.configTab;
      setConfigTab(activeTab || "sesiones");
      return;
    }

    const empresa = await apiFetch("/api/empresa");
    document.getElementById("empresa-nombre").value = empresa.nombre || "";
    document.getElementById("empresa-nit").value = empresa.nit || "";
    document.getElementById("empresa-ciudad").value = empresa.ciudad || "";
    document.getElementById("empresa-direccion").value = empresa.direccion || "";
    document.getElementById("empresa-telefono").value = empresa.telefono || "";
    document.getElementById("empresa-email").value = empresa.email_contacto || "";
    document.getElementById("empresa-zona-horaria").value = empresa.zona_horaria || "America/Bogota";
    document.getElementById("empresa-logo-file").value = "";
    updateLogoPreview(empresa.logo_url, empresa.nombre);

    const permisos = await loadLicenciaInfo();
    updateConfigOverview(empresa, permisos);
    await loadParqueaderoConfig();

    const activeTab = document.querySelector(".config-tab.active")?.dataset.configTab || "empresa";
    setConfigTab(activeTab);
  } catch (error) {
    console.error("Error cargando configuración:", error);
    showError("Error al cargar la configuración");
  }
}

// ── Sesiones ──────────────────────────────────────────────

function formatSessionDate(value) {
  return value ? formatDateTime(value) : "Sin registro";
}

function formatSessionExpiry(value) {
  if (!value) return "Sin vencimiento";

  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return "Sin vencimiento";

  if (expiresAt.getTime() <= Date.now()) {
    return "Expirada";
  }

  return formatDateTime(value);
}

function getSessionStatusLabel(session = {}) {
  if (session.revocada_en) return "Revocada";

  const refreshExpiresAt = new Date(session.refresh_expires_at || "");
  if (Number.isFinite(refreshExpiresAt.getTime()) && refreshExpiresAt.getTime() <= Date.now()) {
    return "Expirada";
  }

  return session.actual ? "Actual" : "Activa";
}

function getSessionDeviceLabel(userAgent = "") {
  const normalized = String(userAgent || "").toLowerCase();
  if (!normalized) return "Dispositivo no identificado";
  if (normalized.includes("iphone")) return "iPhone";
  if (normalized.includes("ipad")) return "iPad";
  if (normalized.includes("android")) return "Android";
  if (normalized.includes("mac os") || normalized.includes("macintosh")) return "macOS";
  if (normalized.includes("windows")) return "Windows";
  if (normalized.includes("linux")) return "Linux";
  return "Navegador web";
}

function resetSessionsFeedback() {
  const errorBox = document.getElementById("sesiones-error");
  const successBox = document.getElementById("sesiones-success");
  if (errorBox) errorBox.hidden = true;
  if (successBox) successBox.hidden = true;
}

function renderSessionsList(sessions = []) {
  const container = document.getElementById("sesiones-lista");
  if (!container) return;

  updateCurrentSessionHint();

  if (!Array.isArray(sessions) || sessions.length === 0) {
    container.innerHTML = `
      <div class="session-empty-state">
        <strong>No hay sesiones activas registradas.</strong>
        <span>Cuando inicies sesion desde otro dispositivo apareceran aqui.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = sessions.map((session) => {
    const statusLabel = getSessionStatusLabel(session);
    const deviceLabel = getSessionDeviceLabel(session.user_agent);
    const currentBadge = session.actual
      ? '<span class="badge badge-primary">Sesion actual</span>'
      : "";
    const revokeButton = session.actual
      ? '<button type="button" class="btn btn-outline" data-session-action="logout-current">Cerrar esta sesion</button>'
      : `<button type="button" class="btn btn-outline" data-session-action="revoke" data-session-id="${escapeHtml(session.id)}">Cerrar sesion</button>`;

    return `
      <article class="session-card${session.actual ? " session-card-current" : ""}">
        <div class="session-card-header">
          <div>
            <strong>${deviceLabel}</strong>
            <span class="small-text">ID ${escapeHtml(String(session.id || "").slice(0, 12))}${String(session.id || "").length > 12 ? "..." : ""}</span>
          </div>
          <div class="session-badges">
            ${currentBadge}
            <span class="${getBadgeClass(statusLabel)}">${statusLabel}</span>
          </div>
        </div>
        <div class="session-card-body">
          <div class="session-meta-grid">
            <div>
              <span>Ultima actividad</span>
              <strong>${escapeHtml(formatSessionDate(session.ultima_actividad_en || session.ultimo_refresh_en || session.ultimo_login_en))}</strong>
            </div>
            <div>
              <span>Refresh vence</span>
              <strong>${escapeHtml(formatSessionExpiry(session.refresh_expires_at))}</strong>
            </div>
            <div>
              <span>IP creacion</span>
              <strong>${escapeHtml(session.ip_creacion || "No registrada")}</strong>
            </div>
            <div>
              <span>IP ultimo uso</span>
              <strong>${escapeHtml(session.ip_ultimo_uso || "No registrada")}</strong>
            </div>
          </div>
          <div class="session-agent">
            <span class="small-text">${escapeHtml(session.user_agent || "Sin user-agent registrado")}</span>
          </div>
        </div>
        <div class="session-card-actions">
          ${revokeButton}
        </div>
      </article>
    `;
  }).join("");
}

async function loadUserSessions() {
  const container = document.getElementById("sesiones-lista");
  if (container) {
    container.innerHTML = '<div class="session-empty-state"><strong>Cargando sesiones...</strong><span>Consultando dispositivos y actividad reciente.</span></div>';
  }

  resetSessionsFeedback();

  try {
    const sessions = await apiFetch("/api/sesiones");
    renderSessionsList(sessions);
  } catch (error) {
    console.error("Error cargando sesiones:", error);
    if (container) {
      container.innerHTML = `
        <div class="session-empty-state">
          <strong>No fue posible cargar las sesiones.</strong>
          <span>Intenta nuevamente en unos segundos.</span>
        </div>
      `;
    }
    showError(error.message || "Error al cargar sesiones", "sesiones-error");
  }
}

async function handleCerrarSesionRemota(sessionUid) {
  if (!sessionUid) return;
  if (!confirm("Se cerrara la sesion seleccionada en ese dispositivo. Deseas continuar?")) return;

  resetSessionsFeedback();

  try {
    await apiFetch(`/api/sesiones/${encodeURIComponent(sessionUid)}`, {
      method: "DELETE",
    });
    showSuccess("Sesion cerrada correctamente", "sesiones-success");

    if (sessionUid === getSessionId()) {
      await logout({ skipRemote: true });
      return;
    }

    await loadUserSessions();
  } catch (error) {
    showError(error.message || "No fue posible cerrar la sesion", "sesiones-error");
  }
}

async function handleCerrarSesionActual() {
  if (!confirm("Se cerrara la sesion actual en este navegador. Deseas continuar?")) return;
  await logout();
}

async function handleCerrarTodasLasSesiones() {
  if (!confirm("Se cerraran todas las sesiones activas, incluida la actual. Deseas continuar?")) return;

  resetSessionsFeedback();

  try {
    await apiFetch("/api/logout-all", {
      method: "POST",
    });
    showSuccess("Todas las sesiones fueron cerradas", "sesiones-success");
    await logout({ skipRemote: true });
  } catch (error) {
    showError(error.message || "No fue posible cerrar todas las sesiones", "sesiones-error");
  }
}

// ── Licencia ──────────────────────────────────────────────

function renderLicenseModules(modulos = []) {
  const container = document.getElementById("modulos-lista");
  if (!container) return;

  if (modulos.length === 0) {
    container.innerHTML = '<div class="license-module-empty">Sin módulos activos.</div>';
    return;
  }

  container.innerHTML = modulos.map((m) => `
    <div class="license-module-item">
      <strong>${formatModuleLabel(m.nombre)}</strong>
      <span>${m.descripcion || "Acceso activo en el plan actual"}</span>
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
  if (estado) { estado.textContent = "Inactiva"; estado.className = "badge badge-danger"; }

  const progress = document.getElementById("licencia-progress-bar");
  if (progress) progress.style.width = "0%";

  renderLicenseModules([]);
  document.getElementById("btn-gestionar-licencia")?.classList.toggle("hidden", !userIsSuperAdmin());
  document.getElementById("btn-renovar-licencia")?.classList.toggle("hidden", userIsSuperAdmin());
}

async function loadLicenciaInfo() {
  try {
    const permisos = await apiFetch("/api/empresa/licencia/permisos");
    setLicensePermissions(permisos);
    applyPermissionVisibility();

    const licencia = permisos.licencia;
    if (!licencia) { renderEmptyLicensePlan(); return permisos; }

    const modulos = permisos.modulos_detalle || (permisos.modulos || []).map((n) => ({ nombre: n }));
    const diasRestantes = getDaysRemaining(licencia.fecha_fin);
    const activa = Boolean(licencia.activa) && !permisos.expirada;
    const estadoLabel = activa ? "Activa" : permisos.expirada ? "Vencida" : "Inactiva";
    const progress = getLicenseProgress(licencia.fecha_inicio, licencia.fecha_fin);
    const renewalVisible = diasRestantes !== null && diasRestantes <= 30;

    setElementText("licencia-nombre", licencia.nombre || "Sin nombre");
    setElementText("licencia-descripcion", licencia.descripcion || "Plan activo para la operación de la empresa.");
    setElementText("licencia-inicio", formatDisplayDate(licencia.fecha_inicio));
    setElementText("licencia-fin", licencia.fecha_fin ? formatDisplayDate(licencia.fecha_fin) : "Sin vencimiento");
    setElementText("licencia-precio", licencia.precio != null ? formatMoney(licencia.precio) : "-");
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
      setElementText("licencia-vigencia-texto", diasRestantes <= 30 ? "Renovación próxima" : "Vigencia saludable");
    }

    const estado = document.getElementById("licencia-estado");
    if (estado) { estado.textContent = estadoLabel; estado.className = getBadgeClass(estadoLabel); }

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
    console.error("Error cargando licencia:", error);
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
  if (!empresaId) { changeView("empresas"); return; }

  const changed = changeView("empresas");
  if (!changed) return;

  await cargarEmpresas();
  syncLicenciaEmpresaForm(empresaId);
  document.getElementById("form-licencia-empresa")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleVerLicencias() {
  try {
    const licencias = await apiFetch("/api/licencias");
    const grid = document.getElementById("licencias-grid");
    grid.innerHTML = "";
    licencias.forEach((licencia) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h4>${licencia.nombre}</h4>
        <p>${licencia.descripcion || "Sin descripción"}</p>
        <p><strong>Precio:</strong> $${licencia.precio || 0}</p>
      `;
      grid.appendChild(card);
    });
    document.getElementById("licencias-lista").hidden = false;
  } catch (error) {
    showError("Error al cargar licencias");
  }
}

async function handleAsignarLicencia() {
  const licenciaId = prompt("ID de la licencia a asignar:");
  const fechaInicio = prompt("Fecha de inicio (YYYY-MM-DD):", new Date().toISOString().split("T")[0]);
  const fechaFin = prompt("Fecha de fin (YYYY-MM-DD, opcional):");
  if (!licenciaId || !fechaInicio) return;

  try {
    await apiFetch("/api/licencias/asignar", {
      method: "POST",
      body: JSON.stringify({
        empresa_id: JSON.parse(localStorage.getItem("user_info")).empresa_id,
        licencia_id: parseInt(licenciaId),
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin || null,
      }),
    });
    showSuccess("Licencia asignada exitosamente");
    loadLicenciaInfo();
  } catch (error) {
    showError(error.message);
  }
}

async function handleNotificarVencimientos() {
  try {
    const result = await apiFetch("/api/licencias/enviar-notificaciones", { method: "POST" });
    showSuccess(`Notificaciones enviadas: ${result.enviados}, Errores: ${result.errores}`);
  } catch (error) {
    showError(error.message);
  }
}

// ── Empresa ───────────────────────────────────────────────

async function handleActualizarEmpresa(event) {
  event.preventDefault();
  const logoFile = document.getElementById("empresa-logo-file")?.files?.[0];
  const data = {
    nombre: document.getElementById("empresa-nombre").value,
    nit: document.getElementById("empresa-nit").value,
    ciudad: document.getElementById("empresa-ciudad").value,
    direccion: document.getElementById("empresa-direccion").value,
    telefono: document.getElementById("empresa-telefono").value,
    email_contacto: document.getElementById("empresa-email").value,
    zona_horaria: document.getElementById("empresa-zona-horaria").value,
  };

  try {
    if (logoFile) await uploadEmpresaLogo(logoFile);
    await apiFetch("/api/empresa", { method: "PUT", body: JSON.stringify(data) });
    showSuccess("Empresa actualizada exitosamente", "empresa-success");
    document.getElementById("sidebar-empresa").textContent = data.nombre;
    localStorage.setItem(STORAGE.EMPRESA, data.nombre);
    await loadConfig();
  } catch (error) {
    showError(error.message, "empresa-error");
  }
}

async function handleLogoFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    updateLogoPreview("", document.getElementById("empresa-nombre").value);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const preview = document.getElementById("logo-preview");
    if (!preview) return;
    preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = reader.result;
    img.alt = "Vista previa del logo";
    preview.appendChild(img);
  };
  reader.readAsDataURL(file);
}

async function uploadEmpresaLogo(file) {
  const formData = new FormData();
  formData.append("logo", file);
  const result = await apiFetch("/api/empresa/logo", { method: "POST", body: formData });
  if (result.logo_url) updateLogoPreview(result.logo_url, document.getElementById("empresa-nombre").value);
  return result;
}

// ── Parqueadero config ────────────────────────────────────

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
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
      <td><input type="text" data-field="dia_nombre" value="${regla.dia_codigo}" readonly /></td>
      <td><input type="text" data-field="hora_inicio_gratis" value="${formatHoraCompleta(regla.hora_inicio_gratis)}" placeholder="07:00 / 7 AM" /></td>
      <td><input type="text" data-field="hora_fin_gratis" value="${formatHoraCompleta(regla.hora_fin_gratis)}" placeholder="11:00 / 11 AM" /></td>
      <td><input type="number" data-field="minutos_gracia" min="0" value="${regla.minutos_gracia}" /></td>
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
    return { dia_codigo: rule.dia_codigo, aplica: rule.aplica, hora_inicio_gratis: inicio, hora_fin_gratis: fin, minutos_gracia: rule.minutos_gracia };
  });
}

async function loadParqueaderoConfig() {
  try {
    const config = await apiFetch("/api/configuracion/parqueadero");
    document.getElementById("cfg-pq-modulo-activo").checked = Boolean(config.general?.modulo_activo);
    document.getElementById("cfg-pq-solo-facturacion").checked = Boolean(config.general?.solo_facturacion);
    setInputValue("cfg-pq-valet", config.general?.valor_valet_parking || 0);
    setVehicleConfig("carro", config.vehiculos?.CARRO);
    setVehicleConfig("moto", config.vehiculos?.MOTO);
    renderParqueaderoReglas(config.reglas || []);
    const status = document.getElementById("config-parqueadero-status");
    if (status) {
      status.textContent = config.general?.modulo_activo ? "Activo" : "Inactivo";
      status.className = config.general?.modulo_activo ? "badge badge-success" : "badge badge-muted";
    }
  } catch (error) {
    console.error("Error cargando configuración de parqueadero:", error);
    showError(error.message || "Error al cargar la configuración de parqueadero", "pq-config-error");
  }
}

async function handleGuardarParqueaderoConfig(event) {
  event.preventDefault();
  let reglas;
  try {
    reglas = collectParqueaderoReglas();
  } catch (err) {
    showError(err.message, "pq-config-error");
    return;
  }

  const payload = {
    general: {
      modulo_activo: document.getElementById("cfg-pq-modulo-activo")?.checked || false,
      solo_facturacion: document.getElementById("cfg-pq-solo-facturacion")?.checked || false,
      valor_valet_parking: getNumberValue("cfg-pq-valet"),
    },
    vehiculos: {
      CARRO: getVehicleConfig("carro"),
      MOTO: getVehicleConfig("moto"),
    },
    reglas,
  };

  try {
    const response = await apiFetch("/api/configuracion/parqueadero", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const config = response.config || response;
    setVehicleConfig("carro", config.vehiculos?.CARRO);
    setVehicleConfig("moto", config.vehiculos?.MOTO);
    renderParqueaderoReglas(config.reglas || []);
    const status = document.getElementById("config-parqueadero-status");
    if (status) {
      status.textContent = config.general?.modulo_activo ? "Activo" : "Inactivo";
      status.className = config.general?.modulo_activo ? "badge badge-success" : "badge badge-muted";
    }
    showSuccess("Configuración de parqueadero actualizada", "pq-config-success");
  } catch (error) {
    showError(error.message, "pq-config-error");
  }
}

function toggleParqueaderoConfig() {
  const body = document.getElementById("form-parqueadero-config");
  const chevron = document.getElementById("parqueadero-config-chevron");
  if (!body) return;
  body.classList.toggle("hidden");
  if (chevron) chevron.textContent = body.classList.contains("hidden") ? "›" : "▾";
}

let configuracionEventsBound = false;

function bindConfiguracionEvents() {
  if (configuracionEventsBound) return;
  configuracionEventsBound = true;

  document.getElementById("form-empresa")?.addEventListener("submit", handleActualizarEmpresa);
  document.getElementById("btn-ver-licencias")?.addEventListener("click", handleVerLicencias);
  document.getElementById("btn-asignar-licencia")?.addEventListener("click", handleAsignarLicencia);
  document.getElementById("btn-gestionar-licencia")?.addEventListener("click", handleGestionarPlanActual);
  document.getElementById("btn-renovar-licencia")?.addEventListener("click", handleGestionarPlanActual);
  document.getElementById("btn-notificar-vencimientos")?.addEventListener("click", handleNotificarVencimientos);
  document.getElementById("empresa-logo-file")?.addEventListener("change", handleLogoFileChange);
  document.getElementById("form-parqueadero-config")?.addEventListener("submit", handleGuardarParqueaderoConfig);
  document.getElementById("btn-toggle-parqueadero-config")?.addEventListener("click", toggleParqueaderoConfig);
  document.getElementById("btn-refresh-sesiones")?.addEventListener("click", loadUserSessions);
  document.getElementById("btn-logout-all-sesiones")?.addEventListener("click", handleCerrarTodasLasSesiones);
  document.getElementById("sesiones-lista")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-action]");
    if (!button) return;

    if (button.dataset.sessionAction === "revoke") {
      handleCerrarSesionRemota(button.dataset.sessionId);
      return;
    }

    if (button.dataset.sessionAction === "logout-current") {
      handleCerrarSesionActual();
    }
  });
  document.querySelectorAll(".config-tab").forEach((button) => {
    button.addEventListener("click", () => setConfigTab(button.dataset.configTab));
  });
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeOption));
  });
}

window.AG360.registerModule({
  id: "config",
  title: "Configuracion",
  licenseModule: "configuracion",
  icon: "⚙",
  order: 110,
  bindEvents: bindConfiguracionEvents,
  onEnter: loadConfig,
});

window.loadUserSessions = loadUserSessions;
