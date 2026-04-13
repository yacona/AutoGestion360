// ======================================================
// Autogestión360 - Frontend SPA
// Archivo app.js CORREGIDO
// ======================================================

const API_BASE_URL = window.location.origin;

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
    cargarParqueaderoActivo();
  }
  if (view === "dashboard") {
    loadDashboard();
  }
  if (view === "lavadero") {
    loadLavaderoEmpleados();
    cargarOrdeneesLavadero();
  }
  if (view === "taller") {
    loadTallerMecanicos();
    cargarOrdensTaller();
  }
  if (view === "clientes") {
    cargarListaClientes();
  }
  if (view === "empleados") {
    cargarListaEmpleados();
  }
  if (view === "reportes") {
    setFechasDefecto();
  }
}

// Función para limpiar el formulario de parqueadero
function limpiarFormularioParqueadero() {
  const placaEl = document.getElementById("pq-placa");
  const tipoEl = document.getElementById("pq-tipo");
  const nombreEl = document.getElementById("pq-nombre");
  const telEl = document.getElementById("pq-telefono");
  const propEl = document.getElementById("pq-es-propietario");
  const obsEl = document.getElementById("pq-obs");
  const evidenciaEl = document.getElementById("pq-evidencia");
  const msgEl = document.getElementById("pq-msg");
  const histEl = document.getElementById("pq-historial");

  // Limpiar todos los campos
  if (placaEl) placaEl.value = "";
  if (tipoEl) tipoEl.value = "CARRO"; // Resetear al valor por defecto
  if (nombreEl) nombreEl.value = "";
  if (telEl) telEl.value = "";
  if (obsEl) obsEl.value = "";
  if (evidenciaEl) evidenciaEl.value = "";
  if (propEl) propEl.checked = true; // Resetear a "es propietario" por defecto

  // Limpiar mensajes
  if (msgEl) {
    msgEl.hidden = true;
    msgEl.textContent = "";
  }
  if (histEl) {
    histEl.hidden = true;
    histEl.textContent = "";
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
    const resumenDia = await apiFetch("/api/reportes/parqueadero/resumen-dia");
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

    // Limpiar todos los campos del formulario para el siguiente vehículo
    placaEl.value = "";
    tipoEl.value = "CARRO"; // Resetear al valor por defecto
    nombreEl.value = "";
    telEl.value = "";
    obsEl.value = "";
    if (evidenciaEl) evidenciaEl.value = "";
    propEl.checked = true; // Resetear a "es propietario" por defecto

    // Recargar la tabla de vehículos activos para mostrar el nuevo registro
    await cargarParqueaderoActivo();

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
      document.getElementById("salida-valor-antes-info").hidden = false;
      document.getElementById("salida-descuento").textContent = preCalculo.descuento;
      document.getElementById("salida-valor-antes").textContent = 
        `$${preCalculo.valor_antes_descuento.toLocaleString("es-CO")} COP`;
    } else {
      document.getElementById("salida-descuento-info").hidden = true;
      document.getElementById("salida-valor-antes-info").hidden = true;
      document.getElementById("salida-descuento").textContent = "";
      document.getElementById("salida-valor-antes").textContent = "";
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

  // Lavadero
  document
    .getElementById("form-lavadero-nueva")
    ?.addEventListener("submit", handleNovaLavado);

  document
    .getElementById("lav-buscar")
    ?.addEventListener("input", () => cargarOrdeneesLavadero());

  // Taller
  document
    .getElementById("form-taller-nueva")
    ?.addEventListener("submit", handleNuevaOrdenTaller);

  // Clientes
  document
    .getElementById("form-cliente-nuevo")
    ?.addEventListener("submit", handleNuevoCliente);

  document
    .getElementById("cli-buscar")
    ?.addEventListener("input", filtrarClientes);

  // Empleados
  document
    .getElementById("form-empleado-nuevo")
    ?.addEventListener("submit", handleNuevoEmpleado);

  document
    .getElementById("emp-filtro-rol")
    ?.addEventListener("change", filtrarEmpleadosPorRol);

  // Reportes
  document
    .getElementById("form-rep-filtro")
    ?.addEventListener("submit", handleGenerarReportes);

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

/* ======================================================
   MÓDULO LAVADERO
======================================================*/
async function loadLavaderoEmpleados() {
  try {
    const empleados = await apiFetch("/api/empleados?rol=Lavador");
    const select = document.getElementById("lav-lavador");
    if (select) {
      select.innerHTML = '<option value="">Seleccione...</option>';
      empleados.forEach(emp => {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.nombre;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error cargando lavadores:", err);
  }
}

async function handleNovaLavado(event) {
  event.preventDefault();
  const placa = document.getElementById("lav-placa").value.trim();
  const tipo = document.getElementById("lav-tipo").value;
  const lavador_id = document.getElementById("lav-lavador").value;
  const obs = document.getElementById("lav-obs").value;
  
  if (!placa || !tipo || !lavador_id) {
    showMessage("lav-msg", "Todos los campos obligatorios deben estar completos.", true);
    return;
  }

  try {
    await apiFetch("/api/lavadero", {
      method: "POST",
      body: JSON.stringify({ placa, tipo_lavado: tipo, empleado_id: lavador_id, notas: obs }),
    });
    showMessage("lav-msg", "Orden de lavado registrada exitosamente.");
    event.target.reset();
    cargarOrdeneesLavadero();
  } catch (err) {
    showMessage("lav-msg", err.message, true);
  }
}

async function cargarOrdeneesLavadero() {
  try {
    const ordenes = await apiFetch("/api/lavadero");
    const activos = ordenes.filter(o => o.estado !== "Completado");
    const completados = ordenes.filter(o => o.estado === "Completado" && new Date(o.hora_fin || o.creado_en).toDateString() === new Date().toDateString());

    // Tabla activos
    const tbodyActivos = document.getElementById("lav-activos-tbody");
    const emptyActivos = document.getElementById("lav-empty");
    if (tbodyActivos) {
      tbodyActivos.innerHTML = activos.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.tipo_lavado}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${new Date(ord.hora_inicio).toLocaleString()}</td>
          <td><span class="badge">${ord.estado}</span></td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="marcarLavadoCompleto(${ord.id})">Completar</button>
          </td>
        </tr>
      `).join("");
      emptyActivos.hidden = activos.length > 0;
    }

    // Tabla completados
    const tbodyCompletados = document.getElementById("lav-completados-tbody");
    const emptyCompletados = document.getElementById("lav-completados-empty");
    if (tbodyCompletados) {
      tbodyCompletados.innerHTML = completados.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.tipo_lavado}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${ord.duracion_minutos || "N/A"} min</td>
          <td>${formatMoney(ord.precio)}</td>
          <td>${ord.estado_pago || "No pagado"}</td>
        </tr>
      `).join("");
      emptyCompletados.hidden = completados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando órdenes de lavadero:", err);
  }
}

async function marcarLavadoCompleto(id) {
  try {
    await apiFetch(`/api/lavadero/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ estado: "Completado" }),
    });
    cargarOrdeneesLavadero();
    showMessage("lav-msg", "Lavado marcado como completado.");
  } catch (err) {
    showMessage("lav-msg", err.message, true);
  }
}

/* ======================================================
   MÓDULO TALLER
======================================================*/
async function loadTallerMecanicos() {
  try {
    const empleados = await apiFetch("/api/empleados?rol=Mecánico");
    const select = document.getElementById("tal-mecanico");
    if (select) {
      select.innerHTML = '<option value="">Seleccione...</option>';
      empleados.forEach(emp => {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.nombre;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error cargando mecánicos:", err);
  }
}

async function handleNuevaOrdenTaller(event) {
  event.preventDefault();
  const placa = document.getElementById("tal-placa").value.trim();
  const descripcion = document.getElementById("tal-descripcion").value;
  const mecanico_id = document.getElementById("tal-mecanico").value;
  const valor = parseFloat(document.getElementById("tal-valor").value);
  const notas = document.getElementById("tal-notas").value;

  if (!placa || !descripcion || !mecanico_id || !valor) {
    showMessage("tal-msg", "Todos los campos obligatorios deben estar completos.", true);
    return;
  }

  try {
    await apiFetch("/api/taller", {
      method: "POST",
      body: JSON.stringify({ placa, descripcion, empleado_id: mecanico_id, total_general: valor, notas }),
    });
    showMessage("tal-msg", "Orden de taller registrada exitosamente.");
    event.target.reset();
    cargarOrdensTaller();
  } catch (err) {
    showMessage("tal-msg", err.message, true);
  }
}

async function cargarOrdensTaller() {
  try {
    const ordenes = await apiFetch("/api/taller");
    const activos = ordenes.filter(o => o.estado !== "Entregado");
    const completados = ordenes.filter(o => o.estado === "Entregado");

    // Tabla activos
    const tbodyActivos = document.getElementById("tal-activos-tbody");
    const emptyActivos = document.getElementById("tal-empty");
    if (tbodyActivos) {
      tbodyActivos.innerHTML = activos.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.descripcion}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${formatMoney(ord.total_general)}</td>
          <td><span class="badge">${ord.estado}</span></td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="completarOrdenTaller(${ord.id})">Completar</button>
          </td>
        </tr>
      `).join("");
      emptyActivos.hidden = activos.length > 0;
    }

    // Tabla completados
    const tbodyCompletados = document.getElementById("tal-completados-tbody");
    const emptyCompletados = document.getElementById("tal-completados-empty");
    if (tbodyCompletados) {
      tbodyCompletados.innerHTML = completados.map(ord => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.descripcion}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${formatMoney(ord.total_general)}</td>
          <td>${new Date(ord.fecha_entrega).toLocaleDateString()}</td>
        </tr>
      `).join("");
      emptyCompletados.hidden = completados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando órdenes de taller:", err);
  }
}

async function completarOrdenTaller(id) {
  try {
    await apiFetch(`/api/taller/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ estado: "Entregado" }),
    });
    cargarOrdensTaller();
    showMessage("tal-msg", "Orden marcada como completada.");
  } catch (err) {
    showMessage("tal-msg", err.message, true);
  }
}

