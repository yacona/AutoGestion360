const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { getParqueaderoConfig } = require("../utils/parqueadero-config");
const { ensureLicenciasSchema } = require("../utils/licencias-schema");

const router = express.Router();

function isSuperAdmin(req) {
  const rol = String(req.user?.rol || "").toLowerCase();
  return ["superadmin", "super_admin", "super admin"].includes(rol);
}

function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ error: "Solo un SuperAdmin puede gestionar empresas." });
  }
  next();
}

function cleanText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeEmpresaPayload(body = {}) {
  return {
    nombre: cleanText(body.nombre),
    nit: cleanText(body.nit),
    ciudad: cleanText(body.ciudad),
    direccion: cleanText(body.direccion),
    telefono: cleanText(body.telefono),
    email_contacto: cleanText(body.email_contacto),
    zona_horaria: cleanText(body.zona_horaria) || "America/Bogota",
    licencia_tipo: cleanText(body.licencia_tipo) || "demo",
    licencia_fin: cleanText(body.licencia_fin),
    activa: body.activa !== false,
  };
}

function handleDbError(res, error, fallbackMessage) {
  if (error.code === "23505") {
    return res.status(409).json({ error: "Ya existe una empresa o usuario con esos datos." });
  }

  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

router.use(requireSuperAdmin);

router.get("/", async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const { rows } = await db.query(`
      SELECT
        e.id,
        e.nombre,
        e.nit,
        e.ciudad,
        e.direccion,
        e.telefono,
        e.email_contacto,
        e.zona_horaria,
        e.licencia_tipo,
        e.licencia_fin,
        COALESCE(el.licencia_id, e.licencia_id) AS licencia_id,
        el.fecha_inicio AS licencia_asignacion_inicio,
        el.fecha_fin AS licencia_asignacion_fin,
        el.activa AS licencia_asignacion_activa,
        l.nombre AS licencia_nombre,
        e.activa,
        e.creado_en,
        COALESCE(u.total, 0)::int AS usuarios_total,
        COALESCE(c.total, 0)::int AS clientes_total,
        COALESCE(v.total, 0)::int AS vehiculos_total,
        COALESCE(p.activos, 0)::int AS parqueados_activos,
        COALESCE(i.ingresos_total, 0)::numeric AS ingresos_total
      FROM empresas e
      LEFT JOIN empresa_licencia el ON el.empresa_id = e.id AND el.activa = true
      LEFT JOIN licencias l ON l.id = COALESCE(el.licencia_id, e.licencia_id)
      LEFT JOIN (
        SELECT empresa_id, COUNT(*) AS total
        FROM usuarios
        GROUP BY empresa_id
      ) u ON u.empresa_id = e.id
      LEFT JOIN (
        SELECT empresa_id, COUNT(*) AS total
        FROM clientes
        GROUP BY empresa_id
      ) c ON c.empresa_id = e.id
      LEFT JOIN (
        SELECT empresa_id, COUNT(*) AS total
        FROM vehiculos
        GROUP BY empresa_id
      ) v ON v.empresa_id = e.id
      LEFT JOIN (
        SELECT empresa_id, COUNT(*) AS activos
        FROM parqueadero
        WHERE hora_salida IS NULL
        GROUP BY empresa_id
      ) p ON p.empresa_id = e.id
      LEFT JOIN (
        SELECT empresa_id, COALESCE(SUM(valor_total), 0) AS ingresos_total
        FROM parqueadero
        WHERE hora_salida IS NOT NULL
        GROUP BY empresa_id
      ) i ON i.empresa_id = e.id
      ORDER BY e.creado_en DESC, e.id DESC
    `);

    res.json(rows);
  } catch (error) {
    handleDbError(res, error, "Error listando empresas.");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nombre, nit, ciudad, direccion, telefono, email_contacto,
              zona_horaria, licencia_tipo, licencia_id, licencia_inicio, licencia_fin, activa, creado_en
       FROM empresas
       WHERE id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Empresa no encontrada." });
    }

    res.json(rows[0]);
  } catch (error) {
    handleDbError(res, error, "Error obteniendo empresa.");
  }
});

