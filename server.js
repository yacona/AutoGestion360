// server.js — punto de arranque. Toda la configuración vive en src/app.js
const app = require('./src/app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Servidor AutoGestión360 escuchando en http://localhost:${PORT}`);
});
