/* =========================================================
   TALLER — órdenes de taller
   Depende de: ui.js, api.js
   ========================================================= */

async function loadTallerMecanicos() {
  try {
    const empleados = await apiFetch("/api/empleados?rol=Mecánico");
    const select = document.getElementById("tal-mecanico");
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
    const activos = ordenes.filter((o) => o.estado !== "Entregado");
    const completados = ordenes.filter((o) => o.estado === "Entregado");

    const tbodyActivos = document.getElementById("tal-activos-tbody");
    const emptyActivos = document.getElementById("tal-empty");
    if (tbodyActivos) {
      tbodyActivos.innerHTML = activos.map((ord) => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.descripcion}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${formatMoney(ord.total_general)}</td>
          <td>${renderBadge(ord.estado)}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="completarOrdenTaller(${ord.id})">Entregar y cobrar</button>
          </td>
        </tr>
      `).join("");
      emptyActivos.hidden = activos.length > 0;
    }

    const tbodyCompletados = document.getElementById("tal-completados-tbody");
    const emptyCompletados = document.getElementById("tal-completados-empty");
    const busquedaHistorial = document.getElementById("tal-historial-buscar")?.value.trim().toLowerCase() || "";
    const completadosFiltrados = busquedaHistorial
      ? completados.filter((o) =>
          `${o.placa || ""} ${o.empleado_nombre || ""} ${o.descripcion || ""}`.toLowerCase().includes(busquedaHistorial)
        )
      : completados;

    if (tbodyCompletados) {
      tbodyCompletados.innerHTML = completadosFiltrados.map((ord) => `
        <tr>
          <td>${ord.placa}</td>
          <td>${ord.descripcion}</td>
          <td>${ord.empleado_nombre || "Sin asignar"}</td>
          <td>${formatMoney(ord.total_general)}</td>
          <td>${new Date(ord.fecha_entrega).toLocaleDateString()}</td>
          <td>${renderBadge(ord.metodo_pago, "payment")}</td>
        </tr>
      `).join("");
      emptyCompletados.hidden = completadosFiltrados.length > 0;
    }
  } catch (err) {
    console.error("Error cargando órdenes de taller:", err);
  }
}

async function completarOrdenTaller(id) {
  try {
    await abrirModalCobroServicio("taller", id);
  } catch (err) {
    showMessage("tal-msg", err.message, true);
  }
}
