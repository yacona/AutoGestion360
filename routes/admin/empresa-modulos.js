'use strict';

/**
 * routes/admin/empresa-modulos.js
 *
 * CRUD de overrides de módulos por empresa (tabla empresa_modulos).
 * Todos los endpoints requieren rol SuperAdmin.
 *
 * Montado en: /api/admin/empresa-modulos
 *
 * GET    /:empresaId           → estado de todos los módulos para la empresa
 * PUT    /:empresaId/:moduloId → crear/actualizar override
 * DELETE /:empresaId/:moduloId → eliminar override (vuelve al plan)
 * PUT    /:empresaId/bulk      → sobreescritura masiva (array de overrides)
 */

const express = require('express');
const {
  getModulosParaEmpresa,
  upsertModuloOverride,
  removeModuloOverride,
} = require('../../services/adminService');

const router = express.Router();

// ─── Guard SuperAdmin ────────────────────────────────────────

function isSuperAdmin(req) {
  return String(req.user?.rol || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s_-]+/g, '') === 'superadmin';
}

router.use((req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ error: 'Acceso denegado. Solo SuperAdmin.' });
  }
  next();
});

// ─── GET /:empresaId ────────────────────────────────────────

router.get('/:empresaId', async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId);
    if (!empresaId) return res.status(400).json({ error: 'ID de empresa inválido.' });

    const modulos = await getModulosParaEmpresa(empresaId);
    res.json(modulos);
  } catch (err) {
    console.error('[empresa-modulos GET]', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Error obteniendo módulos.' });
  }
});

// ─── PUT /:empresaId/:moduloId ───────────────────────────────
//
// Body: { activo: boolean, limite_override?: number|null, notas?: string }

router.put('/:empresaId/:moduloId', async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId);
    const moduloId  = Number(req.params.moduloId);
    if (!empresaId || !moduloId) {
      return res.status(400).json({ error: 'IDs inválidos.' });
    }

    const activo        = req.body.activo !== false;
    const limiteOverride = req.body.limite_override ?? null;
    const notas          = req.body.notas ?? null;

    const override = await upsertModuloOverride(
      empresaId, moduloId,
      { activo, limiteOverride, notas }
    );

    res.json({ mensaje: 'Override guardado.', override });
  } catch (err) {
    console.error('[empresa-modulos PUT]', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Error guardando override.' });
  }
});

// ─── DELETE /:empresaId/:moduloId ────────────────────────────

router.delete('/:empresaId/:moduloId', async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId);
    const moduloId  = Number(req.params.moduloId);
    if (!empresaId || !moduloId) {
      return res.status(400).json({ error: 'IDs inválidos.' });
    }

    const eliminado = await removeModuloOverride(empresaId, moduloId);
    if (!eliminado) {
      return res.status(404).json({ error: 'Override no encontrado.' });
    }

    res.json({ mensaje: 'Override eliminado. El módulo sigue el comportamiento del plan.' });
  } catch (err) {
    console.error('[empresa-modulos DELETE]', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Error eliminando override.' });
  }
});

// ─── PUT /:empresaId/bulk ────────────────────────────────────
//
// Body: { overrides: [{ modulo_id, activo, limite_override?, notas? }] }
// Permite guardar todos los toggles del panel en un solo request.

router.put('/:empresaId/bulk', async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  if (!empresaId) return res.status(400).json({ error: 'ID de empresa inválido.' });

  const overrides = req.body.overrides;
  if (!Array.isArray(overrides)) {
    return res.status(400).json({ error: 'Se esperaba { overrides: [...] }' });
  }

  try {
    const results = [];
    for (const item of overrides) {
      const moduloId = Number(item.modulo_id);
      if (!moduloId) continue;

      if (item.eliminar) {
        await removeModuloOverride(empresaId, moduloId);
        results.push({ modulo_id: moduloId, accion: 'eliminado' });
      } else {
        const saved = await upsertModuloOverride(empresaId, moduloId, {
          activo:        item.activo !== false,
          limiteOverride: item.limite_override ?? null,
          notas:          item.notas ?? null,
        });
        results.push({ modulo_id: moduloId, accion: 'guardado', override: saved });
      }
    }

    res.json({ mensaje: `${results.length} overrides procesados.`, results });
  } catch (err) {
    console.error('[empresa-modulos bulk]', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Error en bulk.' });
  }
});

module.exports = router;
