/* =========================================================
   ROUTER — navegación SPA, permisos de vista, módulo catalog
   Depende de: storage.js, ui.js, auth.js
   ========================================================= */

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

function applyPermissionVisibility() {
  const canManageCompanies = userIsSuperAdmin();
  document.querySelectorAll("[data-superadmin-only]").forEach((el) => {
    el.classList.toggle("hidden", !canManageCompanies);
  });

  const canManageUsers = userCanManageUsers();
  document.querySelectorAll("[data-useradmin-only]").forEach((el) => {
    el.classList.toggle("hidden", !canManageUsers);
  });

  document.querySelectorAll("[data-license-module]").forEach((el) => {
    const moduleName = el.dataset.licenseModule;
    const allowed = isModuleAllowed(moduleName);
    el.classList.toggle("module-locked", !allowed);
    el.classList.toggle("module-included", allowed);
    el.setAttribute("aria-disabled", String(!allowed));
    el.title = allowed ? "" : getModuleBlockedMessage(moduleName);
    if (el.classList.contains("module-tile-enabled")) el.tabIndex = allowed ? 0 : -1;
  });
}

function changeView(view) {
  const targetView = document.getElementById(`view-${view}`);
  if (!targetView) return false;

  if (view === "empresas" && !userIsSuperAdmin()) { changeView("dashboard"); return false; }
  if (view === "usuarios" && !userCanManageUsers()) { changeView("dashboard"); return false; }

  const licenseModule = VIEW_LICENSE_MODULES[view];
  if (!isModuleAllowed(licenseModule)) {
    showModuleBlockedMessage(licenseModule);
    changeView("modulos");
    return false;
  }

  document.querySelectorAll(".view").forEach((v) => v.classList.remove("visible"));
  targetView.classList.add("visible");

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  document.getElementById("current-view-title").textContent = VIEW_TITLES[view] || view.toUpperCase();

  if (view === "parqueadero") {
    cargarParqueaderoActivo();
    cargarHistorialParqueadero();
    cargarMensualidadesParqueadero();
  }
  if (view === "dashboard") loadDashboard();
  if (view === "empresas") cargarEmpresas();
  if (view === "usuarios") cargarUsuariosSistema();
  if (view === "lavadero") { loadLavaderoEmpleados(); cargarOrdeneesLavadero(); }
  if (view === "taller") { loadTallerMecanicos(); cargarOrdensTaller(); }
  if (view === "clientes") cargarListaClientes();
  if (view === "empleados") cargarListaEmpleados();
  if (view === "reportes") { setFechasDefecto(); handleGenerarReportes(); }
  if (view === "config") loadConfig();

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

  if (view === "config" && tile.dataset.openConfigTab) setConfigTab(tile.dataset.openConfigTab);
  if (view === "parqueadero" && tile.dataset.parkingFlow) seleccionarFlujoParqueadero(tile.dataset.parkingFlow);
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

  if (selectedTab === "parqueadero") loadParqueaderoConfig();
  if (selectedTab === "licencias") loadLicenciaInfo();
}
