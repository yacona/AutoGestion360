/* =========================================================
   LAVADERO — órdenes de lavado
   Depende de: ui.js, api.js
   ========================================================= */

async function loadLavaderoEmpleados() {
  try {
    const empleados = await apiFetch("/api/empleados?rol=Lavador");
    const select = document.getElementById("lav-lavador");
    if (select) {
      select.innerHTML = '<option value="">Seleccione...</option>';
      empleados.forEach((emp) => {
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
    const historial = await apiFetch("/api/lavadero/historial");
    const busqueda = document.getElementById("lav-buscar")?.value.trim().toLowerCase() || "";
    const ordenesFiltradas = busqueda
      ? ordenes.filter((o) =>
          `${o.placa || ""} ${o.empleado_nombre || ""} ${o.lavador_nombre || ""}`.toLowerCase().includes(busqueda)
        )
      : ordenes;

    const activos = ordenesFiltradas.filter((o) => o.estado !== "Completado");
    const completados = historial.filter((o) => o.estado === "Completado");

    const tbodyActivos = document.getElementById("lav-activos-tbody");
    const emptyActivos = document.getElementById("lav-empty");
    if (tbodyActivos) {
      tbodyActivos.innerHTML = activos.map((ord) => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.tipo_lavado}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${new Date(ord.hora_inicio).toLocaleString()}</td>
          <td>${renderBadge(ord.estado)}</td>
          <td>
            <button type="button" class="btn btn-sm btn-primary" data-lav-action="completar" data-lavado-id="${ord.id}">Completar y cobrar</button>
          </td>
        </tr>
      `).join("");
      emptyActivos.hidden = activos.length > 0;
    }

    const tbodyCompletados = document.getElementById("lav-completados-tbody");
    const emptyCompletados = document.getElementById("lav-completados-empty");
    const busquedaHistorial = document.getElementById("lav-historial-buscar")?.value.trim().toLowerCase() || "";
    const completadosFiltrados = busquedaHistorial
      ? completados.filter((o) =>
          `${o.placa || ""} ${o.tipo_lavado || ""} ${o.tipo_lavado_nombre || ""} ${o.lavador_nombre || ""} ${o.empleado_nombre || ""}`
            .toLowerCase()
            .includes(busquedaHistorial)
        )
      : completados;

    if (tbodyCompletados) {
      tbodyCompletados.innerHTML = completadosFiltrados.map((ord) => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.tipo_lavado_nombre || ord.tipo_lavado}</td>
          <td>${ord.lavador_nombre || ord.empleado_nombre || "Sin asignar"}</td>
          <td>${ord.hora_fin ? Math.max(1, Math.round((new Date(ord.hora_fin) - new Date(ord.hora_inicio)) / 60000)) : "N/A"} min</td>
          <td>${formatMoney(ord.precio)}</td>
          <td>${renderBadge(ord.metodo_pago, "payment")}</td>
        </tr>
      `).join("");
      emptyCompletados.hidden = completadosFiltrados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando órdenes de lavadero:", err);
  }
}

async function marcarLavadoCompleto(id) {
  try {
    await abrirModalCobroServicio("lavadero", id);
  } catch (err) {
    showMessage("lav-msg", err.message, true);
  }
}

let lavaderoEventsBound = false;

function bindLavaderoEvents() {
  if (lavaderoEventsBound) return;
  lavaderoEventsBound = true;

  document.getElementById("form-lavadero-nueva")?.addEventListener("submit", handleNovaLavado);
  document.getElementById("lav-buscar")?.addEventListener("input", () => cargarOrdeneesLavadero());
  document.getElementById("lav-historial-buscar")?.addEventListener("input", () => cargarOrdeneesLavadero());
  document.getElementById("lav-activos-tbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lav-action='completar']");
    if (!button) return;
    marcarLavadoCompleto(button.dataset.lavadoId);
  });
}

window.AG360.registerModule({
  id: "lavadero",
  title: "Lavadero",
  licenseModule: "lavadero",
  icon: "🚿",
  order: 50,
  bindEvents: bindLavaderoEvents,
  onEnter: async () => {
    await loadLavaderoEmpleados();
    await cargarOrdeneesLavadero();
  },
});
