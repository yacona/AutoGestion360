'use strict';

const sedesService = require('./sedes.service');

async function listar(req, res, next) {
  try {
    const rows = await sedesService.listar(req.user, req.query);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const sede = await sedesService.obtener(req.user, Number(req.params.id));
    res.json(sede);
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    const sede = await sedesService.crear(req.user, req.body);
    res.status(201).json(sede);
  } catch (err) {
    next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    const sede = await sedesService.actualizar(req.user, Number(req.params.id), req.body);
    res.json(sede);
  } catch (err) {
    next(err);
  }
}

async function activar(req, res, next) {
  try {
    const sede = await sedesService.cambiarEstado(req.user, Number(req.params.id), true);
    res.json(sede);
  } catch (err) {
    next(err);
  }
}

async function desactivar(req, res, next) {
  try {
    const sede = await sedesService.cambiarEstado(req.user, Number(req.params.id), false);
    res.json(sede);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obtener, crear, actualizar, activar, desactivar };
