// routes/parqueadero.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  calculateParkingCharge,
  getParqueaderoConfig,
} = require("../utils/parqueadero-config");

const router = express.Router();

const SERVICIOS_PARQUEADERO = new Set([
  "OCASIONAL_HORA",
  "OCASIONAL_DIA",
  "MENSUALIDAD",
]);

function normalizarServicioParqueadero(value) {
  const servicio = limpiarTexto(value || "OCASIONAL_HORA").toUpperCase();
  return SERVICIOS_PARQUEADERO.has(servicio) ? servicio : "OCASIONAL_HORA";
}

async function ensureParqueaderoFlexibleSchema(queryable = db) {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS mensualidades_parqueadero (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
      vehiculo_id BIGINT REFERENCES vehiculos(id) ON DELETE SET NULL,
      placa VARCHAR(20) NOT NULL,
      tipo_vehiculo VARCHAR(30) NOT NULL,
      nombre_cliente VARCHAR(150) NOT NULL,
      documento VARCHAR(40),
      telefono VARCHAR(40),
      correo VARCHAR(120),
      direccion VARCHAR(150),
      contacto_emergencia VARCHAR(150),
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      valor_mensual NUMERIC(12,2) DEFAULT 0,
      estado VARCHAR(30) DEFAULT 'ACTIVA',
      observaciones TEXT,
      creado_en TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS mensualidades_parqueadero_empresa_placa_idx
    ON mensualidades_parqueadero (empresa_id, placa, estado)
  `);

  await queryable.query(`
    ALTER TABLE parqueadero
    ADD COLUMN IF NOT EXISTS tipo_servicio VARCHAR(30) DEFAULT 'OCASIONAL_HORA'
  `);

  await queryable.query(`
    ALTER TABLE parqueadero
    ADD COLUMN IF NOT EXISTS mensualidad_id BIGINT
  `);
}

async function buscarMensualidadActiva(queryable, empresaId, { placa, mensualidadId }) {
  const params = [empresaId];
  let whereExtra = "";

  if (mensualidadId) {
    params.push(mensualidadId);
    whereExtra = `AND mp.id = $${params.length}`;
  } else {
    params.push(placa);
    whereExtra = `AND mp.placa = $${params.length}`;
  }

  const { rows } = await queryable.query(
    `SELECT mp.*, c.id AS cliente_id_db, v.id AS vehiculo_id_db
     FROM mensualidades_parqueadero mp
     LEFT JOIN clientes c ON c.id = mp.cliente_id
     LEFT JOIN vehiculos v ON v.id = mp.vehiculo_id
     WHERE mp.empresa_id = $1
       ${whereExtra}
       AND mp.estado = 'ACTIVA'
       AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin
     ORDER BY mp.fecha_fin DESC
     LIMIT 1`,
    params
  );

  return rows[0] || null;
}

function aplicarTipoServicioAlCobro(cobro, tarifa, tipoServicio) {
  if (tipoServicio === "MENSUALIDAD") {
    return {
      valor_total: 0,
      valor_antes_descuento: 0,
      porcentaje_descuento: 0,
      descuento_aplicado: false,
      minutos_cobrados: 0,
      tarifa_aplicada: "Mensualidad activa",
    };
  }

  if (tipoServicio === "OCASIONAL_DIA" && tarifa?.valor_dia) {
    const valorDia = Number(tarifa.valor_dia);
    if (Number.isFinite(valorDia) && valorDia > cobro.valor_total) {
      return {
        ...cobro,
        valor_total: Math.ceil(valorDia),
        valor_antes_descuento: Math.ceil(valorDia),
        tarifa_aplicada: `$${valorDia} dia`,
      };
    }
  }

  return cobro;
}

// Configurar multer para evidencias
const evidenciaDir = path.join(__dirname, "..", "uploads", "parqueadero");
if (!fs.existsSync(evidenciaDir)) {
  fs.mkdirSync(evidenciaDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: evidenciaDir,
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const random = Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      const filename = `evidencia-${timestamp}-${random}${ext}`;
      cb(null, filename);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se permiten imágenes como evidencia."), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

/**
 * Normaliza placa a MAYÚSCULAS y sin espacios
 */
function normalizarPlaca(placa) {
  return (placa || "").toUpperCase().trim();
}

/**
 * Normaliza texto genérico (trim)
 */
function limpiarTexto(txt) {
  return (txt || "").trim();
}

/**
 * POST /api/parqueadero/entrada
 *
 * Registra la entrada de un vehículo al parqueadero,
 * diferenciando PROPIETARIO LEGAL y CONDUCTOR (persona que ingresa).
 *
 * Body (JSON) esperado:
 * {
 *   placa: "ABC12D",
 *   tipo_vehiculo: "MOTO" | "CARRO" | ...,
 *
 *   es_conductor_propietario: true | false,
 *
 *   // Datos del propietario legal (obligatorios si el vehículo es nuevo)
 *   propietario_nombre: "JUAN PÉREZ",
 *   propietario_documento: "123456789",
 *   propietario_telefono: "300...",
 *   propietario_correo: "correo@dominio.com",
 *
 *   // Datos del conductor actual (pueden ser iguales al propietario)
 *   conductor_nombre: "PEDRO PÉREZ",
 *   conductor_documento: "987654321",
 *   conductor_telefono: "311...",
 *
 *   observaciones: "Texto libre..."
 * }
 */
router.post("/entrada", auth, upload.single("evidencia"), async (req, res) => {
  const empresa_id = req.user.empresa_id;
  let client;

  try {
    let {
      placa,
      tipo_vehiculo,
      es_conductor_propietario,

      propietario_nombre,
      propietario_documento,
      propietario_telefono,
      propietario_correo,

      conductor_nombre,
      conductor_documento,
      conductor_telefono,

      tipo_servicio,
      mensualidad_id,
      observaciones,
    } = req.body || {};

    // Procesar archivo de evidencia si existe
    const evidencia_url = req.file ? `/uploads/parqueadero/${req.file.filename}` : null;

    // Convertir es_conductor_propietario a boolean si viene como string desde FormData
    if (typeof es_conductor_propietario === "string") {
      es_conductor_propietario = es_conductor_propietario === "true";
    }

    // Normalizar datos
    placa = normalizarPlaca(placa);
    tipo_vehiculo = limpiarTexto(tipo_vehiculo).toUpperCase();
    tipo_servicio = normalizarServicioParqueadero(tipo_servicio);
    mensualidad_id = mensualidad_id ? Number(mensualidad_id) : null;
    observaciones = limpiarTexto(observaciones);

    propietario_nombre = limpiarTexto(propietario_nombre);
    propietario_documento = limpiarTexto(propietario_documento);
    propietario_telefono = limpiarTexto(propietario_telefono);
    propietario_correo = limpiarTexto(propietario_correo);

    conductor_nombre = limpiarTexto(conductor_nombre);
    conductor_documento = limpiarTexto(conductor_documento);
    conductor_telefono = limpiarTexto(conductor_telefono);

    // Validaciones básicas
    if (!placa || !tipo_vehiculo) {
      return res
        .status(400)
        .json({ error: "Placa y tipo de vehículo son obligatorios." });
    }

    if (typeof es_conductor_propietario !== "boolean") {
      es_conductor_propietario = true;
    }

    // Abrimos transacción en una sola conexión del pool
    client = await db.connect();
    await client.query("BEGIN");
    await ensureParqueaderoFlexibleSchema(client);

    // 1) Verificar que NO haya un registro abierto para esa placa
    const { rows: abiertos } = await client.query(
      `SELECT id
       FROM parqueadero
       WHERE empresa_id = $1
         AND placa = $2
         AND hora_salida IS NULL
       LIMIT 1`,
      [empresa_id, placa]
    );

    if (abiertos.length > 0) {
      await client.query("ROLLBACK");
      client.release();
      client = null;
      return res.status(400).json({
        error:
          "Ya existe una entrada activa para esta placa. Debe registrar la salida antes de una nueva entrada.",
      });
    }

    let mensualidadActiva = null;
    if (tipo_servicio === "MENSUALIDAD") {
      mensualidadActiva = await buscarMensualidadActiva(client, empresa_id, {
        placa,
        mensualidadId: mensualidad_id,
      });

      if (!mensualidadActiva) {
        await client.query("ROLLBACK");
        client.release();
        client = null;
        return res.status(400).json({
          error: "No hay una mensualidad activa y vigente para esta placa.",
        });
      }

      mensualidad_id = mensualidadActiva.id;
      propietario_nombre = mensualidadActiva.nombre_cliente;
      propietario_documento = mensualidadActiva.documento || "";
      propietario_telefono = mensualidadActiva.telefono || "";
      propietario_correo = mensualidadActiva.correo || "";
      conductor_nombre = conductor_nombre || mensualidadActiva.nombre_cliente;
      conductor_telefono = conductor_telefono || mensualidadActiva.telefono || "";
    }

    // 2) Buscar si el vehículo ya existe
    const { rows: vehiculos } = await client.query(
      `SELECT v.id, v.cliente_id,
              c.nombre       AS propietario_nombre_db,
              c.documento    AS propietario_documento_db,
              c.telefono     AS propietario_telefono_db,
              c.correo       AS propietario_correo_db
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.empresa_id = $1
         AND v.placa = $2
       LIMIT 1`,
      [empresa_id, placa]
    );

    let vehiculo_id;
    let propietario_cliente_id;
    let propietario_final = {}; // para respuesta

    if (vehiculos.length === 0) {
      // 🚗 Vehículo NUEVO en el sistema
      // 2.1) Buscar si ya existe un cliente con ese documento (solo si hay documento válido)
      let clienteRow;
      if (propietario_nombre && propietario_documento && propietario_documento !== "SIN_DOCUMENTO") {
        const { rows: clientesDoc } = await client.query(
          `SELECT id, nombre, documento, telefono, correo
           FROM clientes
           WHERE empresa_id = $1
             AND documento = $2
           LIMIT 1`,
          [empresa_id, propietario_documento]
        );
        if (clientesDoc.length > 0) {
          clienteRow = clientesDoc[0];
          // Opcional: podríamos actualizar datos básicos del cliente aquí
        }
      }

      // 2.2) Si no existe cliente, lo creamos
      if (!clienteRow && propietario_nombre) {
        const insertCliente = await client.query(
          `INSERT INTO clientes
           (empresa_id, nombre, documento, telefono, correo)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, nombre, documento, telefono, correo`,
          [
            empresa_id,
            propietario_nombre,
            propietario_documento && propietario_documento !== "SIN_DOCUMENTO" ? propietario_documento : null,
            propietario_telefono || null,
            propietario_correo || null,
          ]
        );
        clienteRow = insertCliente.rows[0];
      }

      if (clienteRow) {
        propietario_cliente_id = clienteRow.id;
        propietario_final = {
          id: clienteRow.id,
          nombre: clienteRow.nombre,
          documento: clienteRow.documento,
          telefono: clienteRow.telefono,
          correo: clienteRow.correo,
        };
      }

      // 2.3) Crear el vehículo
      const insertVehiculo = await client.query(
        `INSERT INTO vehiculos
         (empresa_id, cliente_id, placa, tipo_vehiculo)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [empresa_id, propietario_cliente_id || null, placa, tipo_vehiculo]
      );

      vehiculo_id = insertVehiculo.rows[0].id;
      if (mensualidadActiva && !mensualidadActiva.vehiculo_id) {
        await client.query(
          `UPDATE mensualidades_parqueadero
           SET vehiculo_id = $1,
               cliente_id = COALESCE(cliente_id, $2),
               actualizado_en = NOW()
           WHERE id = $3 AND empresa_id = $4`,
          [vehiculo_id, propietario_cliente_id || null, mensualidadActiva.id, empresa_id]
        );
      }
    } else {
      // 🚗 Vehículo YA EXISTE
      const v = vehiculos[0];
      vehiculo_id = v.id;
      propietario_cliente_id = v.cliente_id;

      propietario_final = {
        id: propietario_cliente_id,
        nombre: v.propietario_nombre_db,
        documento: v.propietario_documento_db,
        telefono: v.propietario_telefono_db,
        correo: v.propietario_correo_db,
      };

      if (es_conductor_propietario && propietario_nombre) {
        const nombreActual = (v.propietario_nombre_db || "").trim().toUpperCase();
        const documentoActual = (v.propietario_documento_db || "").trim();
        const nombreNuevo = propietario_nombre.trim().toUpperCase();
        const documentoNuevo =
          propietario_documento && propietario_documento !== "SIN_DOCUMENTO"
            ? propietario_documento.trim()
            : null;

        if (
          !nombreActual ||
          nombreNuevo !== nombreActual ||
          (documentoNuevo && documentoNuevo !== documentoActual)
        ) {
          let clienteRow;

          if (documentoNuevo) {
            const { rows: clientesDoc } = await client.query(
              `SELECT id, nombre, documento, telefono, correo
               FROM clientes
               WHERE empresa_id = $1
                 AND documento = $2
               LIMIT 1`,
              [empresa_id, documentoNuevo]
            );
            if (clientesDoc.length > 0) {
              clienteRow = clientesDoc[0];
            }
          }

          if (!clienteRow) {
            const { rows: clientesNombre } = await client.query(
              `SELECT id, nombre, documento, telefono, correo
               FROM clientes
               WHERE empresa_id = $1
                 AND UPPER(TRIM(nombre)) = $2
               LIMIT 1`,
              [empresa_id, nombreNuevo]
            );
            if (clientesNombre.length > 0) {
              clienteRow = clientesNombre[0];
            }
          }

          if (!clienteRow) {
            const insertCliente = await client.query(
              `INSERT INTO clientes
               (empresa_id, nombre, documento, telefono, correo)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, nombre, documento, telefono, correo`,
              [
                empresa_id,
                propietario_nombre,
                documentoNuevo || null,
                propietario_telefono || null,
                propietario_correo || null,
              ]
            );
            clienteRow = insertCliente.rows[0];
          }

          if (clienteRow && clienteRow.id !== propietario_cliente_id) {
            await client.query(
              `UPDATE vehiculos
               SET cliente_id = $1
               WHERE id = $2`,
              [clienteRow.id, vehiculo_id]
            );
            propietario_cliente_id = clienteRow.id;
          }

          propietario_final = {
            id: clienteRow.id,
            nombre: clienteRow.nombre,
            documento: clienteRow.documento,
            telefono: clienteRow.telefono,
            correo: clienteRow.correo,
          };
        }
      }
    }

    if (mensualidadActiva && vehiculo_id && !mensualidadActiva.vehiculo_id) {
      await client.query(
        `UPDATE mensualidades_parqueadero
         SET vehiculo_id = $1,
             cliente_id = COALESCE(cliente_id, $2),
             actualizado_en = NOW()
         WHERE id = $3 AND empresa_id = $4`,
        [vehiculo_id, propietario_cliente_id || null, mensualidadActiva.id, empresa_id]
      );
    }

    // 3) Resolver datos del CONDUCTOR (persona que ingresa)
    let nombre_conductor_final = conductor_nombre;
    let telefono_conductor_final = conductor_telefono;

    if (es_conductor_propietario) {
      // El que ingresa ES el propietario
      nombre_conductor_final =
        conductor_nombre || propietario_nombre || propietario_final.nombre;
      telefono_conductor_final =
        conductor_telefono || propietario_telefono || propietario_final.telefono;
    } else {
      // El que ingresa NO es el propietario
      if (tipo_servicio === "MENSUALIDAD" && (!conductor_nombre || !conductor_documento)) {
        await client.query("ROLLBACK");
        client.release();
        client = null;
        return res.status(400).json({
          error:
            "Si el conductor NO es el propietario, debe registrar al menos nombre y documento del conductor.",
        });
      }
    }

    if (!nombre_conductor_final) {
      nombre_conductor_final = tipo_servicio === "MENSUALIDAD"
        ? mensualidadActiva.nombre_cliente
        : "USUARIO GENERICO";
    }

    // 4) Insertar registro de entrada en PARQUEADERO
    const insertParqueo = await client.query(
      `INSERT INTO parqueadero
       (
         empresa_id,
         vehiculo_id,
         cliente_id,       -- propietario legal
         placa,
         tipo_vehiculo,
         nombre_cliente,   -- nombre del CONDUCTOR que ingresa
         telefono,         -- teléfono del conductor
         conductor_nombre,
         conductor_documento,
         conductor_telefono,
         es_propietario,   -- indica si el conductor es el propietario
         observaciones,
         evidencia_url,
         tipo_servicio,
         mensualidad_id,
         estado_pago
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        empresa_id,
        vehiculo_id,
        propietario_cliente_id,
        placa,
        tipo_vehiculo,
        nombre_conductor_final || propietario_final.nombre || null,
        telefono_conductor_final || propietario_final.telefono || null,
        nombre_conductor_final || propietario_final.nombre || null,
        conductor_documento || (es_conductor_propietario ? propietario_documento : null) || null,
        telefono_conductor_final || propietario_final.telefono || null,
        es_conductor_propietario,
        observaciones || null,
        evidencia_url,
        tipo_servicio,
        mensualidad_id || null,
        tipo_servicio === "MENSUALIDAD" ? "MENSUALIDAD" : "PENDIENTE",
      ]
    );

    await client.query("COMMIT");
    client.release();
    client = null;

    const registro = insertParqueo.rows[0];

    return res.json({
      mensaje: "Entrada registrada correctamente.",
      parqueadero: registro,
      propietario: propietario_final,
      conductor: {
        nombre: nombre_conductor_final,
        documento: conductor_documento || (es_conductor_propietario ? propietario_documento : null),
        telefono: telefono_conductor_final,
      },
    });
  } catch (err) {
    console.error("Error en POST /api/parqueadero/entrada:", err);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    try {
      if (client) {
        await client.query("ROLLBACK");
      }
    } catch (_) {}
    if (client) {
      client.release();
    }
    return res
      .status(500)
      .json({ error: err.message || "Error registrando entrada al parqueadero." });
  }
});
// GET /api/parqueadero/pre-carga/:placa
// Devuelve info de vehículo + propietario si existen
router.get("/pre-carga/:placa", auth, async (req, res) => {
  try {
    const empresa_id = req.user.empresa_id;
    const placaRaw = req.params.placa || "";
    const placa = placaRaw.toUpperCase().trim();

    if (!placa) {
      return res.status(400).json({ error: "Debe enviar una placa." });
    }

    const { rows } = await db.query(
      `
      SELECT
        v.id              AS vehiculo_id,
        v.placa,
        v.tipo_vehiculo,
        v.marca,
        v.modelo,
        v.color,
        c.id              AS propietario_id,
        c.nombre          AS propietario_nombre,
        c.documento       AS propietario_documento,
        c.telefono        AS propietario_telefono,
        c.correo          AS propietario_correo
      FROM vehiculos v
      LEFT JOIN clientes c
        ON c.id = v.cliente_id
      WHERE v.empresa_id = $1
        AND v.placa = $2
      LIMIT 1
      `,
      [empresa_id, placa]
    );

    if (rows.length === 0) {
      // Vehículo no existe aún
      return res.json({ existe: false });
    }

    const row = rows[0];

    res.json({
      existe: true,
      vehiculo: {
        id: row.vehiculo_id,
        placa: row.placa,
        tipo_vehiculo: row.tipo_vehiculo,
        marca: row.marca,
        modelo: row.modelo,
        color: row.color,
      },
      propietario: row.propietario_id
        ? {
            id: row.propietario_id,
            nombre: row.propietario_nombre,
            documento: row.propietario_documento,
            telefono: row.propietario_telefono,
            correo: row.propietario_correo,
          }
        : null,
    });
  } catch (err) {
    console.error("Error en /parqueadero/pre-carga:", err);
    res
      .status(500)
      .json({ error: "Error consultando datos de la placa en el parqueadero." });
  }
});
// GET /api/parqueadero/buscar/:placa
// Devuelve información del vehículo, propietario y un historial básico
router.get("/buscar/:placa", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const placaRaw = req.params.placa;

  if (!placaRaw) {
    return res.status(400).json({ error: "Debe enviar una placa." });
  }

  const placa = normalizarPlaca(placaRaw);

  try {
    await ensureParqueaderoFlexibleSchema();
    // 1️⃣ Buscar vehículo y propietario actual (si existe)
    const { rows: vehiculos } = await db.query(
      `SELECT
         v.id,
         v.placa,
         v.tipo_vehiculo,
         v.marca,
         v.modelo,
         v.color,
         c.id         AS propietario_id,
         c.nombre     AS propietario_nombre,
         c.documento  AS propietario_documento,
         c.telefono   AS propietario_telefono,
         c.correo     AS propietario_correo
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.empresa_id = $1
         AND v.placa = $2
       LIMIT 1`,
      [empresa_id, placa]
    );

    const vehiculo = vehiculos[0] || null;
    const mensualidadActiva = await buscarMensualidadActiva(db, empresa_id, {
      placa,
      mensualidadId: null,
    });

    // 2️⃣ Historial de PARQUEADERO (últimos 10 registros)
    const { rows: histParqueadero } = await db.query(
      `SELECT
         id,
         hora_entrada,
         hora_salida,
         minutos_total,
         valor_total,
         metodo_pago,
         tipo_servicio,
         mensualidad_id,
         observaciones
       FROM parqueadero
       WHERE empresa_id = $1
         AND placa = $2
       ORDER BY hora_entrada DESC
       LIMIT 10`,
      [empresa_id, placa]
    );

    // 3️⃣ Historial de LAVADERO (últimos 10 registros)
    const { rows: histLavadero } = await db.query(
      `SELECT
         id,
         tipo_lavado_id,
         precio,
         estado,
         hora_inicio,
         hora_fin,
         lavador_id,
         metodo_pago,
         observaciones
       FROM lavadero
       WHERE empresa_id = $1
         AND placa = $2
       ORDER BY hora_inicio DESC
       LIMIT 10`,
      [empresa_id, placa]
    );

    // 4️⃣ Historial de TALLER (últimas 10 órdenes)
    const { rows: histTaller } = await db.query(
      `SELECT
         id,
         numero_orden,
         descripcion_falla,
         estado,
         fecha_creacion,
         fecha_entrega,
         total_orden
       FROM taller_ordenes
       WHERE empresa_id = $1
         AND placa = $2
       ORDER BY fecha_creacion DESC
       LIMIT 10`,
      [empresa_id, placa]
    );

    // 5️⃣ Respuesta unificada
    res.json({
      placa,
      existe: !!vehiculo || !!mensualidadActiva,
      vehiculo: vehiculo
        ? {
            id: vehiculo.id,
            placa: vehiculo.placa,
            tipo_vehiculo: vehiculo.tipo_vehiculo,
            marca: vehiculo.marca,
            modelo: vehiculo.modelo,
            color: vehiculo.color,
          }
        : mensualidadActiva
          ? {
              id: mensualidadActiva.vehiculo_id,
              placa: mensualidadActiva.placa,
              tipo_vehiculo: mensualidadActiva.tipo_vehiculo,
              marca: null,
              modelo: null,
              color: null,
            }
          : null,
      propietario: vehiculo
        ? {
            id: vehiculo.propietario_id,
            nombre: vehiculo.propietario_nombre,
            documento: vehiculo.propietario_documento,
            telefono: vehiculo.propietario_telefono,
            correo: vehiculo.propietario_correo,
          }
        : mensualidadActiva
          ? {
              id: mensualidadActiva.cliente_id,
              nombre: mensualidadActiva.nombre_cliente,
              documento: mensualidadActiva.documento,
              telefono: mensualidadActiva.telefono,
              correo: mensualidadActiva.correo,
            }
          : null,
      mensualidad: mensualidadActiva,
      historial: {
        parqueadero: histParqueadero,
        lavadero: histLavadero,
        taller: histTaller,
      },
    });
  } catch (err) {
    console.error("Error buscando vehículo por placa:", err);
    res
      .status(500)
      .json({ error: "Error interno buscando información de la placa." });
  }
});

/**
 * POST /api/parqueadero/salida/:id
 *
 * Registra la salida de un vehículo del parqueadero por ID de registro,
 * calcula el tiempo total, minutos y valor basado en tarifa por hora.
 * REQUIERE confirmación: metodo_pago debe ser especificado.
 *
 * Body (JSON) esperado:
 * {
 *   metodo_pago: "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "OTRO" (REQUERIDO),
 *   detalle_pago: "Texto opcional sobre el pago...",
 *   observaciones: "Observaciones adicionales...",
 *   referencia_transaccion: "Para TARJETA/TRANSFERENCIA (opcional)"
 * }
 */
router.post("/salida/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const registro_id = req.params.id;
  let client;

  try {
    let { metodo_pago, detalle_pago, observaciones, referencia_transaccion } = req.body || {};

    // Normalizar datos
    metodo_pago = limpiarTexto(metodo_pago);
    detalle_pago = limpiarTexto(detalle_pago);
    observaciones = limpiarTexto(observaciones);
    referencia_transaccion = limpiarTexto(referencia_transaccion);

    // Validaciones básicas
    if (!registro_id || isNaN(registro_id)) {
      return res.status(400).json({ error: "ID de registro inválido." });
    }

    // Validar que metodo_pago es requerido y válido
    const metodos_validos = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MIXTO", "MENSUALIDAD", "OTRO"];
    if (!metodo_pago) {
      return res.status(400).json({ 
        error: "Debe especificar el método de pago (EFECTIVO, TARJETA, TRANSFERENCIA u OTRO)." 
      });
    }
    if (!metodos_validos.includes(metodo_pago)) {
      return res.status(400).json({ 
        error: `Método de pago inválido. Opciones válidas: ${metodos_validos.join(", ")}` 
      });
    }

    // Abrimos transacción en una sola conexión del pool
    client = await db.connect();
    await client.query("BEGIN");
    await ensureParqueaderoFlexibleSchema(client);

    // 1) Buscar el registro activo por ID y empresa
    const { rows: activos } = await client.query(
      `SELECT id, hora_entrada, tipo_vehiculo, placa, tipo_servicio, mensualidad_id
       FROM parqueadero
       WHERE id = $1
         AND empresa_id = $2
         AND hora_salida IS NULL`,
      [registro_id, empresa_id]
    );

    if (activos.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      client = null;
      return res.status(404).json({
        error: "Registro no encontrado o ya fue cerrado.",
      });
    }

    const registro = activos[0];
    const hora_entrada = new Date(registro.hora_entrada);
    const hora_salida = new Date(); // Ahora

    // 2) Calcular tiempo total en minutos
    const diffMs = hora_salida - hora_entrada;
    const minutos_total = Math.ceil(diffMs / (1000 * 60));

    // 3) Obtener tarifa configurada para este tipo de vehículo
    const configParqueadero = await getParqueaderoConfig(empresa_id, client);
    const { rows: tarifas } = await client.query(
      `SELECT *
       FROM tarifas WHERE empresa_id = $1 AND tipo_vehiculo = $2 AND activo = TRUE`,
      [empresa_id, registro.tipo_vehiculo]
    );
    const tarifa = configParqueadero.vehiculos[registro.tipo_vehiculo] || tarifas[0] || {};
    let cobro = calculateParkingCharge({
      minutosTotal: minutos_total,
      horaEntrada: hora_entrada,
      horaSalida: hora_salida,
      tarifa,
      reglas: configParqueadero.reglas,
    });
    cobro = aplicarTipoServicioAlCobro(cobro, tarifa, registro.tipo_servicio);
    const valor_total = cobro.valor_total;

    // 5) Actualizar el registro
    const updateQuery = await client.query(
      `UPDATE parqueadero
       SET hora_salida = $1,
           minutos_total = $2,
           valor_total = $3,
           metodo_pago = $4,
           detalle_pago = $5,
           observaciones = COALESCE(observaciones || '\n', '') || $6
       WHERE id = $7
       RETURNING *`,
      [
        hora_salida,
        minutos_total,
        valor_total,
        metodo_pago,
        detalle_pago || null,
        observaciones || null,
        registro_id,
      ]
    );

    await client.query("COMMIT");
    client.release();
    client = null;

    const registroActualizado = updateQuery.rows[0];

    return res.json({
      mensaje: "Salida registrada correctamente.",
      parqueadero: registroActualizado,
      resumen: {
        tiempo_total_minutos: minutos_total,
        tiempo_total_horas: (minutos_total / 60).toFixed(2),
        valor_total: valor_total,
        tarifa_aplicada: cobro.tarifa_aplicada,
      },
    });
  } catch (err) {
    console.error("Error en POST /api/parqueadero/salida:", err);
    try {
      if (client) {
        await client.query("ROLLBACK");
      }
    } catch (_) {}
    if (client) {
      client.release();
    }
    return res
      .status(500)
      .json({ error: "Error registrando salida del parqueadero." });
  }
});

/**
 * GET /api/parqueadero/activo
 *
 * Lista todos los registros activos del parqueadero (sin hora_salida)
 */
router.get("/activo", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    await ensureParqueaderoFlexibleSchema();
    const { rows } = await db.query(
      `SELECT
         p.id,
         p.placa,
         p.tipo_vehiculo,
         p.tipo_servicio,
         p.mensualidad_id,
         p.nombre_cliente,
         p.telefono,
         p.hora_entrada,
         p.observaciones,
         v.marca,
         v.modelo,
         v.color
       FROM parqueadero p
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       WHERE p.empresa_id = $1
         AND p.hora_salida IS NULL
       ORDER BY p.hora_entrada ASC`,
      [empresa_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo parqueadero activo:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * GET /api/parqueadero/historial
 *
 * Lista los últimos servicios cerrados del parqueadero.
 */
router.get("/historial", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    await ensureParqueaderoFlexibleSchema();
    const { rows } = await db.query(
      `SELECT
         p.id,
         p.placa,
         p.tipo_vehiculo,
         p.tipo_servicio,
         p.mensualidad_id,
         p.nombre_cliente,
         p.hora_entrada,
         p.hora_salida,
         p.minutos_total,
         p.valor_total,
         p.metodo_pago
       FROM parqueadero p
       WHERE p.empresa_id = $1
         AND p.hora_salida IS NOT NULL
       ORDER BY p.hora_salida DESC
       LIMIT $2`,
      [empresa_id, limit]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo historial de parqueadero:", err);
    res.status(500).json({ error: "Error obteniendo historial de parqueadero." });
  }
});

/**
 * GET /api/parqueadero/mensualidades
 *
 * Lista clientes con mensualidad de parqueadero.
 */
router.get("/mensualidades", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const incluirInactivas = req.query.incluir_inactivas === "true";

  try {
    await ensureParqueaderoFlexibleSchema();
    const { rows } = await db.query(
      `SELECT
         mp.*,
         COUNT(p.id)::int AS ingresos_registrados,
         MAX(p.hora_entrada) AS ultimo_ingreso
       FROM mensualidades_parqueadero mp
       LEFT JOIN parqueadero p ON p.mensualidad_id = mp.id AND p.empresa_id = mp.empresa_id
       WHERE mp.empresa_id = $1
         AND ($2::boolean = TRUE OR mp.estado = 'ACTIVA')
       GROUP BY mp.id
       ORDER BY mp.estado, mp.fecha_fin ASC, mp.nombre_cliente ASC`,
      [empresa_id, incluirInactivas]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo mensualidades:", err);
    res.status(500).json({ error: "Error obteniendo mensualidades." });
  }
});

/**
 * POST /api/parqueadero/mensualidades
 *
 * Crea un cliente/vehículo con mensualidad activa.
 */
router.post("/mensualidades", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  let client;

  try {
    let {
      nombre_cliente,
      documento,
      telefono,
      correo,
      direccion,
      contacto_emergencia,
      placa,
      tipo_vehiculo,
      marca,
      modelo,
      color,
      fecha_inicio,
      fecha_fin,
      valor_mensual,
      observaciones,
    } = req.body || {};

    nombre_cliente = limpiarTexto(nombre_cliente).toUpperCase();
    documento = limpiarTexto(documento);
    telefono = limpiarTexto(telefono);
    correo = limpiarTexto(correo);
    direccion = limpiarTexto(direccion);
    contacto_emergencia = limpiarTexto(contacto_emergencia);
    placa = normalizarPlaca(placa);
    tipo_vehiculo = limpiarTexto(tipo_vehiculo).toUpperCase();
    marca = limpiarTexto(marca).toUpperCase();
    modelo = limpiarTexto(modelo).toUpperCase();
    color = limpiarTexto(color).toUpperCase();
    observaciones = limpiarTexto(observaciones);
    valor_mensual = Number(valor_mensual || 0);

    if (!nombre_cliente || !documento || !placa || !tipo_vehiculo || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: "Nombre, documento, placa, tipo de vehículo, inicio y fin son obligatorios.",
      });
    }

    if (!Number.isFinite(valor_mensual) || valor_mensual < 0) {
      return res.status(400).json({ error: "El valor mensual no es válido." });
    }

    client = await db.connect();
    await client.query("BEGIN");
    await ensureParqueaderoFlexibleSchema(client);

    let clienteRow;
    const { rows: clientesDoc } = await client.query(
      `SELECT id, nombre, documento, telefono, correo
       FROM clientes
       WHERE empresa_id = $1 AND documento = $2
       LIMIT 1`,
      [empresa_id, documento]
    );

    if (clientesDoc.length > 0) {
      const { rows } = await client.query(
        `UPDATE clientes
         SET nombre = $1,
             telefono = COALESCE($2, telefono),
             correo = COALESCE($3, correo)
         WHERE id = $4 AND empresa_id = $5
         RETURNING id, nombre, documento, telefono, correo`,
        [nombre_cliente, telefono || null, correo || null, clientesDoc[0].id, empresa_id]
      );
      clienteRow = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO clientes (empresa_id, nombre, documento, telefono, correo)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, nombre, documento, telefono, correo`,
        [empresa_id, nombre_cliente, documento, telefono || null, correo || null]
      );
      clienteRow = rows[0];
    }

    let vehiculoRow;
    const { rows: vehiculos } = await client.query(
      `SELECT id FROM vehiculos WHERE empresa_id = $1 AND placa = $2 LIMIT 1`,
      [empresa_id, placa]
    );

    if (vehiculos.length > 0) {
      const { rows } = await client.query(
        `UPDATE vehiculos
         SET cliente_id = $1,
             tipo_vehiculo = $2,
             marca = COALESCE($3, marca),
             modelo = COALESCE($4, modelo),
             color = COALESCE($5, color)
         WHERE id = $6 AND empresa_id = $7
         RETURNING id`,
        [clienteRow.id, tipo_vehiculo, marca || null, modelo || null, color || null, vehiculos[0].id, empresa_id]
      );
      vehiculoRow = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO vehiculos (empresa_id, cliente_id, placa, tipo_vehiculo, marca, modelo, color)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [empresa_id, clienteRow.id, placa, tipo_vehiculo, marca || null, modelo || null, color || null]
      );
      vehiculoRow = rows[0];
    }

    await client.query(
      `UPDATE mensualidades_parqueadero
       SET estado = 'INACTIVA', actualizado_en = NOW()
       WHERE empresa_id = $1 AND placa = $2 AND estado = 'ACTIVA'`,
      [empresa_id, placa]
    );

    const { rows: mensualidades } = await client.query(
      `INSERT INTO mensualidades_parqueadero
       (empresa_id, cliente_id, vehiculo_id, placa, tipo_vehiculo, nombre_cliente, documento,
        telefono, correo, direccion, contacto_emergencia, fecha_inicio, fecha_fin,
        valor_mensual, estado, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVA',$15)
       RETURNING *`,
      [
        empresa_id,
        clienteRow.id,
        vehiculoRow.id,
        placa,
        tipo_vehiculo,
        nombre_cliente,
        documento,
        telefono || null,
        correo || null,
        direccion || null,
        contacto_emergencia || null,
        fecha_inicio,
        fecha_fin,
        valor_mensual,
        observaciones || null,
      ]
    );

    await client.query("COMMIT");
    client.release();
    client = null;

    res.status(201).json({
      mensaje: "Mensualidad registrada correctamente.",
      mensualidad: mensualidades[0],
      cliente: clienteRow,
      vehiculo: vehiculoRow,
    });
  } catch (err) {
    console.error("Error creando mensualidad:", err);
    try {
      if (client) await client.query("ROLLBACK");
    } catch (_) {}
    if (client) client.release();
    res.status(500).json({ error: err.message || "Error creando mensualidad." });
  }
});

