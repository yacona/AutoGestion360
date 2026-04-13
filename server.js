// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const authRoutes = require("./routes/auth");
const authMiddleware = require("./middleware/auth");

const clientesRoutes = require("./routes/clientes");
const vehiculosRoutes = require("./routes/vehiculos");
const parqueaderoRoutes = require("./routes/parqueadero");
const empleadosRoutes = require("./routes/empleados");
const lavaderoRoutes = require("./routes/lavadero");
const tallerRoutes = require("./routes/taller");
const reportesRoutes = require("./routes/reportes");
const tarifasRoutes = require("./routes/tarifas");
const pagosRoutes = require("./routes/pagos");
const alertasRoutes = require("./routes/alertas");
const auditorialRoutes = require("./routes/auditoria");
const reportesParqueaderoRoutes = require("./routes/reportes-parqueadero");

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend
app.use(express.static("frontend"));

// Ruta de prueba
app.get("/api/ping", (req, res) => {
  res.json({ mensaje: "AutoGestión360 backend OK 🚀" });
});

// Rutas públicas (todas las de auth.js quedan colgadas de /api)
// Rutas públicas (sin auth)
app.use("/api", authRoutes);

// Rutas privadas (con auth)
app.use("/api/clientes", authMiddleware, clientesRoutes);
app.use("/api/vehiculos", authMiddleware, vehiculosRoutes);
app.use("/api/parqueadero", authMiddleware, parqueaderoRoutes);
app.use("/api/empleados", authMiddleware, empleadosRoutes);
app.use("/api/lavadero", authMiddleware, lavaderoRoutes);
app.use("/api/taller", authMiddleware, tallerRoutes);
app.use("/api/reportes", authMiddleware, reportesRoutes);

// Rutas de parqueadero avanzado
app.use("/api/tarifas", authMiddleware, tarifasRoutes);
app.use("/api/pagos", authMiddleware, pagosRoutes);
app.use("/api/alertas", authMiddleware, alertasRoutes);
app.use("/api/auditoria", authMiddleware, auditorialRoutes);
app.use("/api/reportes/parqueadero", authMiddleware, reportesParqueaderoRoutes);



// Ruta protegida de ejemplo
app.get("/api/perfil", authMiddleware, (req, res) => {
  res.json({
    mensaje: "Acceso autorizado",
    usuario_actual: req.user,
  });
});

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`Servidor AutoGestión360 escuchando en http://localhost:${PORT}`);
});
