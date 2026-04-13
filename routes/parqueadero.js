// routes/parqueadero.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

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
router.post("/entrada", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

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

    // Abrimos transacción
    await db.query("BEGIN");

    // 1) Verificar que NO haya un registro abierto para esa placa
    const { rows: abiertos } = await db.query(
      `SELECT id
       FROM parqueadero
       WHERE empresa_id = $1
         AND placa = $2
         AND hora_salida IS NULL
       LIMIT 1`,
      [empresa_id, placa]
    );

    if (abiertos.length > 0) {
      await db.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Ya existe una entrada activa para esta placa. Debe registrar la salida antes de una nueva entrada.",
      });
    }

    // 2) Buscar si el vehículo ya existe
    const { rows: vehiculos } = await db.query(
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
      if (!propietario_nombre || !propietario_documento) {
        await db.query("ROLLBACK");
        return res.status(400).json({
          error:
            "Vehículo nuevo. Debe registrar al menos nombre y documento del propietario.",
        });
      }

      // 2.1) Buscar si ya existe un cliente con ese documento
      let clienteRow;
      if (propietario_documento) {
        const { rows: clientesDoc } = await db.query(
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
        const insertCliente = await db.query(
          `INSERT INTO clientes
           (empresa_id, nombre, documento, telefono, correo)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, nombre, documento, telefono, correo`,
          [
            empresa_id,
            propietario_nombre,
            propietario_documento || null,
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
      const insertVehiculo = await db.query(
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

      // NOTA: aquí NO cambiamos propietario legal.
      // Eso se hará en un módulo aparte de "Cambio de propietario".
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
        await db.query("ROLLBACK");
        return res.status(400).json({
          error:
            "Si el conductor NO es el propietario, debe registrar al menos nombre y documento del conductor.",
        });
      }
    }

    // 4) Insertar registro de entrada en PARQUEADERO
    const insertParqueo = await db.query(
      `INSERT INTO parqueadero
       (
         empresa_id,
         vehiculo_id,
         cliente_id,       -- propietario legal
         placa,
         tipo_vehiculo,
         nombre_cliente,   -- nombre del CONDUCTOR que ingresa
         telefono,         -- teléfono del conductor
         es_propietario,   -- indica si el conductor es el propietario
         observaciones
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        empresa_id,
        vehiculo_id,
        propietario_cliente_id,
        placa,
        tipo_vehiculo,
        nombre_conductor_final || propietario_final.nombre || null,
        telefono_conductor_final || propietario_final.telefono || null,
        es_conductor_propietario,
        observaciones || null,
      ]
    );

    await db.query("COMMIT");

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
    try {
      await db.query("ROLLBACK");
    } catch (_) {}
    return res
      .status(500)
      .json({ error: "Error registrando entrada al parqueadero." });
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
module.exports = router;