/**
 * GET /api/parqueadero/mensualidades/:id/historial
 */
router.get("/mensualidades/:id/historial", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const mensualidad_id = req.params.id;

  try {
    await ensureParqueaderoFlexibleSchema();
    const { rows: mensualidades } = await db.query(
      `SELECT * FROM mensualidades_parqueadero
       WHERE id = $1 AND empresa_id = $2`,
      [mensualidad_id, empresa_id]
    );

    if (mensualidades.length === 0) {
      return res.status(404).json({ error: "Mensualidad no encontrada." });
    }

    const { rows: historial } = await db.query(
      `SELECT id, placa, tipo_vehiculo, tipo_servicio, nombre_cliente, hora_entrada,
              hora_salida, minutos_total, valor_total, metodo_pago, observaciones
       FROM parqueadero
       WHERE empresa_id = $1
         AND (mensualidad_id = $2 OR placa = $3)
       ORDER BY hora_entrada DESC
       LIMIT 100`,
      [empresa_id, mensualidad_id, mensualidades[0].placa]
    );

    res.json({
      mensualidad: mensualidades[0],
      historial,
    });
  } catch (err) {
    console.error("Error obteniendo historial de mensualidad:", err);
    res.status(500).json({ error: "Error obteniendo historial de mensualidad." });
  }
});

