// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db");
const authMiddleware = require("../middleware/auth");
const { ensureLicenciasSchema } = require("../utils/licencias-schema");
const { getSuscripcionEmpresa } = require("../utils/suscripciones-schema");
const { getLicenseStatus } = require("../services/licenseService");
const { getPermisosParaRol } = require("../middleware/access");

const router = express.Router();

const LEGACY_LICENSE_MODULES = {
  demo: ["dashboard", "parqueadero", "clientes"],
  basica: ["dashboard", "parqueadero", "clientes", "reportes", "configuracion"],
  pro: ["dashboard", "parqueadero", "clientes", "reportes", "lavadero", "taller", "empleados", "usuarios", "configuracion"],
  premium: ["dashboard", "parqueadero", "clientes", "reportes", "lavadero", "taller", "empleados", "usuarios", "configuracion", "empresas"],
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isExpired(dateValue) {
  return Boolean(dateValue && new Date(dateValue) < new Date());
}

async function getEmpresaLicenciaPermisos(empresaId) {
  await ensureLicenciasSchema();
  const suscripcion = await getSuscripcionEmpresa(db, empresaId).catch(() => null);
  const suscripcionBloqueada = suscripcion
    ? ["VENCIDA", "SUSPENDIDA", "CANCELADA"].includes(suscripcion.estado_real)
    : false;

  const { rows } = await db.query(
    `SELECT el.licencia_id, el.fecha_inicio, el.fecha_fin, el.activa,
            l.nombre AS licencia_nombre, l.descripcion, l.precio
     FROM empresa_licencia el
     JOIN licencias l ON el.licencia_id = l.id
     WHERE el.empresa_id = $1 AND el.activa = true
     ORDER BY el.creado_en DESC
     LIMIT 1`,
    [empresaId]
  );

  if (rows.length > 0) {
    const licencia = rows[0];
    const expirada = isExpired(licencia.fecha_fin);
    const { rows: modulos } = await db.query(
      `SELECT m.nombre, m.descripcion
       FROM licencia_modulo lm
       JOIN modulos m ON lm.modulo_id = m.id
       WHERE lm.licencia_id = $1
       ORDER BY m.nombre`,
      [licencia.licencia_id]
    );

    return {
      licencia: {
        id: licencia.licencia_id,
        nombre: licencia.licencia_nombre,
        descripcion: licencia.descripcion,
        precio: licencia.precio,
        fecha_inicio: licencia.fecha_inicio,
        fecha_fin: licencia.fecha_fin,
        activa: licencia.activa && !expirada,
      },
      suscripcion,
      expirada: expirada || suscripcionBloqueada,
      modulos: expirada || suscripcionBloqueada ? [] : modulos.map((modulo) => modulo.nombre),
      modulos_detalle: expirada || suscripcionBloqueada ? [] : modulos,
    };
  }

  const { rows: licenciasDirectas } = await db.query(
    `SELECT e.licencia_id, e.licencia_inicio AS fecha_inicio, e.licencia_fin AS fecha_fin,
            e.activa, l.nombre AS licencia_nombre, l.descripcion, l.precio
     FROM empresas e
     JOIN licencias l ON l.id = e.licencia_id
     WHERE e.id = $1 AND e.licencia_id IS NOT NULL
     LIMIT 1`,
    [empresaId]
  );

  if (licenciasDirectas.length > 0) {
    const licencia = licenciasDirectas[0];
    const expirada = isExpired(licencia.fecha_fin);
    const { rows: modulos } = await db.query(
      `SELECT m.nombre, m.descripcion
       FROM licencia_modulo lm
       JOIN modulos m ON lm.modulo_id = m.id
       WHERE lm.licencia_id = $1
       ORDER BY m.nombre`,
      [licencia.licencia_id]
    );

    return {
      licencia: {
        id: licencia.licencia_id,
        nombre: licencia.licencia_nombre,
        descripcion: licencia.descripcion,
        precio: licencia.precio,
        fecha_inicio: licencia.fecha_inicio,
        fecha_fin: licencia.fecha_fin,
        activa: licencia.activa && !expirada,
      },
      suscripcion,
      expirada: expirada || suscripcionBloqueada,
      modulos: expirada || suscripcionBloqueada ? [] : modulos.map((modulo) => modulo.nombre),
      modulos_detalle: expirada || suscripcionBloqueada ? [] : modulos,
    };
  }

  const { rows: empresas } = await db.query(
    `SELECT licencia_tipo, licencia_inicio, licencia_fin, activa
     FROM empresas
     WHERE id = $1
     LIMIT 1`,
    [empresaId]
  );

  if (empresas.length === 0) {
    return {
      licencia: null,
      suscripcion,
      expirada: suscripcionBloqueada,
      modulos: [],
      modulos_detalle: [],
    };
  }

  const empresa = empresas[0];
  const licenciaKey = normalizeText(empresa.licencia_tipo || "demo");
  const expirada = isExpired(empresa.licencia_fin);
  const modulos = expirada ? [] : (LEGACY_LICENSE_MODULES[licenciaKey] || LEGACY_LICENSE_MODULES.demo);

  return {
    licencia: {
      id: null,
      nombre: empresa.licencia_tipo || "Demo",
      descripcion: "Licencia heredada de empresa",
      precio: null,
      fecha_inicio: empresa.licencia_inicio,
      fecha_fin: empresa.licencia_fin,
      activa: empresa.activa && !expirada,
    },
    suscripcion,
    expirada: expirada || suscripcionBloqueada,
    modulos: expirada || suscripcionBloqueada ? [] : modulos,
    modulos_detalle: expirada || suscripcionBloqueada ? [] : modulos.map((nombre) => ({ nombre, descripcion: "" })),
  };
}

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
      [empresa.id, "SuperAdmin Demo", "admin@demo.com", hash, "SuperAdmin"]
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
    await ensureLicenciasSchema();
    const { rows } = await db.query(
      `SELECT u.id, u.empresa_id, u.nombre, u.email,
              u.password_hash, u.rol, u.activo,
              e.nombre AS empresa_nombre,
              e.logo_url, e.zona_horaria,
              e.licencia_tipo, e.licencia_id, e.licencia_fin, e.activa AS empresa_activa
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = LOWER($1)
       ORDER BY CASE WHEN LOWER(u.rol) IN ('superadmin', 'super_admin', 'super admin') THEN 0 ELSE 1 END,
                u.id
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

    // Resolver licencia y permisos en paralelo para no bloquear el login
    const licenciaStatus = await getLicenseStatus(user.empresa_id).catch(() => null);
    const permisos = getPermisosParaRol(user.rol);

    // Construir el objeto licencia compatible con setLicensePermissions() del frontend
    // y con campos extra para uso futuro.
    const licenciaPayload = licenciaStatus
      ? {
          // Campos para setLicensePermissions() (frontend/js/core/auth.js)
          modulos:  licenciaStatus.modulos,
          licencia: licenciaStatus.plan
            ? { nombre: licenciaStatus.plan.nombre }
            : { nombre: licenciaStatus.fuente === 'legacy' ? (user.licencia_tipo || 'Demo') : 'Sin plan' },
          expirada: !licenciaStatus.vigente,
          // Campos extendidos
          vigente:  licenciaStatus.vigente,
          estado:   licenciaStatus.estado,
          plan:     licenciaStatus.plan?.codigo ?? null,
          plan_nombre: licenciaStatus.plan?.nombre ?? null,
          limites:  licenciaStatus.limites,
          fuente:   licenciaStatus.fuente,
        }
      : null;

    res.json({
      token,
      usuario: {
        id:         user.id,
        empresa_id: user.empresa_id,
        nombre:     user.nombre,
        email:      user.email,
        rol:        user.rol,
        permisos,   // lista de permisos según rol para uso en el frontend
      },
      empresa: {
        id:           user.empresa_id,
        nombre:       user.empresa_nombre,
        logo_url:     user.logo_url,
        zona_horaria: user.zona_horaria,
        // legacy — mantener para compatibilidad
        licencia_tipo: user.licencia_tipo,
        licencia_id:   user.licencia_id,
        licencia_fin:  user.licencia_fin,
      },
      licencia: licenciaPayload,
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
    await ensureLicenciasSchema();
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

    let licencia = rows[0];

    if (!licencia) {
      const directQuery = `
        SELECT e.licencia_id, e.licencia_inicio AS fecha_inicio, e.licencia_fin AS fecha_fin,
               e.activa, l.nombre as licencia_nombre, l.descripcion, l.precio
        FROM empresas e
        JOIN licencias l ON l.id = e.licencia_id
        WHERE e.id = $1 AND e.licencia_id IS NOT NULL
        LIMIT 1
      `;
      const { rows: directRows } = await db.query(directQuery, [empresaId]);
      licencia = directRows[0];
    }

    if (!licencia) {
      return res.json({ mensaje: 'No hay licencia asignada' });
    }

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

// Obtener permisos de módulos incluidos en la licencia vigente
router.get('/empresa/licencia/permisos', authMiddleware, async (req, res) => {
  try {
    const permisos = await getEmpresaLicenciaPermisos(req.user.empresa_id);
    res.json(permisos);
  } catch (error) {
    console.error('Error obteniendo permisos de licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/licencia/permisos', authMiddleware, async (req, res) => {
  try {
    const permisos = await getEmpresaLicenciaPermisos(req.user.empresa_id);
    res.json(permisos);
  } catch (error) {
    console.error('Error obteniendo permisos de licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
