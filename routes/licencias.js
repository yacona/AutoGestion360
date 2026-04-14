// routes/licencias.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { enviarNotificacionLicencia } = require('../utils/email');

// Middleware para verificar si es admin (asumiendo que hay un rol 'admin')
function adminOnly(req, res, next) {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
  }
  next();
}

// Crear una nueva licencia
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
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
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const query = 'SELECT * FROM licencias ORDER BY creado_en DESC';
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo licencias:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar una licencia
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
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
router.post('/:id/modulos', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { modulos } = req.body; // Array de modulo_ids

    if (!Array.isArray(modulos)) {
      return res.status(400).json({ error: 'modulos debe ser un array de IDs' });
    }

    // Primero, eliminar módulos existentes
    await db.query('DELETE FROM licencia_modulo WHERE licencia_id = $1', [id]);

    // Insertar nuevos módulos
    const values = modulos.map(moduloId => `(${id}, ${moduloId})`).join(', ');
    if (values) {
      await db.query(`INSERT INTO licencia_modulo (licencia_id, modulo_id) VALUES ${values}`);
    }

    res.json({ mensaje: 'Módulos asignados exitosamente' });
  } catch (error) {
    console.error('Error asignando módulos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener módulos de una licencia
router.get('/:id/modulos', authMiddleware, adminOnly, async (req, res) => {
  try {
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
router.post('/asignar', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { empresa_id, licencia_id, fecha_inicio, fecha_fin } = req.body;

    if (!empresa_id || !licencia_id) {
      return res.status(400).json({ error: 'empresa_id y licencia_id son requeridos' });
    }

    // Desactivar licencia anterior si existe
    await db.query('UPDATE empresa_licencia SET activa = false WHERE empresa_id = $1', [empresa_id]);

    // Insertar nueva asignación
    const query = `
      INSERT INTO empresa_licencia (empresa_id, licencia_id, fecha_inicio, fecha_fin)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const { rows } = await db.query(query, [empresa_id, licencia_id, fecha_inicio, fecha_fin]);

    res.status(201).json({ mensaje: 'Licencia asignada exitosamente', asignacion: rows[0] });
  } catch (error) {
    console.error('Error asignando licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener todas las asignaciones de licencias
router.get('/asignaciones', authMiddleware, adminOnly, async (req, res) => {
  try {
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
router.get('/modulos/disponibles', authMiddleware, adminOnly, async (req, res) => {
  try {
    const query = 'SELECT * FROM modulos ORDER BY nombre';
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo módulos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener licencias próximas a vencer (para notificaciones)
router.get('/proximas-vencer', authMiddleware, adminOnly, async (req, res) => {
  try {
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
router.post('/enviar-notificaciones', authMiddleware, adminOnly, async (req, res) => {
  try {
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