// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();

// Crear token JWT
function crearToken(usuario) {
  const payload = {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    rol: usuario.rol,
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "8h",
  });
}

/**
 * GET /api/setup-demo
 * (En realidad aquí definimos /setup-demo, y server.js le antepone /api)
 */
router.get("/setup-demo", async (req, res) => {
  try {
    const { rows: empresasExistentes } = await db.query(
      "SELECT id FROM empresas LIMIT 1"
    );
    if (empresasExistentes.length > 0) {
      return res.status(400).json({
        error: "Ya existen empresas. Setup demo no disponible.",
      });
    }

    const empresaResult = await db.query(
      `INSERT INTO empresas
       (nombre, nit, ciudad, direccion, telefono, email_contacto, licencia_tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        "Lavadero Demo AutoGestión360",
        "900000000-1",
        "Quibdó",
        "Calle 1 # 2-3",
        "3000000000",
        "admin@demo.com",
        "demo",
      ]
    );

    const empresa = empresaResult.rows[0];

    const passwordPlano = "123456";
    const hash = await bcrypt.hash(passwordPlano, 10);

    const usuarioResult = await db.query(
      `INSERT INTO usuarios
        (empresa_id, nombre, email, password_hash, rol)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, empresa_id, nombre, email, rol`,
      [empresa.id, "Administrador Demo", "admin@demo.com", hash, "Administrador"]
    );

    const usuario = usuarioResult.rows[0];

    res.json({
      mensaje: "Setup demo creado con éxito.",
      empresa,
      usuario,
      credenciales_demo: {
        email: usuario.email,
        password: passwordPlano,
      },
    });
  } catch (err) {
    console.error("Error en /setup-demo:", err);
    res.status(500).json({ error: "Error interno en setup demo" });
  }
});

/**
 * POST /api/login
 * Body: { email, password }
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Debe enviar email y contraseña." });
  }

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.empresa_id, u.nombre, u.email,
              u.password_hash, u.rol, u.activo,
              e.nombre AS empresa_nombre,
              e.logo_url, e.zona_horaria,
              e.licencia_tipo, e.licencia_fin, e.activa AS empresa_activa
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE u.email = $1
       LIMIT 1`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    const user = rows[0];

    if (!user.activo) {
      return res.status(403).json({ error: "Usuario inactivo." });
    }

    if (!user.empresa_activa) {
      return res
        .status(403)
        .json({ error: "La empresa está inactiva o sin licencia." });
    }

    const coincide = await bcrypt.compare(password, user.password_hash);
    if (!coincide) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    const token = crearToken(user);

    res.json({
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      },
      empresa: {
        id: user.empresa_id,
        nombre: user.empresa_nombre,
        logo_url: user.logo_url,
        zona_horaria: user.zona_horaria,
        licencia_tipo: user.licencia_tipo,
        licencia_fin: user.licencia_fin,
      },
    });
  } catch (err) {
    console.error("Error en /login:", err);
    res.status(500).json({ error: "Error interno en login" });
  }
});

module.exports = router;
