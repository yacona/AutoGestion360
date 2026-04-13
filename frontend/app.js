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

  // Cargar ingresos del día
  try {
    console.log("Cargando ingresos del día...");
    const resumenDia = await apiFetch("/api/reportes/parqueadero/resumen-dia");
    console.log("Resumen del día recibido:", resumenDia);

    const ingresosParqueadero = resumenDia.ingresos_totales || 0;

    // Mostrar ingresos del parqueadero
    document.getElementById("dash-ing-parqueadero").textContent =
      `$${ingresosParqueadero.toLocaleString("es-CO")} COP`;

    // Calcular total (por ahora solo parqueadero, lavadero y taller en 0)
    const ingresosLavadero = 0; // TODO: implementar cuando esté disponible
    const ingresosTaller = 0;   // TODO: implementar cuando esté disponible
    const totalIngresos = ingresosParqueadero + ingresosLavadero + ingresosTaller;

    document.getElementById("dash-ing-lavadero").textContent =
      `$${ingresosLavadero.toLocaleString("es-CO")} COP`;
    document.getElementById("dash-ing-taller").textContent =
      `$${ingresosTaller.toLocaleString("es-CO")} COP`;
    document.getElementById("dash-ing-total").textContent =
      `$${totalIngresos.toLocaleString("es-CO")} COP`;

    console.log("Ingresos actualizados:", { ingresosParqueadero, totalIngresos });
  } catch (err) {
    console.error("Error cargando ingresos:", err);
    // Valores por defecto si falla la carga
    document.getElementById("dash-ing-parqueadero").textContent = "$ 0";
    document.getElementById("dash-ing-lavadero").textContent = "$ 0";
    document.getElementById("dash-ing-taller").textContent = "$ 0";
    document.getElementById("dash-ing-total").textContent = "$ 0";
  }
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
   PARQUEADERO — REGISTRO DE SALIDA (MEJORADO)
   Ahora solicita pago y permite editar datos antes de confirmar
======================================================*/

// Variable global para almacenar datos de pre-salida
let datosPreSalida = null;
let registroId = null;

async function handleSalidaClick(event) {
  const btn = event.target.closest(".pq-salida");
  if (!btn) return;

  const tr = btn.closest("tr");
  registroId = tr?.dataset.id;
  if (!registroId) return;

  try {
    // 1) Obtener pre-cálculo de salida
    const preCalculo = await apiFetch(`/api/parqueadero/${registroId}/pre-salida`, {
      method: "POST",
    });

    datosPreSalida = preCalculo;

    // 2) Llenar modal con datos
    document.getElementById("salida-placa").textContent = preCalculo.placa || "—";
    document.getElementById("salida-tipo").textContent = preCalculo.tipo_vehiculo || "—";
    document.getElementById("salida-cliente").textContent = preCalculo.cliente || "—";
    document.getElementById("salida-hora-entrada").textContent = preCalculo.hora_entrada || "—";
    document.getElementById("salida-hora-salida").textContent = preCalculo.hora_salida || "—";
    document.getElementById("salida-tiempo").textContent = preCalculo.tiempo_estancia || "—";
    document.getElementById("salida-tarifa").textContent = preCalculo.tarifa_aplicada || "—";
    
    // Mostrar descuento si aplica
    if (preCalculo.descuento !== "No aplica") {
      document.getElementById("salida-descuento-info").hidden = false;
      document.getElementById("salida-descuento").textContent = preCalculo.descuento;
      document.getElementById("salida-valor-antes").textContent = 
        `$${preCalculo.valor_antes_descuento.toLocaleString("es-CO")} COP`;
    } else {
      document.getElementById("salida-descuento-info").hidden = true;
    }
    
    document.getElementById("salida-valor").textContent = 
      `$${preCalculo.valor_a_cobrar.toLocaleString("es-CO")} COP`;

    // 3) Limpiar campos de pago
    document.getElementById("pq-metodo-pago").value = "";
    document.getElementById("pq-referencia").value = "";
    document.getElementById("pq-detalle-pago").value = "";
    document.getElementById("pq-obs-salida").value = "";

    // Limpiar form de edición
    document.getElementById("edit-placa").value = preCalculo.placa || "";
    document.getElementById("edit-cliente").value = preCalculo.cliente || "";
    document.getElementById("edit-tipo").value = preCalculo.tipo_vehiculo || "";
    document.getElementById("salida-editar").hidden = true;

    // 4) Mostrar modal
    document.getElementById("modal-salida").classList.remove("hidden");
  } catch (err) {
    console.error("Error obteniendo pre-salida:", err);
    alert(err.message || "Error calculando salida.");
  }
}

