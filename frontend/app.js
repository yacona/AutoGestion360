// ======================================================
// Autogestión360 - Frontend SPA
// Archivo app.js CORREGIDO
// ======================================================

// 🔧 Cambia esta URL si tu backend usa otro puerto
const API_BASE_URL = "http://localhost:4000";

// Keys usadas en localStorage
const STORAGE = {
  TOKEN: "ag360_token",
  EMAIL: "ag360_user_email",
  EMPRESA: "ag360_empresa_nombre",
};

/* ======================================================
   HELPER GENERAL PARA PETICIONES
======================================================*/
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem(STORAGE.TOKEN);
  const headers = options.headers || {};

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }

  const requestOptions = {
    ...options,
    headers,
  };

  if (options.body instanceof FormData) {
    delete requestOptions.headers["Content-Type"];
  }

  const res = await fetch(`${API_BASE_URL}${path}`, requestOptions);

  if (res.status === 401) {
    logout();
    throw new Error("No autorizado. Debe iniciar sesión.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.message || "Error en la petición");
  }

  return data;
}

/* ======================================================
   INICIO DE SESIÓN
======================================================*/
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

    showMainView();
    initAfterLogin();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

function logout() {
  localStorage.removeItem(STORAGE.TOKEN);
  localStorage.removeItem(STORAGE.EMAIL);
  showLoginView();
}

/* ======================================================
   VISTAS SPA
======================================================*/
function showLoginView() {
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("main-view").classList.add("hidden");
}

function showMainView() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
}

function changeView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("visible"));
  document.getElementById(`view-${view}`).classList.add("visible");

  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  document.getElementById("current-view-title").textContent = view.toUpperCase();

  if (view === "parqueadero") {
    cargarParqueaderoActivo();   // ✅ nombre correcto
  }
  if (view === "dashboard") {
    loadDashboard();
  }
}

/* ======================================================
   DASHBOARD
======================================================*/
function formatMoney(value) {
  return Number(value).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

async function loadDashboard() {
  try {
    const activos = await apiFetch("/api/parqueadero/activo");
    document.getElementById("dash-parqueadero-count").textContent = activos.length;
  } catch {}

  try {
    const lavados = await apiFetch("/api/lavadero?estado=En_Proceso");
    document.getElementById("dash-lavados-count").textContent = lavados.length;
  } catch {}

  try {
    const taller = await apiFetch("/api/taller");
    document.getElementById("dash-taller-count").textContent =
      taller.filter(t => t.estado !== "Entregado").length;
  } catch {}
}
/* ======================================================
Procesar PLACA
======================================================*/
document.getElementById("pq-placa").addEventListener("blur", async function () {
  const placa = this.value.trim().toUpperCase();
  if (!placa) return;

  try {
    const data = await apiFetch(`/api/parqueadero/buscar/${placa}`);
    procesarPlacaParqueadero(data);
  } catch (err) {
    console.error("Error consultando placa:", err);
  }
});

function procesarPlacaParqueadero(data) {
  const existe = data.existe;
  const vehiculo = data.vehiculo;
  const propietario = data.propietario;
  const historial = data.historial;
  const msgEl = document.getElementById("pq-msg");
  const histEl = document.getElementById("pq-historial");

  if (msgEl) {
    msgEl.hidden = true;
    msgEl.textContent = "";
  }
  if (histEl) {
    histEl.hidden = true;
    histEl.textContent = "";
  }

  const tipoEl = document.getElementById("pq-tipo");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");

  if (tipoEl) tipoEl.value = "";
  if (nombreEl) nombreEl.value = "";
  if (telEl) telEl.value = "";

  if (existe) {
    if (tipoEl) tipoEl.value = vehiculo.tipo_vehiculo || "";

    if (propietario) {
      if (nombreEl) nombreEl.value = propietario.nombre || "";
      if (telEl) telEl.value = propietario.telefono || "";
    }

    if (histEl) {
      mostrarHistorialVehiculo(histEl, historial);
    }

    if (msgEl) {
      msgEl.hidden = false;
      msgEl.textContent = "Vehículo existente. El sistema cargó datos previos y el historial.";
      msgEl.classList.remove("error");
      msgEl.classList.add("ok");
    }
  } else {
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.textContent = "Vehículo nuevo. Complete los datos y registre la entrada.";
      msgEl.classList.remove("error");
      msgEl.classList.add("ok");
    }
  }
}

