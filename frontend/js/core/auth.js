/* =========================================================
   AUTH
   Sesion, usuario actual, refresh token y permisos de licencia.
   ========================================================= */

let licensePermissionsState = {
  loaded: false,
  modules: null,
  license: null,
  expired: false,
};

function getAuthToken() {
  return window.AG360.core.storage.get(STORAGE.TOKEN, "");
}

function getRefreshToken() {
  return window.AG360.core.storage.get(STORAGE.REFRESH_TOKEN, "");
}

function getSessionId() {
  return window.AG360.core.storage.get(STORAGE.SESSION_ID, "");
}

function hasActiveSession() {
  return Boolean(getAuthToken() && getRefreshToken());
}

function persistAuthSession({
  token = "",
  access_token = "",
  refresh_token = "",
  session = {},
  email = "",
  empresa = {},
  usuario = {},
} = {}) {
  const accessToken = access_token || token || "";
  window.AG360.core.storage.set(STORAGE.TOKEN, accessToken);
  window.AG360.core.storage.set(STORAGE.REFRESH_TOKEN, refresh_token || "");
  window.AG360.core.storage.set(STORAGE.SESSION_ID, session?.id || "");
  window.AG360.core.storage.set(STORAGE.EMAIL, email || usuario?.email || "");
  window.AG360.core.storage.set(STORAGE.EMPRESA, empresa?.nombre || "");
  window.AG360.core.storage.set("empresa_logo", empresa?.logo_url || "");
  window.AG360.core.storage.setJSON("user_info", usuario || {});
}

function updateSessionTokens(data = {}) {
  const currentUser = getCurrentUser();
  const currentCompanyName = window.AG360.core.storage.get(STORAGE.EMPRESA, "");
  const currentLogo = window.AG360.core.storage.get("empresa_logo", "");

  persistAuthSession({
    token: data.token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    session: data.session,
    email: data.usuario?.email || currentUser.email || window.AG360.core.storage.get(STORAGE.EMAIL, ""),
    empresa: data.empresa || { nombre: currentCompanyName, logo_url: currentLogo },
    usuario: {
      ...currentUser,
      ...(data.usuario || {}),
    },
  });

  updateCurrentSessionHint();
}

function clearAuthSession() {
  window.AG360.core.storage.remove(STORAGE.TOKEN);
  window.AG360.core.storage.remove(STORAGE.REFRESH_TOKEN);
  window.AG360.core.storage.remove(STORAGE.SESSION_ID);
  window.AG360.core.storage.remove(STORAGE.EMAIL);
  window.AG360.core.storage.remove(STORAGE.EMPRESA);
  window.AG360.core.storage.remove(STORAGE.LICENSE);
  window.AG360.core.storage.remove("empresa_logo");
  window.AG360.core.storage.remove("user_info");
  updateCurrentSessionHint();
}

function getCurrentUser() {
  return window.AG360.core.storage.getJSON("user_info", {}) || {};
}

