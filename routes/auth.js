// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const logoDir = path.join(__dirname, "..", "uploads", "empresa");
if (!fs.existsSync(logoDir)) {
  fs.mkdirSync(logoDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `empresa_${req.user.empresa_id}_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowed.test(file.mimetype);
    cb(null, extname && mimetype);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

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

// Obtener información de la empresa del usuario autenticado
router.get('/empresa', authMiddleware, async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const query = `
      SELECT id, nombre, nit, ciudad, direccion, telefono, email_contacto, logo_url, zona_horaria
      FROM empresas
      WHERE id = $1
    `;
    const { rows } = await db.query(query, [empresaId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error obteniendo empresa:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar información de la empresa
router.put('/empresa', authMiddleware, async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const { nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria } = req.body;

    const query = `
      UPDATE empresas
      SET nombre = $1, nit = $2, ciudad = $3, direccion = $4, telefono = $5, email_contacto = $6, zona_horaria = $7
      WHERE id = $8
      RETURNING *
    `;
    const { rows } = await db.query(query, [nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria, empresaId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    res.json({ mensaje: 'Empresa actualizada exitosamente', empresa: rows[0] });
  } catch (error) {
    console.error('Error actualizando empresa:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Subir logo local de la empresa
router.post('/empresa/logo', authMiddleware, (req, res, next) => {
  upload.single('logo')(req, res, function (err) {
    if (err) {
      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'El archivo excede el tamaño máximo de 2MB.'
          : 'Error al procesar el archivo de logo.';
        return res.status(400).json({ error: message });
      }
      return res.status(400).json({ error: err.message || 'Error al subir el logo.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de logo requerido' });
    }

    const logoUrl = `/uploads/empresa/${req.file.filename}`;
    const query = `
      UPDATE empresas
      SET logo_url = $1
      WHERE id = $2
      RETURNING logo_url
    `;
    const { rows } = await db.query(query, [logoUrl, req.user.empresa_id]);

    res.json({ mensaje: 'Logo actualizado exitosamente', logo_url: rows[0].logo_url });
  } catch (error) {
    console.error('Error subiendo logo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener licencia actual de la empresa
router.get('/empresa/licencia', authMiddleware, async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const query = `
      SELECT el.*, l.nombre as licencia_nombre, l.descripcion, l.precio
      FROM empresa_licencia el
      JOIN licencias l ON el.licencia_id = l.id
      WHERE el.empresa_id = $1 AND el.activa = true
      ORDER BY el.creado_en DESC
      LIMIT 1
    `;
    const { rows } = await db.query(query, [empresaId]);

    if (rows.length === 0) {
      return res.json({ mensaje: 'No hay licencia asignada' });
    }

    const licencia = rows[0];

    // Obtener módulos incluidos
    const modulosQuery = `
      SELECT m.nombre, m.descripcion
      FROM licencia_modulo lm
      JOIN modulos m ON lm.modulo_id = m.id
      WHERE lm.licencia_id = $1
    `;
    const { rows: modulos } = await db.query(modulosQuery, [licencia.licencia_id]);

    res.json({
      ...licencia,
      modulos
    });
  } catch (error) {
    console.error('Error obteniendo licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
