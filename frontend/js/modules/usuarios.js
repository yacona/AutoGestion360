/* =========================================================
   USUARIOS — gestión de usuarios del sistema
   Depende de: ui.js, api.js, auth.js, empresas.js
   ========================================================= */

let usuariosSistemaData = [];

function getUsuarioSistemaPayload(includePassword = true) {
  const payload = {
    nombre: document.getElementById("usuario-nombre")?.value.trim(),
    email: document.getElementById("usuario-email")?.value.trim(),
    rol: document.getElementById("usuario-rol")?.value || "Operador",
    activo: document.getElementById("usuario-activo")?.value !== "false",
  };

  if (userIsSuperAdmin()) {
    payload.empresa_id = Number(document.getElementById("usuario-empresa")?.value || 0);
  }

  const password = document.getElementById("usuario-password")?.value.trim();
  if (includePassword || password) payload.password = password;

  return payload;
}

function populateUsuarioEmpresaSelect(empresas = empresasAdminData) {
  const select = document.getElementById("usuario-empresa");
  if (!select) return;
  select.innerHTML = empresas.map((e) =>
    `<option value="${e.id}">${e.nombre}</option>`
  ).join("");
}

function resetUsuarioSistemaForm() {
  const form = document.getElementById("form-usuario-sistema");
  form?.reset();
  document.getElementById("usuario-id").value = "";
  setElementText("usuario-form-title", "Crear usuario");
  setElementText("btn-usuario-submit", "Crear usuario");
  document.getElementById("btn-usuario-cancelar-edicion")?.classList.add("hidden");
  document.getElementById("usuario-rol").value = "Operador";
  document.getElementById("usuario-activo").value = "true";

  if (userIsSuperAdmin() && empresasAdminData.length > 0) {
    document.getElementById("usuario-empresa").value = empresasAdminData[0].id;
  }
}

function renderUsuariosSistemaSummary(usuarios = []) {
  setElementText("usuarios-total", usuarios.length);
  setElementText("usuarios-activos", usuarios.filter((u) => u.activo).length);
  setElementText("usuarios-admins", usuarios.filter((u) =>
    ["administrador", "admin", "superadmin"].includes(normalizeRole(u.rol))
  ).length);
}

function renderUsuariosSistemaTable() {
  const tbody = document.getElementById("usuarios-tbody");
  const empty = document.getElementById("usuarios-empty");
  if (!tbody || !empty) return;

  const search = document.getElementById("usuarios-buscar")?.value.trim().toLowerCase() || "";
  const usuarios = search
    ? usuariosSistemaData.filter((u) =>
        `${u.nombre || ""} ${u.email || ""} ${u.rol || ""} ${u.empresa_nombre || ""}`.toLowerCase().includes(search)
      )
    : usuariosSistemaData;

  tbody.innerHTML = "";
  if (usuarios.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  tbody.innerHTML = usuarios.map((usuario) => {
    const nextState = usuario.activo ? "false" : "true";
    const nextLabel = usuario.activo ? "Desactivar" : "Activar";
    const nextClass = usuario.activo ? "btn-danger" : "btn-success";
    return `
      <tr>
        <td>
          <strong>${usuario.nombre}</strong>
          <span class="table-subtext">${usuario.email}</span>
        </td>
        <td>${usuario.empresa_nombre || "-"}</td>
        <td><span class="badge badge-primary">${usuario.rol}</span></td>
        <td>${renderBadge(usuario.activo ? "Activo" : "Inactivo")}</td>
        <td>${new Date(usuario.creado_en).toLocaleDateString()}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn btn-sm btn-secondary" onclick="editarUsuarioSistema(${usuario.id})">Editar</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="resetPasswordUsuarioSistema(${usuario.id})">Clave</button>
            <button type="button" class="btn btn-sm ${nextClass}" onclick="toggleUsuarioSistema(${usuario.id}, ${nextState})">${nextLabel}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function ensureEmpresasForUsuarioSelect() {
  if (!userIsSuperAdmin()) return;
  if (empresasAdminData.length === 0) {
    empresasAdminData = await apiFetch("/api/empresas");
  }
  populateUsuarioEmpresaSelect(empresasAdminData);
}

async function cargarUsuariosSistema() {
  try {
    await ensureEmpresasForUsuarioSelect();
    const query = userIsSuperAdmin() ? "?empresa_id=all" : "";
    usuariosSistemaData = await apiFetch(`/api/usuarios${query}`);
    renderUsuariosSistemaSummary(usuariosSistemaData);
    renderUsuariosSistemaTable();
    resetUsuarioSistemaForm();
  } catch (error) {
    usuariosSistemaData = [];
    renderUsuariosSistemaSummary([]);
    renderUsuariosSistemaTable();
    showMessage("usuario-msg", error.message, true);
  }
}

function editarUsuarioSistema(id) {
  const usuario = usuariosSistemaData.find((u) => Number(u.id) === Number(id));
  if (!usuario) return;

  document.getElementById("usuario-id").value = usuario.id;
  document.getElementById("usuario-nombre").value = usuario.nombre || "";
  document.getElementById("usuario-email").value = usuario.email || "";
  document.getElementById("usuario-rol").value = usuario.rol || "Operador";
  document.getElementById("usuario-activo").value = usuario.activo ? "true" : "false";
  document.getElementById("usuario-password").value = "";

  if (userIsSuperAdmin()) {
    document.getElementById("usuario-empresa").value = usuario.empresa_id;
  }

  setElementText("usuario-form-title", "Editar usuario");
  setElementText("btn-usuario-submit", "Guardar cambios");
  document.getElementById("btn-usuario-cancelar-edicion")?.classList.remove("hidden");
  document.getElementById("form-usuario-sistema")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleGuardarUsuarioSistema(event) {
  event.preventDefault();
  const usuarioId = document.getElementById("usuario-id")?.value;
  const isEditing = Boolean(usuarioId);
  const payload = getUsuarioSistemaPayload(!isEditing);

  if (!payload.nombre || !payload.email) {
    showMessage("usuario-msg", "Nombre y correo son obligatorios.", true);
    return;
  }

  if (!isEditing && !payload.password) {
    showMessage("usuario-msg", "La contraseña es obligatoria al crear usuario.", true);
    return;
  }

  try {
    await apiFetch(isEditing ? `/api/usuarios/${usuarioId}` : "/api/usuarios", {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });

    if (isEditing && payload.password) {
      await apiFetch(`/api/usuarios/${usuarioId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password: payload.password }),
      });
    }

    showMessage("usuario-msg", isEditing ? "Usuario actualizado." : "Usuario creado.");
    await cargarUsuariosSistema();
  } catch (error) {
    showMessage("usuario-msg", error.message, true);
  }
}

async function toggleUsuarioSistema(id, activo) {
  if (!confirm(`¿Deseas ${activo ? "activar" : "desactivar"} este usuario?`)) return;
  try {
    await apiFetch(`/api/usuarios/${id}/estado`, {
      method: "PATCH",
      body: JSON.stringify({ activo }),
    });
    await cargarUsuariosSistema();
  } catch (error) {
    showMessage("usuario-msg", error.message, true);
  }
}

async function resetPasswordUsuarioSistema(id) {
  const password = prompt("Nueva contraseña para el usuario:");
  if (!password) return;
  try {
    await apiFetch(`/api/usuarios/${id}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    });
    showMessage("usuario-msg", "Contraseña actualizada.");
  } catch (error) {
    showMessage("usuario-msg", error.message, true);
  }
}