/* ======================================================
   MÓDULO CLIENTES
======================================================*/
async function handleNuevoCliente(event) {
  event.preventDefault();
  const nombre = document.getElementById("cli-nombre").value.trim();
  const documento = document.getElementById("cli-documento").value.trim();
  const telefono = document.getElementById("cli-telefono").value.trim();
  const email = document.getElementById("cli-email").value.trim();

  if (!nombre) {
    showMessage("cli-msg", "El nombre es obligatorio.", true);
    return;
  }

  try {
    await apiFetch("/api/clientes", {
      method: "POST",
      body: JSON.stringify({ nombre, documento: documento || null, telefono: telefono || null, correo: email || null }),
    });
    showMessage("cli-msg", "Cliente registrado exitosamente.");
    event.target.reset();
    cargarListaClientes();
  } catch (err) {
    showMessage("cli-msg", err.message, true);
  }
}

async function cargarListaClientes() {
  try {
    const clientes = await apiFetch("/api/clientes");
    const tbody = document.getElementById("cli-lista-tbody");
    const empty = document.getElementById("cli-lista-empty");

    if (tbody) {
      tbody.innerHTML = clientes.map(cli => `
        <tr>
          <td>${cli.nombre}</td>
          <td>${cli.documento || "N/A"}</td>
          <td>${cli.telefono || "N/A"}</td>
          <td>${cli.correo || "N/A"}</td>
          <td>${cli.total_servicios || 0}</td>
          <td>${new Date(cli.fecha_registro).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm btn-secondary" onclick="verDetallesCliente(${cli.id})">Ver</button>
          </td>
        </tr>
      `).join("");
      empty.hidden = clientes.length > 0;
    }
  } catch (err) {
    console.error("Error cargando clientes:", err);
  }
}

