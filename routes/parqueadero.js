// routes/parqueadero.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

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
      return res
        .status(400)
        .json({ error: "Debe indicar si el conductor es el propietario (true/false)." });
    }

    // Abrimos transacción en una sola conexión del pool
    client = await db.connect();
    await client.query("BEGIN");

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
      if (!propietario_nombre) {
        await client.query("ROLLBACK");
        client.release();
        client = null;
        return res.status(400).json({
          error:
            "Vehículo nuevo. Debe registrar al menos nombre del propietario.",
        });
      }

      // 2.1) Buscar si ya existe un cliente con ese documento (solo si hay documento válido)
      let clienteRow;
      if (propietario_documento && propietario_documento !== "SIN_DOCUMENTO") {
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
      if (!clienteRow) {
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

      propietario_cliente_id = clienteRow.id;
      propietario_final = {
        id: clienteRow.id,
        nombre: clienteRow.nombre,
        documento: clienteRow.documento,
        telefono: clienteRow.telefono,
        correo: clienteRow.correo,
      };

      // 2.3) Crear el vehículo
      const insertVehiculo = await client.query(
        `INSERT INTO vehiculos
         (empresa_id, cliente_id, placa, tipo_vehiculo)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [empresa_id, propietario_cliente_id, placa, tipo_vehiculo]
      );

      vehiculo_id = insertVehiculo.rows[0].id;
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
      if (!conductor_nombre || !conductor_documento) {
        await client.query("ROLLBACK");
        client.release();
        client = null;
        return res.status(400).json({
          error:
            "Si el conductor NO es el propietario, debe registrar al menos nombre y documento del conductor.",
        });
      }
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
         evidencia_url
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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

    // 2️⃣ Historial de PARQUEADERO (últimos 10 registros)
    const { rows: histParqueadero } = await db.query(
      `SELECT
         id,
         hora_entrada,
         hora_salida,
         minutos_total,
         valor_total,
         metodo_pago,
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
      existe: !!vehiculo,
      vehiculo: vehiculo
        ? {
            id: vehiculo.id,
            placa: vehiculo.placa,
            tipo_vehiculo: vehiculo.tipo_vehiculo,
            marca: vehiculo.marca,
            modelo: vehiculo.modelo,
            color: vehiculo.color,
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
        : null,
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
    const metodos_validos = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "OTRO"];
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

    // 1) Buscar el registro activo por ID y empresa
    const { rows: activos } = await client.query(
      `SELECT id, hora_entrada, tipo_vehiculo, placa
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
    const { rows: tarifas } = await client.query(
      `SELECT tarifa_por_hora, tarifa_minima, descuento_prolongada_horas, descuento_prolongada_porcentaje
       FROM tarifas WHERE empresa_id = $1 AND tipo_vehiculo = $2 AND activo = TRUE`,
      [empresa_id, registro.tipo_vehiculo]
    );

    let tarifa_por_hora = 1000;
    let tarifa_minima = null;
    let porcentaje_descuento = 0;

    if (tarifas.length > 0) {
      const tarifa = tarifas[0];
      tarifa_por_hora = parseFloat(tarifa.tarifa_por_hora);
      tarifa_minima = tarifa.tarifa_minima ? parseFloat(tarifa.tarifa_minima) : null;
      porcentaje_descuento = tarifas.length > 0 && tarifas[0].descuento_prolongada_horas &&
        minutos_total / 60 >= tarifas[0].descuento_prolongada_horas
        ? parseFloat(tarifas[0].descuento_prolongada_porcentaje) || 0
        : 0;
    }

    const horas_total = minutos_total / 60;
    let valor_total = Math.ceil(horas_total * tarifa_por_hora);
    if (tarifa_minima && valor_total < tarifa_minima) valor_total = Math.ceil(tarifa_minima);
    if (porcentaje_descuento > 0) valor_total = Math.ceil(valor_total * (1 - porcentaje_descuento / 100));

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
        tarifa_aplicada: `${tarifa_por_hora} COP/hora`,
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
    const { rows } = await db.query(
      `SELECT
         p.id,
         p.placa,
         p.tipo_vehiculo,
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

    const { rows } = await db.query(
      `SELECT
         p.id,
         p.placa,
         p.tipo_vehiculo,
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

    // Buscar registro activo
    const { rows: activos } = await db.query(
      `SELECT id, hora_entrada, tipo_vehiculo, placa, nombre_cliente, valor_total
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
    const { rows: tarifas } = await db.query(
      `SELECT tarifa_por_hora, tarifa_minima, descuento_prolongada_horas, descuento_prolongada_porcentaje
       FROM tarifas WHERE empresa_id = $1 AND tipo_vehiculo = $2 AND activo = TRUE`,
      [empresa_id, registro.tipo_vehiculo]
    );

    let tarifa_por_hora = 1000;
    let tarifa_minima = null;
    let porcentaje_descuento = 0;
    let descuento_aplicado = false;

    if (tarifas.length > 0) {
      const tarifa = tarifas[0];
      tarifa_por_hora = parseFloat(tarifa.tarifa_por_hora);
      tarifa_minima = tarifa.tarifa_minima ? parseFloat(tarifa.tarifa_minima) : null;
      
      if (tarifas[0].descuento_prolongada_horas && 
          horas_total >= tarifas[0].descuento_prolongada_horas) {
        porcentaje_descuento = parseFloat(tarifas[0].descuento_prolongada_porcentaje) || 0;
        descuento_aplicado = true;
      }
    }

    let valor_total = Math.ceil(horas_total * tarifa_por_hora);
    if (tarifa_minima && valor_total < tarifa_minima) {
      valor_total = Math.ceil(tarifa_minima);
    }

    const valor_antes_descuento = valor_total;
    if (porcentaje_descuento > 0) {
      valor_total = Math.ceil(valor_total * (1 - porcentaje_descuento / 100));
    }

    res.json({
      registro_id,
      placa: registro.placa,
      cliente: registro.nombre_cliente,
      tipo_vehiculo: registro.tipo_vehiculo,
      hora_entrada: hora_entrada.toLocaleString("es-CO"),
      hora_salida: hora_salida.toLocaleString("es-CO"),
      tiempo_estancia: `${Math.floor(horas_total)}h ${minutos_total % 60}m`,
      minutos_total,
      horas_total: horas_total.toFixed(2),
      tarifa_aplicada: `$${tarifa_por_hora} COP/hora`,
      tarifa_minima: tarifa_minima ? `$${tarifa_minima} COP` : "No aplica",
      descuento: descuento_aplicado ? `${porcentaje_descuento}%` : "No aplica",
      valor_antes_descuento,
      valor_a_cobrar: valor_total,
      metodos_pago: ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "OTRO"],
    });
  } catch (err) {
    console.error("Error en pre-salida:", err);
    res.status(500).json({ error: "Error calculando salida." });
  }
});

module.exports = router;
