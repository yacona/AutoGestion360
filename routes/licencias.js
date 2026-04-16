// routes/licencias.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { enviarNotificacionLicencia } = require('../utils/email');
const { ensureLicenciasSchema } = require('../utils/licencias-schema');
const { upsertSuscripcionEmpresa } = require('../utils/suscripciones-schema');

function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function superAdminOnly(req, res, next) {
  if (normalizeRole(req.user.rol) !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado. Solo SuperAdmin.' });
  }
  next();
}

async function getLicenciaConModulos(licenciaId) {
  await ensureLicenciasSchema();
  const { rows: licencias } = await db.query(
    `SELECT id, nombre, descripcion, precio, creado_en
     FROM licencias
     WHERE id = $1`,
    [licenciaId]
  );

  if (licencias.length === 0) return null;

  const { rows: modulos } = await db.query(
    `SELECT m.id, m.nombre, m.descripcion
     FROM modulos m
     JOIN licencia_modulo lm ON lm.modulo_id = m.id
     WHERE lm.licencia_id = $1
     ORDER BY m.nombre`,
    [licenciaId]
  );

  return {
    ...licencias[0],
    modulos,
  };
}

async function getLicenciasCatalogo() {
  await ensureLicenciasSchema();
  const { rows: licencias } = await db.query(
    `SELECT id, nombre, descripcion, precio, creado_en
     FROM licencias
     ORDER BY precio NULLS LAST, nombre`
  );

  const { rows: modulos } = await db.query(
    `SELECT lm.licencia_id, m.id, m.nombre, m.descripcion
     FROM licencia_modulo lm
     JOIN modulos m ON m.id = lm.modulo_id
     ORDER BY m.nombre`
  );

  return licencias.map((licencia) => ({
    ...licencia,
    modulos: modulos
      .filter((modulo) => Number(modulo.licencia_id) === Number(licencia.id))
      .map(({ licencia_id, ...modulo }) => modulo),
  }));
}

