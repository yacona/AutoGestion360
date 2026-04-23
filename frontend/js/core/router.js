/* =========================================================
   ROUTER
   Navegacion SPA basada en modulos registrados.
   ========================================================= */

const VIEW_TITLES = {
  dashboard: "Dashboard",
  modulos: "Modulos",
  empresas: "Empresas",
  usuarios: "Usuarios",
  parqueadero: "Parqueadero",
  lavadero: "Lavadero",
  taller: "Taller",
  clientes: "Clientes",
  empleados: "Empleados",
  reportes: "Reportes",
  config: "Configuracion",
};

const ALWAYS_AVAILABLE_MODULES = new Set(["dashboard"]);

const STATIC_VIEWS = {
  modulos: {
    id: "modulos",
    title: "Modulos",
    licenseModule: null,
    icon: "🧩",
    order: 20,
    menu: true,
  },
};

function createLegacyViewDefinition(id, fallback = {}) {
  const callbacks = {
    empresas: () => (typeof cargarEmpresas === "function" ? cargarEmpresas() : null),
    usuarios: () => (typeof cargarUsuariosSistema === "function" ? cargarUsuariosSistema() : null),
    config: () => (typeof loadConfig === "function" ? loadConfig() : null),
  };

  const visibility = {
    empresas: () => userIsSuperAdmin(),
    usuarios: () => userCanManageUsers(),
  };

  return {
    id,
    title: VIEW_TITLES[id] || fallback.title || id,
    licenseModule: fallback.licenseModule ?? id,
    icon: fallback.icon || "",
    order: fallback.order ?? 100,
    menu: fallback.menu ?? true,
    isVisible: visibility[id] || (() => true),
    onEnter: callbacks[id] || fallback.onEnter || null,
  };
}

function getViewDefinitions() {
  const registered = window.AG360.getModules().reduce((acc, moduleDefinition) => {
    acc[moduleDefinition.id] = {
      menu: true,
      isVisible: () => true,
      ...moduleDefinition,
      title: moduleDefinition.title || VIEW_TITLES[moduleDefinition.id] || moduleDefinition.id,
    };
    return acc;
  }, {});

  ["dashboard", "empresas", "usuarios", "config"].forEach((viewId) => {
    if (!registered[viewId]) {
      registered[viewId] = createLegacyViewDefinition(viewId, {
        icon: viewId === "dashboard" ? "🧭" : viewId === "empresas" ? "🏢" : viewId === "usuarios" ? "🔐" : "⚙",
        order: viewId === "dashboard" ? 10 : viewId === "empresas" ? 30 : viewId === "usuarios" ? 80 : 110,
        licenseModule: viewId === "config" ? "configuracion" : viewId,
      });
    }
  });

  return {
    ...STATIC_VIEWS,
    ...registered,
  };
}

function getViewDefinition(view) {
  return getViewDefinitions()[view] || null;
}

function getSidebarMenuItems(activeView = "") {
  return Object.values(getViewDefinitions())
    .filter((item) => item.menu !== false)
    .filter((item) => (typeof item.isVisible === "function" ? item.isVisible() : true))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((item) => ({
      id: item.id,
      label: item.title,
      icon: item.icon || "",
      active: item.id === activeView,
      licenseModule: item.licenseModule,
      allowed: item.licenseModule ? isModuleAllowed(item.licenseModule) : true,
    }));
}

function renderSidebar(activeView = "") {
  renderSidebarMenu(getSidebarMenuItems(activeView));
}

function applyPermissionVisibility() {
  renderSidebar(getActiveViewName());

  document.querySelectorAll("[data-superadmin-only]").forEach((element) => {
    element.classList.toggle("hidden", !userIsSuperAdmin());
  });

  document.querySelectorAll("[data-useradmin-only]").forEach((element) => {
    element.classList.toggle("hidden", !userCanManageUsers());
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
  const definition = getViewDefinition(view);
  const targetView = document.getElementById(`view-${view}`);

  if (!definition || !targetView) return false;

  if (typeof definition.isVisible === "function" && !definition.isVisible()) {
    changeView("dashboard");
    return false;
  }

  if (definition.licenseModule && !isModuleAllowed(definition.licenseModule)) {
    showModuleBlockedMessage(definition.licenseModule);
    if (view !== "modulos") changeView("modulos");
    return false;
  }

  document.querySelectorAll(".view").forEach((viewElement) => {
    viewElement.classList.remove("visible");
  });
  targetView.classList.add("visible");

  renderSidebar(view);

  const title = document.getElementById("current-view-title");
  if (title) {
    title.textContent = definition.title || VIEW_TITLES[view] || view.toUpperCase();
  }

  if (typeof definition.onEnter === "function") {
    Promise.resolve(definition.onEnter()).catch((error) => {
      console.error(`Error entrando a la vista ${view}:`, error);
    });
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

function setConfigTab(tab = "empresa") {
  const requestedTab = tab || "empresa";
  const isPlatformUser = getCurrentUser()?.scope === "platform";
  const targetButton = document.querySelector(`.config-tab[data-config-tab="${requestedTab}"]`);
  const fallbackTab = isPlatformUser ? "sesiones" : "empresa";
  const selectedTab = targetButton?.dataset.tenantOnly === "true" && isPlatformUser
    ? fallbackTab
    : requestedTab;

  document.querySelectorAll(".config-tab").forEach((button) => {
    const active = button.dataset.configTab === selectedTab;
    const tenantOnly = button.dataset.tenantOnly === "true";
    button.classList.toggle("hidden", tenantOnly && isPlatformUser);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.querySelectorAll("[data-config-panel]").forEach((panel) => {
    const samePanel = panel.dataset.configPanel === selectedTab;
    const adminOnly = panel.dataset.adminOnly === "true";
    const tenantOnly = panel.dataset.tenantOnly === "true";
    panel.classList.toggle("hidden", !samePanel || (adminOnly && !userIsSuperAdmin()) || (tenantOnly && isPlatformUser));
  });

  if (selectedTab === "parqueadero" && typeof loadParqueaderoConfig === "function") {
    loadParqueaderoConfig();
  }
  if (selectedTab === "licencias" && typeof loadLicenciaInfo === "function") {
    loadLicenciaInfo();
  }
  if (selectedTab === "sesiones" && typeof loadUserSessions === "function") {
    loadUserSessions();
  }
}

window.AG360.core.router = {
  getViewDefinitions,
  getViewDefinition,
  getSidebarMenuItems,
  renderSidebar,
  applyPermissionVisibility,
  changeView,
};