function filtrarClientes() {
  const buscar = document.getElementById("cli-buscar").value.toLowerCase();
  const filas = document.querySelectorAll("#cli-lista-tbody tr");
  filas.forEach(fila => {
    const texto = fila.textContent.toLowerCase();
    fila.style.display = texto.includes(buscar) ? "" : "none";
  });
}

async function verDetallesCliente(id) {
  try {
    const cliente = await apiFetch(`/api/clientes/${id}`);
    alert(`Cliente: ${cliente.cliente.nombre}\nTeléfono: ${cliente.cliente.telefono}\nEmail: ${cliente.cliente.correo}\nTotal gastado: ${formatMoney(cliente.estadisticas.total_gastado)}`);
  } catch (err) {
    alert("Error cargando detalles: " + err.message);
  }
}

/* ======================================================
   MÓDULO EMPLEADOS
======================================================*/
async function handleNuevoEmpleado(event) {
  event.preventDefault();
  const nombre = document.getElementById("emp-nombre").value.trim();
  const rol = document.getElementById("emp-rol").value;
  const telefono = document.getElementById("emp-telefono").value.trim();
  const email = document.getElementById("emp-email").value.trim();

  if (!nombre || !rol) {
    showMessage("emp-msg", "Nombre y rol son obligatorios.", true);
    return;
  }

  try {
    await apiFetch("/api/empleados", {
      method: "POST",
      body: JSON.stringify({ nombre, rol, telefono: telefono || null, email: email || null }),
    });
    showMessage("emp-msg", "Empleado registrado exitosamente.");
    event.target.reset();
    cargarListaEmpleados();
    loadLavaderoEmpleados();
    loadTallerMecanicos();
  } catch (err) {
    showMessage("emp-msg", err.message, true);
  }
}

