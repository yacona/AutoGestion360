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
const licenciasRoutes = require("./routes/licencias");
const configuracionRoutes = require("./routes/configuracion");
const empresasRoutes = require("./routes/empresas");
const usuariosRoutes = require("./routes/usuarios");
const licenseMiddleware = require("./middleware/licencia");

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend
app.use(express.static("frontend"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ruta de prueba
app.get("/api/ping", (req, res) => {
  res.json({ mensaje: "AutoGestión360 backend OK 🚀" });
});

// Rutas públicas (todas las de auth.js quedan colgadas de /api)
// Rutas públicas (sin auth)
app.use("/api", authRoutes);

// Rutas privadas (con auth y verificación de licencia)
app.use("/api/clientes", authMiddleware, licenseMiddleware("clientes"), clientesRoutes);
app.use("/api/vehiculos", authMiddleware, licenseMiddleware("parqueadero"), vehiculosRoutes);
app.use("/api/parqueadero", authMiddleware, licenseMiddleware("parqueadero"), parqueaderoRoutes);
app.use("/api/empleados", authMiddleware, licenseMiddleware("empleados"), empleadosRoutes);
app.use("/api/lavadero", authMiddleware, licenseMiddleware("lavadero"), lavaderoRoutes);
app.use("/api/taller", authMiddleware, licenseMiddleware("taller"), tallerRoutes);
app.use("/api/reportes", authMiddleware, licenseMiddleware("reportes"), reportesRoutes);

// Rutas de parqueadero avanzado
app.use("/api/tarifas", authMiddleware, licenseMiddleware("configuracion"), tarifasRoutes);
app.use("/api/pagos", authMiddleware, pagosRoutes);
app.use("/api/alertas", authMiddleware, alertasRoutes);
app.use("/api/auditoria", authMiddleware, auditorialRoutes);
app.use("/api/reportes/parqueadero", authMiddleware, licenseMiddleware("reportes"), reportesParqueaderoRoutes);
app.use("/api/configuracion", authMiddleware, licenseMiddleware("configuracion"), configuracionRoutes);
app.use("/api/empresas", authMiddleware, empresasRoutes);
app.use("/api/usuarios", authMiddleware, licenseMiddleware("usuarios"), usuariosRoutes);

// Rutas de licencias (solo admin)
app.use("/api/licencias", licenciasRoutes);



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