function mostrarHistorialVehiculo(element, historial) {
  if (!element) return;
  if (!historial) {
    element.hidden = true;
    return;
  }

  const parqueoCount = Array.isArray(historial.parqueadero)
    ? historial.parqueadero.length
    : 0;
  const lavaderoCount = Array.isArray(historial.lavadero)
    ? historial.lavadero.length
    : 0;
  const tallerCount = Array.isArray(historial.taller)
    ? historial.taller.length
    : 0;

  element.hidden = false;
  element.innerHTML = `Vehículo con historial: ${parqueoCount} parqueadero(s), ${lavaderoCount} lavadero(s), ${tallerCount} taller(es). Si hay un nuevo propietario, habilite la casilla y actualice el nombre.`;
}


/* ======================================================
   PARQUEADERO — REGISTRO DE ENTRADA
======================================================*/
async function handleEntradaParqueadero(event) {
  event.preventDefault();

  const placaEl = document.getElementById("pq-placa");
  const tipoEl = document.getElementById("pq-tipo");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");
  const propEl = document.getElementById("pq-es-propietario");
  const obsEl = document.getElementById("pq-obs");
  const msgEl = document.getElementById("pq-msg");

  msgEl.hidden = true;
  msgEl.textContent = "";

  const placa = placaEl.value.trim().toUpperCase().replace(/\s+/g, "");
  const tipo_vehiculo = tipoEl.value.trim().toUpperCase();
  const nombre_cliente = nombreEl.value.trim().toUpperCase();
  const telefono = telEl.value.trim();
  const es_propietario = propEl.checked;
  const observaciones = obsEl.value.trim().toUpperCase();

  if (!placa || !tipo_vehiculo) {
    msgEl.textContent = "Placa y tipo de vehículo son obligatorios.";
    msgEl.hidden = false;
    msgEl.classList.remove("ok");
    msgEl.classList.add("error");
    return;
  }

  if (!nombre_cliente) {
    msgEl.textContent = "Debe indicar el nombre del propietario/conductor.";
    msgEl.hidden = false;
    msgEl.classList.remove("ok");
    msgEl.classList.add("error");
    return;
  }

  const evidenciaEl = document.getElementById("pq-evidencia");
  const evidenciaFile = evidenciaEl?.files?.[0] || null;

  try {
    const formData = new FormData();
    formData.append("placa", placa);
    formData.append("tipo_vehiculo", tipo_vehiculo);
    formData.append("es_conductor_propietario", String(es_propietario));
    formData.append("observaciones", observaciones || "");
    formData.append("propietario_nombre", nombre_cliente);
    formData.append("propietario_telefono", telefono || "");
    formData.append("propietario_documento", "SIN_DOCUMENTO");

    if (!es_propietario) {
      formData.append("conductor_nombre", nombre_cliente);
      formData.append("conductor_telefono", telefono || "");
      formData.append("conductor_documento", "SIN_DOCUMENTO");
    }

    if (evidenciaFile) {
      formData.append("evidencia", evidenciaFile);
    }

    await apiFetch("/api/parqueadero/entrada", {
      method: "POST",
      body: formData,
    });

    msgEl.textContent = "Entrada registrada correctamente.";
    msgEl.hidden = false;
    msgEl.classList.remove("error");
    msgEl.classList.add("ok");

    nombreEl.value = "";
    telEl.value = "";
    obsEl.value = "";
    if (evidenciaEl) evidenciaEl.value = "";
    propEl.checked = true;

    await cargarParqueaderoActivo();   // ✅ ahora sí existe
  } catch (err) {
    console.error("Error en handleEntradaParqueadero:", err);
    msgEl.textContent = err.message || "Error registrando entrada.";
    msgEl.hidden = false;
    msgEl.classList.remove("ok");
    msgEl.classList.add("error");
  }
  
}

