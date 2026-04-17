/* =========================================================
   AUTH — sesión, licencias, permisos de usuario
   Depende de: storage.js, ui.js (normalizeRole, setElementText, updateSidebarLogo)
   ========================================================= */

let licensePermissionsState = {
  loaded: false,
  modules: null,
  license: null,
  expired: false,
};

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("user_info") || "{}");
  } catch {
    return {};
  }
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

/**
 * Verifica si el usuario actual tiene un permiso dado.
 * Los permisos llegan del login en data.usuario.permisos.
 *
 * Uso en el frontend:
 *   if (userCan('clientes:eliminar')) mostrarBotonEliminar();
 */
function userCan(permiso) {
  const permisos = getCurrentUser().permisos || [];
  return permisos.includes("*") || permisos.includes(permiso);
}

function setLicensePermissions(data = {}) {
  const moduleNames = Array.isArray(data.modulos)
    ? data.modulos.map((m) => normalizeRole(typeof m === "string" ? m : m?.nombre))
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
      setLicensePermissions({ modulos: cached.modulos, licencia: cached.licencia, expirada: cached.expirada });
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
      licensePermissionsState = { loaded: true, modules: null, license: null, expired: false };
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

// ── Vistas de login/main ──────────────────────────────────

function showLoginView() {
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("main-view").classList.add("hidden");
}

function showMainView() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
}

async function initAfterLogin() {
  const empresa = localStorage.getItem(STORAGE.EMPRESA);
  if (empresa) document.getElementById("sidebar-empresa").textContent = empresa;

  const email = localStorage.getItem(STORAGE.EMAIL);
  if (email) document.getElementById("user-info-label").textContent = email;

  const empresaLogo = localStorage.getItem("empresa_logo");
  updateSidebarLogo(empresaLogo, empresa);

  // Si el login ya devolvió la licencia, no hacemos la llamada extra al servidor.
  if (!licensePermissionsState.loaded) {
    await loadLicensePermissions();
  }

  applyPermissionVisibility();
  changeView("dashboard");
}

// ── Login / Logout ────────────────────────────────────────

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
    localStorage.setItem("empresa_logo", data.empresa?.logo_url || "");
    localStorage.setItem("user_info", JSON.stringify(data.usuario));

    // Si el login ya devuelve la licencia, la cargamos de inmediato
    // para no hacer una llamada extra a /api/empresa/licencia/permisos
    if (data.licencia) {
      setLicensePermissions(data.licencia);
    }

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
  licensePermissionsState = { loaded: false, modules: null, license: null, expired: false };
  showLoginView();
}