// Crear una nueva licencia
router.post('/', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const { nombre, descripcion, precio } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre de la licencia es requerido' });
    }

    const query = `
      INSERT INTO licencias (nombre, descripcion, precio)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const { rows } = await db.query(query, [nombre, descripcion, precio]);

    res.status(201).json({ mensaje: 'Licencia creada exitosamente', licencia: rows[0] });
  } catch (error) {
    console.error('Error creando licencia:', error);
    if (error.code === '23505') { // unique_violation
      res.status(400).json({ error: 'Ya existe una licencia con ese nombre' });
    } else {
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
});

// Obtener todas las licencias
router.get('/', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const query = 'SELECT * FROM licencias ORDER BY creado_en DESC';
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo licencias:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar una licencia
router.put('/:id', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const { id } = req.params;
    const { nombre, descripcion, precio } = req.body;

    const query = `
      UPDATE licencias
      SET nombre = $1, descripcion = $2, precio = $3
      WHERE id = $4
      RETURNING *
    `;
    const { rows } = await db.query(query, [nombre, descripcion, precio, id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Licencia no encontrada' });
    }

    res.json({ mensaje: 'Licencia actualizada exitosamente', licencia: rows[0] });
  } catch (error) {
    console.error('Error actualizando licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Asignar módulos a una licencia
router.post('/:id/modulos', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const { id } = req.params;
    const { modulos } = req.body; // Array de modulo_ids

    if (!Array.isArray(modulos)) {
      return res.status(400).json({ error: 'modulos debe ser un array de IDs' });
    }

    // Primero, eliminar módulos existentes
    await db.query('DELETE FROM licencia_modulo WHERE licencia_id = $1', [id]);

    if (modulos.length > 0) {
      const values = modulos
        .map((_, index) => `($1, $${index + 2})`)
        .join(', ');
      await db.query(
        `INSERT INTO licencia_modulo (licencia_id, modulo_id) VALUES ${values}`,
        [id, ...modulos]
      );
    }

    res.json({ mensaje: 'Módulos asignados exitosamente' });
  } catch (error) {
    console.error('Error asignando módulos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener módulos de una licencia
router.get('/:id/modulos', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const { id } = req.params;
    const query = `
      SELECT m.* FROM modulos m
      JOIN licencia_modulo lm ON m.id = lm.modulo_id
      WHERE lm.licencia_id = $1
    `;
    const { rows } = await db.query(query, [id]);
    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo módulos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Asignar licencia a una empresa
router.get('/catalogo/completo', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const [licencias, modulosResult] = await Promise.all([
      getLicenciasCatalogo(),
      db.query('SELECT * FROM modulos ORDER BY nombre'),
    ]);

    res.json({
      licencias,
      modulos: modulosResult.rows,
    });
  } catch (error) {
    console.error('Error obteniendo catalogo de licencias:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/empresa/:empresaId', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const { empresaId } = req.params;
    const query = `
      SELECT el.*, e.nombre as empresa_nombre, l.nombre as licencia_nombre, l.descripcion, l.precio
      FROM empresa_licencia el
      JOIN empresas e ON el.empresa_id = e.id
      JOIN licencias l ON el.licencia_id = l.id
      WHERE el.empresa_id = $1 AND el.activa = true
      ORDER BY el.creado_en DESC
      LIMIT 1
    `;
    const { rows } = await db.query(query, [empresaId]);

    if (rows.length === 0) {
      return res.json({ mensaje: 'No hay licencia asignada' });
    }

    const licencia = await getLicenciaConModulos(rows[0].licencia_id);

    res.json({
      ...rows[0],
      modulos: licencia?.modulos || [],
    });
  } catch (error) {
    console.error('Error obteniendo licencia de empresa:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/asignar', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const { empresa_id, licencia_id, fecha_inicio, fecha_fin } = req.body;

    if (!empresa_id || !licencia_id) {
      return res.status(400).json({ error: 'empresa_id y licencia_id son requeridos' });
    }

    const licencia = await getLicenciaConModulos(licencia_id);
    if (!licencia) {
      return res.status(404).json({ error: 'Licencia no encontrada' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      await client.query('UPDATE empresa_licencia SET activa = false WHERE empresa_id = $1', [empresa_id]);

      const query = `
        INSERT INTO empresa_licencia (empresa_id, licencia_id, fecha_inicio, fecha_fin, activa)
        VALUES ($1, $2, COALESCE($3, NOW()), $4, true)
        ON CONFLICT (empresa_id) DO UPDATE
        SET licencia_id = EXCLUDED.licencia_id,
            fecha_inicio = EXCLUDED.fecha_inicio,
            fecha_fin = EXCLUDED.fecha_fin,
            activa = true,
            creado_en = NOW()
        RETURNING *
      `;
      const { rows } = await client.query(query, [empresa_id, licencia_id, fecha_inicio || null, fecha_fin || null]);

      await client.query(
        `UPDATE empresas
         SET licencia_tipo = $1,
             licencia_id = $2,
             licencia_inicio = COALESCE($3, NOW()),
             licencia_fin = $4,
             activa = true
         WHERE id = $5`,
        [licencia.nombre, licencia_id, fecha_inicio || null, fecha_fin || null, empresa_id]
      );

      await upsertSuscripcionEmpresa({
        queryable: client,
        empresaId: empresa_id,
        licenciaId: licencia_id,
        estado: normalizeRole(licencia.nombre) === "demo" ? "TRIAL" : "ACTIVA",
        fechaInicio: fecha_inicio || null,
        fechaFin: fecha_fin || null,
        renovacionAutomatica: false,
        pasarela: "MANUAL",
        observaciones: "Sincronizada desde asignacion de licencia",
        moneda: "COP",
        precioPlan: licencia.precio,
      });

      await client.query('COMMIT');

      res.status(201).json({
        mensaje: 'Licencia asignada exitosamente',
        asignacion: rows[0],
        licencia,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error asignando licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener todas las asignaciones de licencias
router.get('/asignaciones', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const query = `
      SELECT el.*, e.nombre as empresa_nombre, l.nombre as licencia_nombre
      FROM empresa_licencia el
      JOIN empresas e ON el.empresa_id = e.id
      JOIN licencias l ON el.licencia_id = l.id
      ORDER BY el.creado_en DESC
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo asignaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener módulos disponibles
router.get('/modulos/disponibles', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const query = 'SELECT * FROM modulos ORDER BY nombre';
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo módulos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener licencias próximas a vencer (para notificaciones)
router.get('/proximas-vencer', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const dias = parseInt(req.query.dias) || 30; // Días por defecto
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + dias);

    const query = `
      SELECT el.*, e.nombre as empresa_nombre, e.email_contacto, l.nombre as licencia_nombre
      FROM empresa_licencia el
      JOIN empresas e ON el.empresa_id = e.id
      JOIN licencias l ON el.licencia_id = l.id
      WHERE el.activa = true AND el.fecha_fin <= $1 AND el.fecha_fin > NOW()
      ORDER BY el.fecha_fin ASC
    `;
    const { rows } = await db.query(query, [fechaLimite]);
    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo licencias próximas a vencer:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Enviar notificaciones de licencias próximas a vencer
router.post('/enviar-notificaciones', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await ensureLicenciasSchema();
    const dias = parseInt(req.query.dias) || 30;
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + dias);

    const query = `
      SELECT el.*, e.nombre as empresa_nombre, e.email_contacto, l.nombre as licencia_nombre
      FROM empresa_licencia el
      JOIN empresas e ON el.empresa_id = e.id
      JOIN licencias l ON el.licencia_id = l.id
      WHERE el.activa = true AND el.fecha_fin <= $1 AND el.fecha_fin > NOW()
    `;
    const { rows: licencias } = await db.query(query, [fechaLimite]);

    let enviados = 0;
    let errores = 0;

    for (const licencia of licencias) {
      if (licencia.email_contacto) {
        const exito = await enviarNotificacionLicencia(
          licencia.email_contacto,
          licencia.empresa_nombre,
          licencia.licencia_nombre,
          licencia.fecha_fin
        );
        if (exito) enviados++;
        else errores++;
      }
    }

    res.json({
      mensaje: `Notificaciones enviadas: ${enviados}, Errores: ${errores}`,
      total: licencias.length
    });
  } catch (error) {
    console.error('Error enviando notificaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
