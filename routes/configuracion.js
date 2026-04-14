const express = require("express");
const {
  getParqueaderoConfig,
  saveParqueaderoConfig,
} = require("../utils/parqueadero-config");

const router = express.Router();

router.get("/parqueadero", async (req, res) => {
  try {
    const config = await getParqueaderoConfig(req.user.empresa_id);
    res.json(config);
  } catch (err) {
    console.error("Error obteniendo configuracion de parqueadero:", err);
    res.status(500).json({ error: "Error obteniendo configuracion de parqueadero." });
  }
});

router.put("/parqueadero", async (req, res) => {
  try {
    const config = await saveParqueaderoConfig(req.user.empresa_id, req.body);
    res.json({
      mensaje: "Configuracion de parqueadero actualizada exitosamente.",
      config,
    });
  } catch (err) {
    console.error("Error actualizando configuracion de parqueadero:", err);
    res.status(500).json({ error: "Error actualizando configuracion de parqueadero." });
  }
});

module.exports = router;