function cerrarModalSalida() {
  document.getElementById("modal-salida").classList.add("hidden");
  datosPreSalida = null;
  registroId = null;
}

function toggleEditarRegistro() {
  const seccionEditar = document.getElementById("salida-editar");
  seccionEditar.hidden = !seccionEditar.hidden;
}

async function guardarEdicionRegistro() {
  if (!registroId) return;

  const cambios = {};
  
  const placanueva = document.getElementById("edit-placa").value.trim();
  if (placanueva && placanueva !== datosPreSalida.placa) {
    cambios.placa = placanueva;
  }

  const clientenuevo = document.getElementById("edit-cliente").value.trim();
  if (clientenuevo && clientenuevo !== datosPreSalida.cliente) {
    cambios.nombre_cliente = clientenuevo;
  }

  const tiponuevo = document.getElementById("edit-tipo").value.trim();
  if (tiponuevo && tiponuevo !== datosPreSalida.tipo_vehiculo) {
    cambios.tipo_vehiculo = tiponuevo;
  }

  if (Object.keys(cambios).length === 0) {
    alert("No hay cambios para guardar.");
    return;
  }

  try {
    await apiFetch(`/api/parqueadero/${registroId}`, {
      method: "PATCH",
      body: JSON.stringify(cambios),
    });

    alert("Registro actualizado exitosamente.");
    
    // Recargar pre-salida con nuevos datos
    const preCalculo = await apiFetch(`/api/parqueadero/${registroId}/pre-salida`, {
      method: "POST",
    });
    datosPreSalida = preCalculo;
    
    // Actualizar display
    document.getElementById("salida-placa").textContent = preCalculo.placa || "—";
    document.getElementById("salida-tipo").textContent = preCalculo.tipo_vehiculo || "—";
    document.getElementById("salida-cliente").textContent = preCalculo.cliente || "—";

    document.getElementById("salida-editar").hidden = true;
  } catch (err) {
    console.error("Error actualizando registro:", err);
    alert(err.message || "Error actualizando registro.");
  }
}

async function confirmarSalida() {
  if (!registroId || !datosPreSalida) {
    alert("Error: datos no disponibles.");
    return;
  }

  const metodoPago = document.getElementById("pq-metodo-pago").value.trim();
  if (!metodoPago) {
    alert("Debe seleccionar un método de pago.");
    return;
  }

  const referencia = document.getElementById("pq-referencia").value.trim() || null;
  const detallePago = document.getElementById("pq-detalle-pago").value.trim() || null;
  const observacionesSalida = document.getElementById("pq-obs-salida").value.trim() || null;

  try {
    await apiFetch(`/api/parqueadero/salida/${registroId}`, {
      method: "POST",
      body: JSON.stringify({
        metodo_pago: metodoPago,
        referencia_transaccion: referencia,
        detalle_pago: detallePago,
        observaciones: observacionesSalida,
      }),
    });

    alert("✓ Salida registrada correctamente y pago confirmado.");
    cerrarModalSalida();

    // Recargar tabla de activos
    await cargarParqueaderoActivo();
    await loadDashboard();
  } catch (err) {
    console.error("Error registrando salida:", err);
    alert(err.message || "Error registrando salida.");
  }
}

// Mostrar/ocultar campos adicionales según método de pago
document.addEventListener("DOMContentLoaded", function() {
  const selectPago = document.getElementById("pq-metodo-pago");
  if (selectPago) {
    selectPago.addEventListener("change", function() {
      const referenciaGroup = document.getElementById("pq-referencia-group");
      const detalleGroup = document.getElementById("pq-detalle-pago-group");
      
      if (this.value === "TARJETA" || this.value === "TRANSFERENCIA") {
        referenciaGroup.hidden = false;
      } else {
        referenciaGroup.hidden = true;
      }
      
      if (this.value === "OTRO" || this.value === "MIXTO") {
        detalleGroup.hidden = false;
      } else {
        detalleGroup.hidden = true;
      }
    });
  }
});

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