router.post("/", async (req, res) => {
  const payload = normalizeEmpresaPayload(req.body);
  const adminNombre = cleanText(req.body.admin_nombre);
  const adminEmail = cleanText(req.body.admin_email);
  const adminPassword = String(req.body.admin_password || "").trim();

  if (!payload.nombre) {
    return res.status(400).json({ error: "El nombre de la empresa es obligatorio." });
  }

  if (adminEmail && adminPassword.length < 6) {
    return res.status(400).json({ error: "La contraseña del administrador debe tener al menos 6 caracteres." });
  }

  let client;
  try {
    await ensureLicenciasSchema();
    client = await db.connect();
    await client.query("BEGIN");

    if (adminEmail) {
      const { rows: usuarios } = await client.query(
        "SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1",
        [adminEmail]
      );
      if (usuarios.length > 0) {
        const error = new Error("Ese correo ya existe en otra empresa. Usa un correo único para iniciar sesión.");
        error.statusCode = 409;
        throw error;
      }
    }

    const { rows } = await client.query(
      `INSERT INTO empresas
        (nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria,
         licencia_tipo, licencia_fin, activa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        payload.nombre,
        payload.nit,
        payload.ciudad,
        payload.direccion,
        payload.telefono,
        payload.email_contacto,
        payload.zona_horaria,
        payload.licencia_tipo,
        payload.licencia_fin,
        payload.activa,
      ]
    );

    const empresa = rows[0];

    if (adminEmail) {
      const hash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol)
         VALUES ($1,$2,$3,$4,$5)`,
        [empresa.id, adminNombre || `Admin ${empresa.nombre}`, adminEmail, hash, "Administrador"]
      );
    }

    await getParqueaderoConfig(empresa.id, client);
    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Empresa creada exitosamente.",
      empresa,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    handleDbError(res, error, "Error creando empresa.");
  } finally {
    if (client) client.release();
  }
});

router.put("/:id", async (req, res) => {
  const payload = normalizeEmpresaPayload(req.body);
  const empresaId = Number(req.params.id);

  if (!payload.nombre) {
    return res.status(400).json({ error: "El nombre de la empresa es obligatorio." });
  }

  if (empresaId === Number(req.user.empresa_id) && payload.activa === false) {
    return res.status(400).json({ error: "No puedes desactivar la empresa de la sesión actual." });
  }

  try {
    const { rows } = await db.query(
      `UPDATE empresas
       SET nombre = $1,
           nit = $2,
           ciudad = $3,
           direccion = $4,
           telefono = $5,
           email_contacto = $6,
           zona_horaria = $7,
           licencia_tipo = $8,
           licencia_fin = $9,
           activa = $10
       WHERE id = $11
       RETURNING *`,
      [
        payload.nombre,
        payload.nit,
        payload.ciudad,
        payload.direccion,
        payload.telefono,
        payload.email_contacto,
        payload.zona_horaria,
        payload.licencia_tipo,
        payload.licencia_fin,
        payload.activa,
        empresaId,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Empresa no encontrada." });
    }

    res.json({
      mensaje: "Empresa actualizada exitosamente.",
      empresa: rows[0],
    });
  } catch (error) {
    handleDbError(res, error, "Error actualizando empresa.");
  }
});

router.patch("/:id/estado", async (req, res) => {
  const empresaId = Number(req.params.id);
  const activa = req.body.activa !== false;

  if (empresaId === Number(req.user.empresa_id) && !activa) {
    return res.status(400).json({ error: "No puedes desactivar la empresa de la sesión actual." });
  }

  try {
    const { rows } = await db.query(
      `UPDATE empresas
       SET activa = $1
       WHERE id = $2
       RETURNING id, nombre, activa`,
      [activa, empresaId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Empresa no encontrada." });
    }

    res.json({
      mensaje: activa ? "Empresa activada." : "Empresa desactivada.",
      empresa: rows[0],
    });
  } catch (error) {
    handleDbError(res, error, "Error cambiando estado de empresa.");
  }
});

module.exports = router;
