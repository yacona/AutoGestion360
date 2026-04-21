/* =========================================================
   STORAGE / APP REGISTRY
   Contratos compartidos y utilidades base de localStorage.
   ========================================================= */

const STORAGE = {
  TOKEN: "ag360_token",
  EMAIL: "ag360_user_email",
  EMPRESA: "ag360_empresa_nombre",
  LICENSE: "ag360_license_permissions",
  THEME: "ag360_theme",
};

(function initAppRegistry(global) {
  const app = global.AG360 || {};
  const moduleRegistry = app.moduleRegistry || {};

  function registerModule(definition) {
    if (!definition || !definition.id) {
      throw new Error("Cada modulo debe registrarse con un id.");
    }

    moduleRegistry[definition.id] = {
      order: 100,
      menu: true,
      ...definition,
    };

    return moduleRegistry[definition.id];
  }

  function getModule(id) {
    return moduleRegistry[id] || null;
  }

  function getModules() {
    return Object.values(moduleRegistry).sort((a, b) => {
      if (a.order === b.order) {
        return String(a.id).localeCompare(String(b.id));
      }
      return Number(a.order || 0) - Number(b.order || 0);
    });
  }

  const storage = {
    get(key, fallback = "") {
      const value = global.localStorage.getItem(key);
      return value === null ? fallback : value;
    },
    set(key, value) {
      global.localStorage.setItem(key, value);
      return value;
    },
    remove(key) {
      global.localStorage.removeItem(key);
    },
    getJSON(key, fallback = null) {
      try {
        const raw = global.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    setJSON(key, value) {
      global.localStorage.setItem(key, JSON.stringify(value));
      return value;
    },
  };

  global.AG360 = {
    ...app,
    config: {
      apiBaseUrl: global.location.origin,
      ...app.config,
    },
    core: {
      ...app.core,
      storage,
    },
    registerModule,
    getModule,
    getModules,
    moduleRegistry,
  };
})(window);