/**
 * GET /api/parqueadero/:id
 *
 * Obtiene detalles completos de un registro específico para editar o visualizar antes de salida
 */
router.get("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const registro_id = req.params.id;

  try {
    if (!registro_id || isNaN(registro_id)) {
      return res.status(400).json({ error: "ID de registro inválido." });
    }
    await ensureParqueaderoFlexibleSchema();

    const { rows } = await db.query(
      `SELECT
         p.id,
         p.placa,
         p.tipo_vehiculo,
         p.tipo_servicio,
         p.mensualidad_id,
         p.nombre_cliente,
         p.telefono,
         NULL::text AS documento_cliente,
         p.conductor_nombre AS nombre_conductor,
         p.conductor_documento AS documento_conductor,
         p.conductor_telefono AS telefono_conductor,
         p.hora_entrada,
         p.hora_salida,
         p.observaciones,
         p.metodo_pago,
         p.valor_total,
         p.minutos_total,
         v.id AS vehiculo_id,
         v.marca,
         v.modelo,
         v.color
       FROM parqueadero p
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       WHERE p.id = $1
         AND p.empresa_id = $2`,
      [registro_id, empresa_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Registro no encontrado." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error obteniendo registro:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * PATCH /api/parqueadero/:id
 *
 * Edita datos de un registro ANTES de registrar salida
 * Permite corregir: placa, tipo_vehiculo, nombre_cliente, telefono, documento, conductor, etc.
 */
router.patch("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const registro_id = req.params.id;
  
  try {
    if (!registro_id || isNaN(registro_id)) {
      return res.status(400).json({ error: "ID de registro inválido." });
    }

    // Verificar que el registro existe y está activo (sin salida aún)
    const { rows: activos } = await db.query(
      `SELECT id FROM parqueadero
       WHERE id = $1 AND empresa_id = $2 AND hora_salida IS NULL`,
      [registro_id, empresa_id]
    );

    if (activos.length === 0) {
      return res.status(404).json({ 
        error: "Registro no encontrado o ya fue cerrado." 
      });
    }

    // Campos permitidos para editar
    const {
      placa: placa_nueva,
      tipo_vehiculo: tipo_vehiculo_nuevo,
      nombre_cliente: nombre_cliente_nuevo,
      telefono: telefono_nuevo,
      documento_cliente: documento_nuevo,
      nombre_conductor: conductor_nombre_nuevo,
      documento_conductor: documento_conductor_nuevo,
      telefono_conductor: telefono_conductor_nuevo,
      observaciones: observaciones_nuevas,
    } = req.body || {};

    // Construir actualización dinámica
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (placa_nueva) {
      updates.push(`placa = $${paramIndex++}`);
      values.push(placa_nueva.toUpperCase().trim());
    }
    if (tipo_vehiculo_nuevo) {
      updates.push(`tipo_vehiculo = $${paramIndex++}`);
      values.push(tipo_vehiculo_nuevo);
    }
    if (nombre_cliente_nuevo) {
      updates.push(`nombre_cliente = $${paramIndex++}`);
      values.push(limpiarTexto(nombre_cliente_nuevo));
    }
    if (telefono_nuevo) {
      updates.push(`telefono = $${paramIndex++}`);
      values.push(limpiarTexto(telefono_nuevo));
    }
    if (conductor_nombre_nuevo) {
      updates.push(`conductor_nombre = $${paramIndex++}`);
      values.push(limpiarTexto(conductor_nombre_nuevo));
    }
    if (documento_conductor_nuevo) {
      updates.push(`conductor_documento = $${paramIndex++}`);
      values.push(limpiarTexto(documento_conductor_nuevo));
    }
    if (telefono_conductor_nuevo) {
      updates.push(`conductor_telefono = $${paramIndex++}`);
      values.push(limpiarTexto(telefono_conductor_nuevo));
    }
    if (observaciones_nuevas !== undefined) {
      updates.push(`observaciones = $${paramIndex++}`);
      values.push(limpiarTexto(observaciones_nuevas));
    }

    if (documento_nuevo) {
      const docs = [
        documento_nuevo ? `Documento cliente: ${limpiarTexto(documento_nuevo)}` : null,
      ].filter(Boolean).join(" | ");
      updates.push(`observaciones = COALESCE(observaciones || '\n', '') || $${paramIndex++}`);
      values.push(docs);
    }

    if (updates.length === 0) {
      return res.json({
        mensaje: "No hay cambios para aplicar.",
        registro_id,
      });
    }

    // Agregar empresa e ID al final para WHERE
    values.push(empresa_id);
    values.push(registro_id);

    const updateQuery = `
      UPDATE parqueadero
      SET ${updates.join(", ")}
      WHERE empresa_id = $${paramIndex++}
        AND id = $${paramIndex}
      RETURNING *
    `;

    const { rows: actualizado } = await db.query(updateQuery, values);

    res.json({
      mensaje: "Registro actualizado exitosamente.",
      registro: actualizado[0],
    });
  } catch (err) {
    console.error("Error actualizando registro:", err);
    res.status(500).json({ error: "Error actualizando el registro." });
  }
});

/**
 * POST /api/parqueadero/:id/pre-salida
 *
 * Pre-calcula el costo de salida ANTES de confirmar pago
 * Devuelve: tiempo total, minutos, monto a cobrar, tarifa aplicada
 * NO registra la salida aún, solo calcula
 */
router.post("/:id/pre-salida", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const registro_id = req.params.id;

  try {
    if (!registro_id || isNaN(registro_id)) {
      return res.status(400).json({ error: "ID de registro inválido." });
    }
    await ensureParqueaderoFlexibleSchema();

    // Buscar registro activo
    const { rows: activos } = await db.query(
      `SELECT id, hora_entrada, tipo_vehiculo, placa, nombre_cliente, valor_total, tipo_servicio, mensualidad_id
       FROM parqueadero
       WHERE id = $1 AND empresa_id = $2 AND hora_salida IS NULL`,
      [registro_id, empresa_id]
    );

    if (activos.length === 0) {
      return res.status(404).json({
        error: "Registro no encontrado o ya fue cerrado.",
      });
    }

    const registro = activos[0];
    const hora_entrada = new Date(registro.hora_entrada);
    const hora_salida = new Date();

    // Calcular tiempo
    const diffMs = hora_salida - hora_entrada;
    const minutos_total = Math.ceil(diffMs / (1000 * 60));
    const horas_total = minutos_total / 60;

    // Obtener tarifa
    const configParqueadero = await getParqueaderoConfig(empresa_id);
    const { rows: tarifas } = await db.query(
      `SELECT *
       FROM tarifas WHERE empresa_id = $1 AND tipo_vehiculo = $2 AND activo = TRUE`,
      [empresa_id, registro.tipo_vehiculo]
    );
    const tarifa = configParqueadero.vehiculos[registro.tipo_vehiculo] || tarifas[0] || {};
    let cobro = calculateParkingCharge({
      minutosTotal: minutos_total,
      horaEntrada: hora_entrada,
      horaSalida: hora_salida,
      tarifa,
      reglas: configParqueadero.reglas,
    });
    cobro = aplicarTipoServicioAlCobro(cobro, tarifa, registro.tipo_servicio);

    res.json({
      registro_id,
      placa: registro.placa,
      cliente: registro.nombre_cliente,
      tipo_vehiculo: registro.tipo_vehiculo,
      tipo_servicio: registro.tipo_servicio,
      hora_entrada: hora_entrada.toLocaleString("es-CO"),
      hora_salida: hora_salida.toLocaleString("es-CO"),
      tiempo_estancia: `${Math.floor(horas_total)}h ${minutos_total % 60}m`,
      minutos_total,
      horas_total: horas_total.toFixed(2),
      tarifa_aplicada: cobro.tarifa_aplicada,
      tarifa_minima: tarifa.tarifa_minima ? `$${tarifa.tarifa_minima} COP` : "No aplica",
      descuento: cobro.descuento_aplicado ? `${cobro.porcentaje_descuento}%` : "No aplica",
      valor_antes_descuento: cobro.valor_antes_descuento,
      valor_a_cobrar: cobro.valor_total,
      metodos_pago: ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "OTRO"],
    });
  } catch (err) {
    console.error("Error en pre-salida:", err);
    res.status(500).json({ error: "Error calculando salida." });
  }
});

module.exports = router;
