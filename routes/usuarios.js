const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");

const router = express.Router();

function normalizeRole(role) {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isSuperAdmin(req) {
  return normalizeRole(req.user?.rol) === "superadmin";
}

function canManageUsers(req) {
  return ["superadmin", "admin", "administrador"].includes(normalizeRole(req.user?.rol));
}

function requireUserAdmin(req, res, next) {
  if (!canManageUsers(req)) {
    return res.status(403).json({ error: "No tienes permisos para gestionar usuarios." });
  }
  next();
}

function cleanText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function canAssignRole(req, role) {
  const normalized = normalizeRole(role);
  if (normalized === "superadmin") return isSuperAdmin(req);
  return true;
}

function getTargetEmpresaId(req, providedEmpresaId) {
  if (isSuperAdmin(req)) {
    return Number(providedEmpresaId || req.query.empresa_id || req.user.empresa_id);
  }
  return Number(req.user.empresa_id);
}

async function assertUserScope(req, userId) {
  const { rows } = await db.query(
    `SELECT id, empresa_id, rol
     FROM usuarios
     WHERE id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    const error = new Error("Usuario no encontrado.");
    error.statusCode = 404;
    throw error;
  }

  const user = rows[0];
  if (!isSuperAdmin(req) && Number(user.empresa_id) !== Number(req.user.empresa_id)) {
    const error = new Error("No puedes administrar usuarios de otra empresa.");
    error.statusCode = 403;
    throw error;
  }

  return user;
}

function handleError(res, error, fallbackMessage) {
  if (error.code === "23505") {
    return res.status(409).json({ error: "Ya existe un usuario con ese correo en esta empresa." });
  }

  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

router.use(requireUserAdmin);

router.get("/", async (req, res) => {
  try {
    const params = [];
    const where = [];

    if (isSuperAdmin(req)) {
      if (req.query.empresa_id && req.query.empresa_id !== "all") {
        params.push(Number(req.query.empresa_id));
        where.push(`u.empresa_id = $${params.length}`);
      }
    } else {
      params.push(Number(req.user.empresa_id));
      where.push(`u.empresa_id = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await db.query(
      `SELECT
         u.id,
         u.empresa_id,
         e.nombre AS empresa_nombre,
         u.nombre,
         u.email,
         u.rol,
         u.activo,
         u.creado_en
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       ${whereSql}
       ORDER BY e.nombre, u.nombre`,
      params
    );

    res.json(rows);
  } catch (error) {
    handleError(res, error, "Error listando usuarios.");
  }
});

router.post("/", async (req, res) => {
  const nombre = cleanText(req.body.nombre);
  const email = cleanText(req.body.email);
  const password = String(req.body.password || "").trim();
  const rol = cleanText(req.body.rol) || "Operador";
  const empresaId = getTargetEmpresaId(req, req.body.empresa_id);
  const activo = req.body.activo !== false;

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: "Nombre, correo y contraseña son obligatorios." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  }

  if (!canAssignRole(req, rol)) {
    return res.status(403).json({ error: "Solo un SuperAdmin puede crear usuarios SuperAdmin." });
  }

  try {
    const { rows: existingEmail } = await db.query(
      "SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );

    if (existingEmail.length > 0) {
      return res.status(409).json({ error: "Ese correo ya está registrado. Usa un correo único para iniciar sesión." });
    }

    const { rows: empresas } = await db.query("SELECT id FROM empresas WHERE id = $1", [empresaId]);
    if (empresas.length === 0) {
      return res.status(404).json({ error: "Empresa no encontrada." });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol, activo)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, empresa_id, nombre, email, rol, activo, creado_en`,
      [empresaId, nombre, email, hash, rol, activo]
    );

    res.status(201).json({
      mensaje: "Usuario creado exitosamente.",
      usuario: rows[0],
    });
  } catch (error) {
    handleError(res, error, "Error creando usuario.");
  }
});

router.put("/:id", async (req, res) => {
  const userId = Number(req.params.id);
  const nombre = cleanText(req.body.nombre);
  const email = cleanText(req.body.email);
  const rol = cleanText(req.body.rol) || "Operador";
  const activo = req.body.activo !== false;

  if (!nombre || !email) {
    return res.status(400).json({ error: "Nombre y correo son obligatorios." });
  }

  if (!canAssignRole(req, rol)) {
    return res.status(403).json({ error: "Solo un SuperAdmin puede asignar el rol SuperAdmin." });
  }

  try {
    const current = await assertUserScope(req, userId);

    if (Number(current.id) === Number(req.user.id) && !activo) {
      return res.status(400).json({ error: "No puedes desactivar tu propio usuario." });
    }

    if (!isSuperAdmin(req) && normalizeRole(current.rol) === "superadmin") {
      return res.status(403).json({ error: "No puedes editar un SuperAdmin." });
    }

    const { rows: existingEmail } = await db.query(
      `SELECT id
       FROM usuarios
       WHERE LOWER(email) = LOWER($1) AND id <> $2
       LIMIT 1`,
      [email, userId]
    );

    if (existingEmail.length > 0) {
      return res.status(409).json({ error: "Ese correo ya está registrado en otro usuario." });
    }

    const { rows } = await db.query(
      `UPDATE usuarios
       SET nombre = $1,
           email = $2,
           rol = $3,
           activo = $4
       WHERE id = $5
       RETURNING id, empresa_id, nombre, email, rol, activo, creado_en`,
      [nombre, email, rol, activo, userId]
    );

    res.json({
      mensaje: "Usuario actualizado exitosamente.",
      usuario: rows[0],
    });
  } catch (error) {
    handleError(res, error, "Error actualizando usuario.");
  }
});

router.patch("/:id/estado", async (req, res) => {
  const userId = Number(req.params.id);
  const activo = req.body.activo !== false;

  try {
    const current = await assertUserScope(req, userId);

    if (Number(current.id) === Number(req.user.id) && !activo) {
      return res.status(400).json({ error: "No puedes desactivar tu propio usuario." });
    }

    if (!isSuperAdmin(req) && normalizeRole(current.rol) === "superadmin") {
      return res.status(403).json({ error: "No puedes cambiar el estado de un SuperAdmin." });
    }

    const { rows } = await db.query(
      `UPDATE usuarios
       SET activo = $1
       WHERE id = $2
       RETURNING id, empresa_id, nombre, email, rol, activo`,
      [activo, userId]
    );

    res.json({
      mensaje: activo ? "Usuario activado." : "Usuario desactivado.",
      usuario: rows[0],
    });
  } catch (error) {
    handleError(res, error, "Error cambiando estado de usuario.");
  }
});

router.patch("/:id/password", async (req, res) => {
  const userId = Number(req.params.id);
  const password = String(req.body.password || "").trim();

  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  }

  try {
    const current = await assertUserScope(req, userId);

    if (!isSuperAdmin(req) && normalizeRole(current.rol) === "superadmin") {
      return res.status(403).json({ error: "No puedes cambiar la contraseña de un SuperAdmin." });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.query(
      `UPDATE usuarios
       SET password_hash = $1
       WHERE id = $2`,
      [hash, userId]
    );

    res.json({ mensaje: "Contraseña actualizada exitosamente." });
  } catch (error) {
    handleError(res, error, "Error actualizando contraseña.");
  }
});

module.exports = router;
