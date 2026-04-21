/* =========================================================
   EMPLEADOS
   Depende de: ui.js, api.js
   ========================================================= */

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
      tbody.innerHTML = empleados.map((emp) => `
        <tr>
          <td>${emp.nombre}</td>
          <td>${emp.rol}</td>
          <td>${emp.telefono || "N/A"}</td>
          <td>${emp.email || "N/A"}</td>
          <td>${new Date(emp.fecha_registro || emp.created_at).toLocaleDateString()}</td>
          <td>
            <button type="button" class="btn btn-sm btn-danger" data-empleado-action="desactivar" data-empleado-id="${emp.id}">Desactivar</button>
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
  document.querySelectorAll("#emp-lista-tbody tr").forEach((fila) => {
    const texto = fila.cells[1].textContent.toLowerCase();
    fila.style.display = !rol || texto.includes(rol.toLowerCase()) ? "" : "none";
  });
}

async function desactivarEmpleado(id) {
  if (!confirm("¿Desactivar este empleado?")) return;
  try {
    await apiFetch(`/api/empleados/${id}`, { method: "DELETE" });
    cargarListaEmpleados();
    showMessage("emp-msg", "Empleado desactivado.");
  } catch (err) {
    showMessage("emp-msg", err.message, true);
  }
}

let empleadosEventsBound = false;

function bindEmpleadosEvents() {
  if (empleadosEventsBound) return;
  empleadosEventsBound = true;

  document.getElementById("form-empleado-nuevo")?.addEventListener("submit", handleNuevoEmpleado);
  document.getElementById("emp-filtro-rol")?.addEventListener("change", filtrarEmpleadosPorRol);
  document.getElementById("emp-lista-tbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-empleado-action='desactivar']");
    if (!button) return;
    desactivarEmpleado(button.dataset.empleadoId);
  });
}

window.AG360.registerModule({
  id: "empleados",
  title: "Empleados",
  licenseModule: "empleados",
  icon: "🧑‍🔧",
  order: 90,
  bindEvents: bindEmpleadosEvents,
  onEnter: cargarListaEmpleados,
});
