/* =========================================================
   MAIN
   Bootstrap del shell SPA y coordinacion entre modulos.
   ========================================================= */

let appShellEventsBound = false;
let uppercaseSyncBound = false;

function bindUppercaseSync() {
  if (uppercaseSyncBound) return;
  uppercaseSyncBound = true;

  document.addEventListener("input", (event) => {
    if (event.target.tagName === "INPUT" && event.target.type === "text") {
      event.target.value = event.target.value.toUpperCase();
    }
    if (event.target.tagName === "TEXTAREA") {
      event.target.value = event.target.value.toUpperCase();
    }
  });
}

function bindAppShellEvents() {
  if (appShellEventsBound) return;
  appShellEventsBound = true;

  document.getElementById("login-form")?.addEventListener("submit", handleLogin);
  document.getElementById("btn-logout")?.addEventListener("click", logout);

  document.getElementById("sidebar-nav")?.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-link");
    if (!button) return;

    if (button.classList.contains("module-locked")) {
      showModuleBlockedMessage(button.dataset.licenseModule);
      return;
    }

    changeView(button.dataset.view);
  });
}

function bindRegisteredModules() {
  window.AG360.getModules().forEach((moduleDefinition) => {
    if (typeof moduleDefinition.bindEvents === "function") {
      moduleDefinition.bindEvents();
    }
  });
}

async function bootstrap() {
  bindUppercaseSync();
  initTheme();
  renderSidebar("dashboard");
  bindGlobalUiEvents();
  bindAppShellEvents();
  initModuleCatalog();
  bindRegisteredModules();

  if (hasActiveSession()) {
    showMainView();
    await initAfterLogin();
    return;
  }

  showLoginView();
}

window.AG360.bootstrap = bootstrap;

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((error) => {
    console.error("Error iniciando AutoGestion360:", error);
  });
});