/* ======================================================
   PARQUEADERO — CARGAR VEHÍCULOS ACTIVOS
======================================================*/
async function cargarParqueaderoActivo() {
  const tbody = document.getElementById("pq-tbody");
  const empty = document.getElementById("pq-empty");

  if (!tbody || !empty) return;

  try {
    const data = await apiFetch("/api/parqueadero/activo");  // ✅ usa apiFetch

    tbody.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      empty.style.display = "block";
      empty.innerText = "No hay vehículos registrados actualmente.";
      return;
    }

    empty.style.display = "none";

    data.forEach(item => {
      const tr = document.createElement("tr");
      tr.dataset.id = item.id;

      tr.innerHTML = `
        <td>${item.placa}</td>
        <td>${item.tipo_vehiculo}</td>
        <td>${item.nombre_cliente || "-"}</td>
        <td>${new Date(item.hora_entrada).toLocaleString()}</td>
        <td>-</td>
        <td>
          <button class="btn btn-success btn-sm pq-salida">
            Registrar salida
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Error cargando parqueadero:", e);
    empty.style.display = "block";
    empty.innerText = "Error cargando datos del parqueadero.";
  }
}

/* ======================================================
   PARQUEADERO — REGISTRO DE SALIDA (simple)
======================================================*/
async function handleSalidaClick(event) {
  const btn = event.target.closest(".pq-salida");
  if (!btn) return;

  const tr = btn.closest("tr");
  const id = tr?.dataset.id;
  if (!id) return;

  if (!confirm("¿Registrar salida de este vehículo?")) return;

  try {
    await apiFetch(`/api/parqueadero/salida/${id}`, {
      method: "POST",
      body: JSON.stringify({ metodo_pago: null, detalle_pago: null }),
    });

    await cargarParqueaderoActivo();   // ✅ recarga listado
    await loadDashboard();             // opcional, refresca contador
  } catch (err) {
    console.error("Error registrando salida:", err);
    alert(err.message || "Error registrando salida.");
  }
}

/* ======================================================
   FORZAR MAYÚSCULAS EN ENTRADAS
======================================================*/
document.addEventListener("input", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type === "text") {
    e.target.value = e.target.value.toUpperCase();
  }
  if (e.target.tagName === "TEXTAREA") {
    e.target.value = e.target.value.toUpperCase();
  }
});

/* ======================================================
   INICIALIZACIÓN GLOBAL
======================================================*/
document.addEventListener("DOMContentLoaded", () => {
  // Login
  const loginForm = document.getElementById("login-form");
  loginForm?.addEventListener("submit", handleLogin);

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", logout);

  // Navegación
  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.addEventListener("click", () => changeView(btn.dataset.view));
  });

  // Entrada parqueadero
  document
    .getElementById("form-parqueadero-entrada")
    ?.addEventListener("submit", handleEntradaParqueadero);

  // Click en botones de salida
  document
    .getElementById("pq-tbody")
    ?.addEventListener("click", handleSalidaClick);

  const token = localStorage.getItem(STORAGE.TOKEN);
  if (token) {
    showMainView();
    initAfterLogin();
  } else {
    showLoginView();
  }
});

function initAfterLogin() {
  const empresa = localStorage.getItem(STORAGE.EMPRESA);
  if (empresa) document.getElementById("sidebar-empresa").textContent = empresa;

  const email = localStorage.getItem(STORAGE.EMAIL);
  if (email) document.getElementById("user-info-label").textContent = email;

  changeView("dashboard");
}