async function cargarListaEmpleados() {
  try {
    const empleados = await apiFetch("/api/empleados");
    const tbody = document.getElementById("emp-lista-tbody");
    const empty = document.getElementById("emp-lista-empty");

    if (tbody) {
      tbody.innerHTML = empleados.map(emp => `
        <tr>
          <td>${emp.nombre}</td>
          <td>${emp.rol}</td>
          <td>${emp.telefono || "N/A"}</td>
          <td>${emp.email || "N/A"}</td>
          <td>${new Date(emp.fecha_registro || emp.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="desactivarEmpleado(${emp.id})">Desactivar</button>
          </td>
        </tr>
      `).join("");
      empty.hidden = empleados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando empleados:", err);
  }
}

function filtrarEmpleadosPorRol() {
  const rol = document.getElementById("emp-filtro-rol").value;
  const filas = document.querySelectorAll("#emp-lista-tbody tr");
  filas.forEach(fila => {
    const texto = fila.cells[1].textContent.toLowerCase();
    fila.style.display = !rol || texto.includes(rol.toLowerCase()) ? "" : "none";
  });
}

async function desactivarEmpleado(id) {
  if (!confirm("¿Desactivar este empleado?")) return;
  try {
    await apiFetch(`/api/empleados/${id}`, {
      method: "DELETE",
    });
    cargarListaEmpleados();
    showMessage("emp-msg", "Empleado desactivado.");
  } catch (err) {
    showMessage("emp-msg", err.message, true);
  }
}

/* ======================================================
   MÓDULO REPORTES
======================================================*/
function setFechasDefecto() {
  const hoy = new Date();
  const hace30 = new Date(hoy);
  hace30.setDate(hace30.getDate() - 30);

  document.getElementById("rep-desde").valueAsDate = hace30;
  document.getElementById("rep-hasta").valueAsDate = hoy;
}

async function handleGenerarReportes(event) {
  event.preventDefault();
  const desde = document.getElementById("rep-desde").value;
  const hasta = document.getElementById("rep-hasta").value;

  if (!desde || !hasta) {
    alert("Seleccione rango de fechas.");
    return;
  }

  try {
    const resumen = await apiFetch(`/api/reportes/resumen?desde=${desde}&hasta=${hasta}`);
    const diario = await apiFetch(`/api/reportes/diario?desde=${desde}&hasta=${hasta}`);
    const clientes = await apiFetch(`/api/reportes/clientes?desde=${desde}&hasta=${hasta}`);
    const empleados = await apiFetch(`/api/reportes/empleados?desde=${desde}&hasta=${hasta}`);

    // Mostrar resumen
    document.getElementById("rep-pq-total").textContent = formatMoney(resumen.parqueadero.total);
    document.getElementById("rep-pq-cant").textContent = `${resumen.parqueadero.cantidad} servicios`;
    document.getElementById("rep-lav-total").textContent = formatMoney(resumen.lavadero.total);
    document.getElementById("rep-lav-cant").textContent = `${resumen.lavadero.cantidad} servicios`;
    document.getElementById("rep-tal-total").textContent = formatMoney(resumen.taller.total);
    document.getElementById("rep-tal-cant").textContent = `${resumen.taller.cantidad} servicios`;
    document.getElementById("rep-total").textContent = formatMoney(resumen.total_general);
    document.getElementById("rep-cant-total").textContent = `${resumen.cantidad_total} servicios`;

    // Mostrar diario
    const tbodyDiario = document.getElementById("rep-diario-tbody");
    if (tbodyDiario) {
      tbodyDiario.innerHTML = diario.dias.map(dia => `
        <tr>
          <td>${dia.fecha}</td>
          <td>${formatMoney(dia.parqueadero.total)}</td>
          <td>${formatMoney(dia.lavadero.total)}</td>
          <td>${formatMoney(dia.taller.total)}</td>
          <td><strong>${formatMoney(dia.total_general)}</strong></td>
        </tr>
      `).join("");
      document.getElementById("rep-diario-empty").hidden = diario.dias.length > 0;
    }

    // Mostrar clientes
    const tbodyClientes = document.getElementById("rep-clientes-tbody");
    if (tbodyClientes) {
      tbodyClientes.innerHTML = clientes.clientes.map(cli => `
        <tr>
          <td>${cli.nombre}</td>
          <td>${cli.total_servicios}</td>
          <td>${formatMoney(cli.total_gastado)}</td>
        </tr>
      `).join("");
      document.getElementById("rep-clientes-empty").hidden = clientes.clientes.length > 0;
    }

    // Mostrar empleados
    const tbodyEmpleados = document.getElementById("rep-empleados-tbody");
    if (tbodyEmpleados) {
      tbodyEmpleados.innerHTML = empleados.empleados.map(emp => `
        <tr>
          <td>${emp.nombre}</td>
          <td>${emp.rol}</td>
          <td>${Math.max(emp.lavados_realizados || 0, emp.ordenes_taller || 0)}</td>
          <td>${formatMoney(emp.total_general)}</td>
        </tr>
      `).join("");
      document.getElementById("rep-empleados-empty").hidden = empleados.empleados.length > 0;
    }
  } catch (err) {
    alert("Error generando reportes: " + err.message);
  }
}

/* ======================================================
   UTILIDADES
======================================================*/
function showMessage(elementId, message, isError = false) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.className = "small-message " + (isError ? "error" : "ok");
    el.hidden = false;
    setTimeout(() => (el.hidden = true), 4000);
  }
}