function normalizeUserRole(role) {
  return typeof normalizeRole === "function"
    ? normalizeRole(role)
    : String(role || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

function userIsSuperAdmin() {
  return normalizeUserRole(getCurrentUser().rol) === "superadmin";
}

function userIsAdmin() {
  return ["admin", "administrador", "superadmin"].includes(normalizeUserRole(getCurrentUser().rol));
}

function userCanManageUsers() {
  return userIsAdmin();
}

function userCan(permission) {
  const permissions = getCurrentUser().permisos || [];
  return permissions.includes("*") || permissions.includes(permission);
}

function setLicensePermissions(data = {}) {
  const moduleNames = Array.isArray(data.modulos)
    ? data.modulos.map((moduleItem) => normalizeUserRole(typeof moduleItem === "string" ? moduleItem : moduleItem?.nombre))
    : null;

  licensePermissionsState = {
    loaded: true,
    modules: moduleNames ? new Set(moduleNames) : null,
    license: data.licencia || null,
    expired: Boolean(data.expirada),
  };

  window.AG360.core.storage.setJSON(STORAGE.LICENSE, {
    modulos: moduleNames || null,
    licencia: licensePermissionsState.license,
    expirada: licensePermissionsState.expired,
  });
}

function restoreCachedLicensePermissions() {
  const cached = window.AG360.core.storage.getJSON(STORAGE.LICENSE, {});
  if (Array.isArray(cached?.modulos)) {
    setLicensePermissions({
      modulos: cached.modulos,
      licencia: cached.licencia,
      expirada: cached.expirada,
    });
    return true;
  }

  window.AG360.core.storage.remove(STORAGE.LICENSE);
  return false;
}

async function loadLicensePermissions() {
  const user = getCurrentUser();
  if (user.scope === "platform") {
    licensePermissionsState = {
      loaded: true,
      modules: null,
      license: null,
      expired: false,
    };
    window.AG360.core.storage.remove(STORAGE.LICENSE);
    return null;
  }

  try {
    const data = await apiFetch("/api/empresa/licencia/permisos");
    setLicensePermissions(data);
    return data;
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
    return null;
  }
}

function isModuleAllowed(moduleName) {
  const moduleKey = normalizeUserRole(moduleName);
  if (!moduleKey || ALWAYS_AVAILABLE_MODULES.has(moduleKey)) return true;
  if (moduleKey === "empresas" && userIsSuperAdmin()) return true;
  if (!licensePermissionsState.loaded || !licensePermissionsState.modules) return true;
  return licensePermissionsState.modules.has(moduleKey);
}

function getModuleBlockedMessage(moduleName) {
  const routerView = typeof getViewDefinition === "function" ? getViewDefinition(moduleName) : null;
  const moduleLabel = moduleName === "configuracion"
    ? "Configuracion"
    : routerView?.title || VIEW_TITLES?.[moduleName] || String(moduleName || "Este modulo");

  if (licensePermissionsState.expired) {
    return `La licencia actual esta vencida. Renueva el plan para abrir ${moduleLabel}.`;
  }

  const licenseName = licensePermissionsState.license?.nombre || "actual";
  return `${moduleLabel} no esta incluido en la licencia ${licenseName}.`;
}

function showModuleBlockedMessage(moduleName) {
  alert(getModuleBlockedMessage(moduleName));
}

function showLoginView() {
  document.getElementById("login-view")?.classList.remove("hidden");
  document.getElementById("main-view")?.classList.add("hidden");
}

function showMainView() {
  document.getElementById("login-view")?.classList.add("hidden");
  document.getElementById("main-view")?.classList.remove("hidden");
}

function updateCurrentSessionHint() {
  const sessionBadge = document.getElementById("session-current-badge");
  if (!sessionBadge) return;

  const sessionId = getSessionId();
  sessionBadge.textContent = sessionId
    ? `Sesion actual: ${sessionId.slice(0, 8)}...`
    : "Sesion actual";
}

async function initAfterLogin() {
  const empresa = window.AG360.core.storage.get(STORAGE.EMPRESA, "");
  if (empresa) {
    const sidebarEmpresa = document.getElementById("sidebar-empresa");
    if (sidebarEmpresa) sidebarEmpresa.textContent = empresa;
  }

  const email = window.AG360.core.storage.get(STORAGE.EMAIL, "");
  if (email) {
    const userLabel = document.getElementById("user-info-label");
    if (userLabel) userLabel.textContent = email;
  }

  const empresaLogo = window.AG360.core.storage.get("empresa_logo", "");
  updateSidebarLogo(empresaLogo, empresa);
  updateCurrentSessionHint();

  if (!licensePermissionsState.loaded) {
    await loadLicensePermissions();
  }

  applyPermissionVisibility();
  changeView("dashboard");
}

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("login-email")?.value.trim() || "";
  const password = document.getElementById("login-password")?.value.trim() || "";
  const errorBox = document.getElementById("login-error");

  if (errorBox) errorBox.hidden = true;

  if (!email || !password) {
    if (errorBox) {
      errorBox.textContent = "Ingresa correo y contrasena.";
      errorBox.hidden = false;
    }
    return;
  }

  try {
    const data = await apiFetch("/api/login", {
      method: "POST",
      withoutAuth: true,
      body: JSON.stringify({ email, password }),
    });

    persistAuthSession({
      token: data.token,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      session: data.session,
      email,
      empresa: data.empresa,
      usuario: data.usuario,
    });

    if (data.licencia) {
      setLicensePermissions(data.licencia);
    } else {
      await loadLicensePermissions();
    }

    showMainView();
    await initAfterLogin();
    updateSidebarLogo(data.empresa?.logo_url, data.empresa?.nombre);
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  }
}

async function logout({ skipRemote = false } = {}) {
  if (!skipRemote && getAuthToken()) {
    try {
      await apiFetch("/api/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: getRefreshToken() || undefined }),
        skipAuthRefresh: true,
      });
    } catch (error) {
      console.warn("No se pudo cerrar la sesión remotamente:", error);
    }
  }

  clearAuthSession();
  licensePermissionsState = {
    loaded: false,
    modules: null,
    license: null,
    expired: false,
  };

  showLoginView();
}

window.AG360.core.auth = {
  getAuthToken,
  getRefreshToken,
  getSessionId,
  hasActiveSession,
  persistAuthSession,
  updateSessionTokens,
  clearAuthSession,
  getCurrentUser,
  userIsSuperAdmin,
  userIsAdmin,
  userCanManageUsers,
  userCan,
  setLicensePermissions,
  loadLicensePermissions,
  isModuleAllowed,
  initAfterLogin,
  handleLogin,
  logout,
  updateCurrentSessionHint,
};
