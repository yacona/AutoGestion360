const db = require("../db");

const DEFAULT_MODULES = [
  ["dashboard", "Panel general de operación"],
  ["parqueadero", "Gestión de parqueadero"],
  ["clientes", "Gestión de clientes"],
  ["reportes", "Reportes e indicadores"],
  ["lavadero", "Gestión de lavadero"],
  ["taller", "Gestión de taller"],
  ["empleados", "Gestión de empleados y equipo"],
  ["usuarios", "Usuarios y roles de acceso"],
  ["configuracion", "Configuración de empresa"],
  ["empresas", "Administración multi-empresa"],
];

const DEFAULT_LICENSES = [
  {
    nombre: "Demo",
    descripcion: "Licencia de demostración para validar operación básica.",
    precio: 0,
    modulos: ["dashboard", "parqueadero", "clientes"],
  },
  {
    nombre: "Básica",
    descripcion: "Plan esencial para operación de parqueadero y reportes.",
    precio: 50000,
    modulos: ["dashboard", "parqueadero", "clientes", "reportes", "configuracion"],
  },
  {
    nombre: "Pro",
    descripcion: "Plan operativo con parqueadero, lavadero, taller y usuarios.",
    precio: 120000,
    modulos: ["dashboard", "parqueadero", "clientes", "reportes", "lavadero", "taller", "empleados", "usuarios", "configuracion"],
  },
  {
    nombre: "Premium",
    descripcion: "Plan completo con administración SaaS multi-empresa.",
    precio: 220000,
    modulos: ["dashboard", "parqueadero", "clientes", "reportes", "lavadero", "taller", "empleados", "usuarios", "configuracion", "empresas"],
  },
];

let schemaReady = false;

async function ensureLicenciasSchema(queryable = db) {
  if (schemaReady && queryable === db) return;

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS licencias (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL UNIQUE,
      descripcion TEXT,
      precio DECIMAL(10,2),
      creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await queryable.query(`
    ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS licencia_id INTEGER REFERENCES licencias(id)
  `);

  await queryable.query(`
    ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS licencia_inicio TIMESTAMP WITH TIME ZONE
  `);

  await queryable.query(`
    ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS licencia_fin TIMESTAMP WITH TIME ZONE
  `);

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS modulos (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL UNIQUE,
      descripcion TEXT,
      creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS licencia_modulo (
      id SERIAL PRIMARY KEY,
      licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
      modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
      UNIQUE(licencia_id, modulo_id)
    )
  `);

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS empresa_licencia (
      id SERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
      fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      fecha_fin TIMESTAMP WITH TIME ZONE,
      activa BOOLEAN DEFAULT TRUE,
      creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS empresa_licencia_empresa_id_key
    ON empresa_licencia (empresa_id)
  `);

  for (const [nombre, descripcion] of DEFAULT_MODULES) {
    await queryable.query(
      `INSERT INTO modulos (nombre, descripcion)
       VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE
       SET descripcion = EXCLUDED.descripcion`,
      [nombre, descripcion]
    );
  }

  for (const licencia of DEFAULT_LICENSES) {
    await queryable.query(
      `INSERT INTO licencias (nombre, descripcion, precio)
       VALUES ($1, $2, $3)
       ON CONFLICT (nombre) DO UPDATE
       SET descripcion = EXCLUDED.descripcion,
           precio = EXCLUDED.precio`,
      [licencia.nombre, licencia.descripcion, licencia.precio]
    );

    await queryable.query(
      `INSERT INTO licencia_modulo (licencia_id, modulo_id)
       SELECT l.id, m.id
       FROM licencias l
       JOIN modulos m ON m.nombre = ANY($2::text[])
       WHERE l.nombre = $1
       ON CONFLICT (licencia_id, modulo_id) DO NOTHING`,
      [licencia.nombre, licencia.modulos]
    );
  }

  await queryable.query(`
    UPDATE empresas e
    SET licencia_id = COALESCE(e.licencia_id, el.licencia_id),
        licencia_inicio = COALESCE(e.licencia_inicio, el.fecha_inicio),
        licencia_fin = COALESCE(e.licencia_fin, el.fecha_fin)
    FROM empresa_licencia el
    WHERE el.empresa_id = e.id
      AND el.activa = true
      AND e.licencia_id IS NULL
  `);

  await queryable.query(`
    UPDATE empresas e
    SET licencia_id = l.id,
        licencia_inicio = COALESCE(e.licencia_inicio, NOW())
    FROM licencias l
    WHERE e.licencia_id IS NULL
      AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) =
          LOWER(translate(COALESCE(e.licencia_tipo, 'Demo'), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
  `);

  if (queryable === db) schemaReady = true;
}

module.exports = {
  ensureLicenciasSchema,
};
