const db = require("../db");

const VEHICLE_DEFAULTS = {
  CARRO: {
    label: "Vehiculos / Carros",
    bahias: 30,
    valor_dia: 42000,
    fraccion_dia_minutos: 480,
    valor_primera_fraccion: 5200,
    tiempo_primera_fraccion: 58,
    valor_segunda_fraccion: 1300,
    tiempo_segunda_fraccion: 15,
  },
  MOTO: {
    label: "Motos",
    bahias: 10,
    valor_dia: 16000,
    fraccion_dia_minutos: 480,
    valor_primera_fraccion: 2000,
    tiempo_primera_fraccion: 60,
    valor_segunda_fraccion: 500,
    tiempo_segunda_fraccion: 15,
  },
};

const DAY_DEFAULTS = [
  { dia_codigo: "D", dia_nombre: "Domingo" },
  { dia_codigo: "L", dia_nombre: "Lunes" },
  { dia_codigo: "M", dia_nombre: "Martes" },
  { dia_codigo: "MI", dia_nombre: "Miercoles" },
  { dia_codigo: "J", dia_nombre: "Jueves" },
  { dia_codigo: "V", dia_nombre: "Viernes" },
  { dia_codigo: "S", dia_nombre: "Sabado" },
];

const DAY_BY_JS_INDEX = ["D", "L", "M", "MI", "J", "V", "S"];

function asNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asInteger(value, fallback = 0) {
  return Math.max(0, Math.round(asNumber(value, fallback)));
}

function parseHourValue(value, fallback = 0) {
  if (typeof value === "number") {
    return Math.min(23, Math.max(0, Math.round(value)));
  }

  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return fallback;

  const match = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?$/);
  if (!match) return fallback;

  let hour = Number(match[1]);
  const minutes = match[2] || "00";
  const suffix = match[3];

  if (minutes !== "00") return fallback;

  if (suffix) {
    if (hour < 1 || hour > 12) return fallback;
    if (suffix === "AM") hour = hour === 12 ? 0 : hour;
    if (suffix === "PM") hour = hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    return fallback;
  }

  return hour;
}

function boolValue(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  return value === true || value === "true" || value === "SI" || value === "1" || value === 1;
}

function normalizeVehicle(tipo, tarifa, config) {
  const defaults = VEHICLE_DEFAULTS[tipo];
  const capacidadKey = tipo === "CARRO" ? "capacidad_carros" : "capacidad_motos";
  const valorPrimeraFraccion = asNumber(tarifa?.valor_primera_fraccion, defaults.valor_primera_fraccion);

  return {
    tipo_vehiculo: tipo,
    label: defaults.label,
    bahias: asInteger(config?.[capacidadKey], defaults.bahias),
    valor_dia: asNumber(tarifa?.valor_dia, defaults.valor_dia),
    fraccion_dia_minutos: asInteger(tarifa?.fraccion_dia_minutos, defaults.fraccion_dia_minutos),
    valor_primera_fraccion: valorPrimeraFraccion,
    tiempo_primera_fraccion: asInteger(tarifa?.tiempo_primera_fraccion, defaults.tiempo_primera_fraccion),
    valor_segunda_fraccion: asNumber(tarifa?.valor_segunda_fraccion, defaults.valor_segunda_fraccion),
    tiempo_segunda_fraccion: asInteger(tarifa?.tiempo_segunda_fraccion, defaults.tiempo_segunda_fraccion),
    tarifa_por_hora: asNumber(tarifa?.tarifa_por_hora, defaults.valor_primera_fraccion),
    tarifa_minima: valorPrimeraFraccion,
    descuento_prolongada_horas: tarifa?.descuento_prolongada_horas,
    descuento_prolongada_porcentaje: tarifa?.descuento_prolongada_porcentaje,
  };
}

function normalizeRule(rule) {
  return {
    dia_codigo: rule.dia_codigo,
    dia_nombre: rule.dia_nombre,
    aplica: boolValue(rule.aplica, false),
    hora_inicio_gratis: parseHourValue(rule.hora_inicio_gratis, 7),
    hora_fin_gratis: parseHourValue(rule.hora_fin_gratis, 11),
    minutos_gracia: asInteger(rule.minutos_gracia, 15),
  };
}

async function ensureParqueaderoConfigSchema(queryable = db) {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS configuracion_parqueadero (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE UNIQUE,
      capacidad_total INTEGER DEFAULT 40,
      tiempo_maximo_horas INTEGER DEFAULT 24,
      alertar_en_horas INTEGER DEFAULT 8,
      descuento_cliente_frecuente BOOLEAN DEFAULT FALSE,
      creado_en TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS tarifas (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      tipo_vehiculo VARCHAR(30) NOT NULL,
      tarifa_por_hora NUMERIC(12,2) NOT NULL,
      tarifa_minima NUMERIC(12,2),
      descuento_prolongada_horas INTEGER,
      descuento_prolongada_porcentaje NUMERIC(5,2),
      activo BOOLEAN DEFAULT TRUE,
      creado_en TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS tarifas_empresa_id_tipo_vehiculo_key
    ON tarifas (empresa_id, tipo_vehiculo)
  `);

  const configColumns = [
    "ADD COLUMN IF NOT EXISTS modulo_activo BOOLEAN DEFAULT TRUE",
    "ADD COLUMN IF NOT EXISTS solo_facturacion BOOLEAN DEFAULT FALSE",
    "ADD COLUMN IF NOT EXISTS valor_valet_parking NUMERIC(12,2) DEFAULT 0",
    "ADD COLUMN IF NOT EXISTS capacidad_carros INTEGER DEFAULT 30",
    "ADD COLUMN IF NOT EXISTS capacidad_motos INTEGER DEFAULT 10",
  ];

  for (const columnSql of configColumns) {
    await queryable.query(`ALTER TABLE configuracion_parqueadero ${columnSql}`);
  }

  const tarifaColumns = [
    "ADD COLUMN IF NOT EXISTS valor_dia NUMERIC(12,2)",
    "ADD COLUMN IF NOT EXISTS fraccion_dia_minutos INTEGER",
    "ADD COLUMN IF NOT EXISTS valor_primera_fraccion NUMERIC(12,2)",
    "ADD COLUMN IF NOT EXISTS tiempo_primera_fraccion INTEGER",
    "ADD COLUMN IF NOT EXISTS valor_segunda_fraccion NUMERIC(12,2)",
    "ADD COLUMN IF NOT EXISTS tiempo_segunda_fraccion INTEGER",
  ];

  for (const columnSql of tarifaColumns) {
    await queryable.query(`ALTER TABLE tarifas ${columnSql}`);
  }

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS reglas_parqueadero (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      dia_codigo VARCHAR(2) NOT NULL,
      dia_nombre VARCHAR(20) NOT NULL,
      aplica BOOLEAN DEFAULT FALSE,
      hora_inicio_gratis INTEGER DEFAULT 7,
      hora_fin_gratis INTEGER DEFAULT 11,
      minutos_gracia INTEGER DEFAULT 15,
      creado_en TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS reglas_parqueadero_empresa_dia_key
    ON reglas_parqueadero (empresa_id, dia_codigo)
  `);
}

async function ensureDefaultParqueaderoRows(empresaId, queryable = db) {
  await ensureParqueaderoConfigSchema(queryable);

  await queryable.query(
    `INSERT INTO configuracion_parqueadero
     (empresa_id, capacidad_total, modulo_activo, solo_facturacion, valor_valet_parking, capacidad_carros, capacidad_motos)
     VALUES ($1, $2, TRUE, FALSE, 0, $3, $4)
     ON CONFLICT (empresa_id) DO UPDATE
     SET capacidad_carros = COALESCE(configuracion_parqueadero.capacidad_carros, EXCLUDED.capacidad_carros),
         capacidad_motos = COALESCE(configuracion_parqueadero.capacidad_motos, EXCLUDED.capacidad_motos),
         capacidad_total = COALESCE(configuracion_parqueadero.capacidad_total, EXCLUDED.capacidad_total)`,
    [
      empresaId,
      VEHICLE_DEFAULTS.CARRO.bahias + VEHICLE_DEFAULTS.MOTO.bahias,
      VEHICLE_DEFAULTS.CARRO.bahias,
      VEHICLE_DEFAULTS.MOTO.bahias,
    ]
  );

  for (const [tipo, defaults] of Object.entries(VEHICLE_DEFAULTS)) {
    const tarifaPorHora = Math.ceil(defaults.valor_primera_fraccion / (defaults.tiempo_primera_fraccion / 60));
    await queryable.query(
      `INSERT INTO tarifas
       (empresa_id, tipo_vehiculo, tarifa_por_hora, tarifa_minima, valor_dia, fraccion_dia_minutos,
        valor_primera_fraccion, tiempo_primera_fraccion, valor_segunda_fraccion, tiempo_segunda_fraccion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (empresa_id, tipo_vehiculo) DO UPDATE
       SET valor_dia = COALESCE(tarifas.valor_dia, EXCLUDED.valor_dia),
           fraccion_dia_minutos = COALESCE(tarifas.fraccion_dia_minutos, EXCLUDED.fraccion_dia_minutos),
           valor_primera_fraccion = COALESCE(tarifas.valor_primera_fraccion, EXCLUDED.valor_primera_fraccion),
           tiempo_primera_fraccion = COALESCE(tarifas.tiempo_primera_fraccion, EXCLUDED.tiempo_primera_fraccion),
           valor_segunda_fraccion = COALESCE(tarifas.valor_segunda_fraccion, EXCLUDED.valor_segunda_fraccion),
           tiempo_segunda_fraccion = COALESCE(tarifas.tiempo_segunda_fraccion, EXCLUDED.tiempo_segunda_fraccion),
           actualizado_en = NOW()`,
      [
        empresaId,
        tipo,
        tarifaPorHora,
        defaults.valor_primera_fraccion,
        defaults.valor_dia,
        defaults.fraccion_dia_minutos,
        defaults.valor_primera_fraccion,
        defaults.tiempo_primera_fraccion,
        defaults.valor_segunda_fraccion,
        defaults.tiempo_segunda_fraccion,
      ]
    );
  }

  for (const day of DAY_DEFAULTS) {
    await queryable.query(
      `INSERT INTO reglas_parqueadero
       (empresa_id, dia_codigo, dia_nombre, aplica, hora_inicio_gratis, hora_fin_gratis, minutos_gracia)
       VALUES ($1,$2,$3,FALSE,7,11,15)
       ON CONFLICT (empresa_id, dia_codigo) DO NOTHING`,
      [empresaId, day.dia_codigo, day.dia_nombre]
    );
  }
}

async function getParqueaderoConfig(empresaId, queryable = db) {
  await ensureDefaultParqueaderoRows(empresaId, queryable);

  const { rows: configRows } = await queryable.query(
    `SELECT * FROM configuracion_parqueadero WHERE empresa_id = $1`,
    [empresaId]
  );
  const config = configRows[0] || {};

  const { rows: tarifaRows } = await queryable.query(
    `SELECT * FROM tarifas
     WHERE empresa_id = $1 AND tipo_vehiculo IN ('CARRO', 'MOTO') AND activo = TRUE`,
    [empresaId]
  );

  const tarifasByTipo = Object.fromEntries(tarifaRows.map((tarifa) => [tarifa.tipo_vehiculo, tarifa]));

  const { rows: ruleRows } = await queryable.query(
    `SELECT * FROM reglas_parqueadero
     WHERE empresa_id = $1
     ORDER BY CASE dia_codigo
       WHEN 'D' THEN 1 WHEN 'L' THEN 2 WHEN 'M' THEN 3 WHEN 'MI' THEN 4
       WHEN 'J' THEN 5 WHEN 'V' THEN 6 WHEN 'S' THEN 7 ELSE 8 END`,
    [empresaId]
  );

  const vehiculos = {
    CARRO: normalizeVehicle("CARRO", tarifasByTipo.CARRO, config),
    MOTO: normalizeVehicle("MOTO", tarifasByTipo.MOTO, config),
  };

  return {
    general: {
      modulo_activo: boolValue(config.modulo_activo, true),
      solo_facturacion: boolValue(config.solo_facturacion, false),
      valor_valet_parking: asNumber(config.valor_valet_parking, 0),
      capacidad_total: asInteger(config.capacidad_total, vehiculos.CARRO.bahias + vehiculos.MOTO.bahias),
    },
    vehiculos,
    reglas: ruleRows.map(normalizeRule),
  };
}

function sanitizeVehicleInput(tipo, input = {}) {
  const defaults = VEHICLE_DEFAULTS[tipo];
  return {
    bahias: asInteger(input.bahias, defaults.bahias),
    valor_dia: asNumber(input.valor_dia, defaults.valor_dia),
    fraccion_dia_minutos: Math.max(1, asInteger(input.fraccion_dia_minutos, defaults.fraccion_dia_minutos)),
    valor_primera_fraccion: asNumber(input.valor_primera_fraccion, defaults.valor_primera_fraccion),
    tiempo_primera_fraccion: Math.max(1, asInteger(input.tiempo_primera_fraccion, defaults.tiempo_primera_fraccion)),
    valor_segunda_fraccion: asNumber(input.valor_segunda_fraccion, defaults.valor_segunda_fraccion),
    tiempo_segunda_fraccion: Math.max(1, asInteger(input.tiempo_segunda_fraccion, defaults.tiempo_segunda_fraccion)),
  };
}

async function saveParqueaderoConfig(empresaId, payload = {}, queryable = db) {
  await ensureDefaultParqueaderoRows(empresaId, queryable);

  const carro = sanitizeVehicleInput("CARRO", payload.vehiculos?.CARRO);
  const moto = sanitizeVehicleInput("MOTO", payload.vehiculos?.MOTO);
  const capacidadTotal = carro.bahias + moto.bahias;

  await queryable.query(
    `INSERT INTO configuracion_parqueadero
     (empresa_id, capacidad_total, modulo_activo, solo_facturacion, valor_valet_parking, capacidad_carros, capacidad_motos)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (empresa_id) DO UPDATE
     SET capacidad_total = EXCLUDED.capacidad_total,
         modulo_activo = EXCLUDED.modulo_activo,
         solo_facturacion = EXCLUDED.solo_facturacion,
         valor_valet_parking = EXCLUDED.valor_valet_parking,
         capacidad_carros = EXCLUDED.capacidad_carros,
         capacidad_motos = EXCLUDED.capacidad_motos,
         actualizado_en = NOW()`,
    [
      empresaId,
      capacidadTotal,
      boolValue(payload.general?.modulo_activo, true),
      boolValue(payload.general?.solo_facturacion, false),
      asNumber(payload.general?.valor_valet_parking, 0),
      carro.bahias,
      moto.bahias,
    ]
  );

  for (const [tipo, vehicle] of Object.entries({ CARRO: carro, MOTO: moto })) {
    const tarifaPorHora = Math.ceil(vehicle.valor_primera_fraccion / (vehicle.tiempo_primera_fraccion / 60));
    await queryable.query(
      `INSERT INTO tarifas
       (empresa_id, tipo_vehiculo, tarifa_por_hora, tarifa_minima, valor_dia, fraccion_dia_minutos,
        valor_primera_fraccion, tiempo_primera_fraccion, valor_segunda_fraccion, tiempo_segunda_fraccion, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
       ON CONFLICT (empresa_id, tipo_vehiculo) DO UPDATE
       SET tarifa_por_hora = EXCLUDED.tarifa_por_hora,
           tarifa_minima = EXCLUDED.tarifa_minima,
           valor_dia = EXCLUDED.valor_dia,
           fraccion_dia_minutos = EXCLUDED.fraccion_dia_minutos,
           valor_primera_fraccion = EXCLUDED.valor_primera_fraccion,
           tiempo_primera_fraccion = EXCLUDED.tiempo_primera_fraccion,
           valor_segunda_fraccion = EXCLUDED.valor_segunda_fraccion,
           tiempo_segunda_fraccion = EXCLUDED.tiempo_segunda_fraccion,
           activo = TRUE,
           actualizado_en = NOW()`,
      [
        empresaId,
        tipo,
        tarifaPorHora,
        vehicle.valor_primera_fraccion,
        vehicle.valor_dia,
        vehicle.fraccion_dia_minutos,
        vehicle.valor_primera_fraccion,
        vehicle.tiempo_primera_fraccion,
        vehicle.valor_segunda_fraccion,
        vehicle.tiempo_segunda_fraccion,
      ]
    );
  }

  const incomingRules = Array.isArray(payload.reglas) ? payload.reglas : [];
  const rulesByDay = Object.fromEntries(incomingRules.map((rule) => [rule.dia_codigo, rule]));

  for (const day of DAY_DEFAULTS) {
    const rule = rulesByDay[day.dia_codigo] || {};
    await queryable.query(
      `INSERT INTO reglas_parqueadero
       (empresa_id, dia_codigo, dia_nombre, aplica, hora_inicio_gratis, hora_fin_gratis, minutos_gracia)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (empresa_id, dia_codigo) DO UPDATE
       SET aplica = EXCLUDED.aplica,
           hora_inicio_gratis = EXCLUDED.hora_inicio_gratis,
           hora_fin_gratis = EXCLUDED.hora_fin_gratis,
           minutos_gracia = EXCLUDED.minutos_gracia,
           actualizado_en = NOW()`,
      [
        empresaId,
        day.dia_codigo,
        day.dia_nombre,
        boolValue(rule.aplica, false),
        parseHourValue(rule.hora_inicio_gratis, 7),
        parseHourValue(rule.hora_fin_gratis, 11),
        asInteger(rule.minutos_gracia, 15),
      ]
    );
  }

  return getParqueaderoConfig(empresaId, queryable);
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function freeMinutesForRule(horaEntrada, horaSalida, rule) {
  if (!rule || !rule.aplica) return 0;
  if (horaEntrada.toDateString() !== horaSalida.toDateString()) return 0;

  const start = parseHourValue(rule.hora_inicio_gratis, 7) * 60;
  const end = parseHourValue(rule.hora_fin_gratis, 11) * 60;
  if (end <= start) return 0;

  const entryMinute = minutesSinceMidnight(horaEntrada);
  const exitMinute = minutesSinceMidnight(horaSalida);
  return Math.max(0, Math.min(exitMinute, end) - Math.max(entryMinute, start));
}

function calculateFractionCharge(minutes, tarifa) {
  const valorDia = asNumber(tarifa?.valor_dia, 0);
  const fraccionDia = asInteger(tarifa?.fraccion_dia_minutos, 0);
  const valorPrimera = asNumber(tarifa?.valor_primera_fraccion, 0);
  const tiempoPrimera = asInteger(tarifa?.tiempo_primera_fraccion, 0);
  const valorSegunda = asNumber(tarifa?.valor_segunda_fraccion, 0);
  const tiempoSegunda = asInteger(tarifa?.tiempo_segunda_fraccion, 0);

  const hasFractionConfig = valorDia > 0 && fraccionDia > 0 && valorPrimera > 0 && tiempoPrimera > 0 && valorSegunda > 0 && tiempoSegunda > 0;
  if (!hasFractionConfig) return null;

  const fullDays = Math.floor(minutes / fraccionDia);
  const remainder = minutes % fraccionDia;
  let remainderValue = 0;

  if (remainder > 0) {
    remainderValue = valorPrimera;
    if (remainder > tiempoPrimera) {
      remainderValue += Math.ceil((remainder - tiempoPrimera) / tiempoSegunda) * valorSegunda;
    }
    remainderValue = Math.min(remainderValue, valorDia);
  }

  return Math.ceil(fullDays * valorDia + remainderValue);
}

function calculateParkingCharge({ minutosTotal, horaEntrada, horaSalida, tarifa, reglas = [] }) {
  const entry = horaEntrada instanceof Date ? horaEntrada : new Date(horaEntrada);
  const exit = horaSalida instanceof Date ? horaSalida : new Date(horaSalida);
  const dayCode = DAY_BY_JS_INDEX[entry.getDay()];
  const rule = reglas.find((item) => item.dia_codigo === dayCode);
  const normalizedRule = rule ? normalizeRule(rule) : null;
  const freeMinutes = freeMinutesForRule(entry, exit, normalizedRule);
  const chargeableMinutes = Math.max(0, asInteger(minutosTotal, 0) - freeMinutes);

  if (normalizedRule?.aplica && chargeableMinutes <= normalizedRule.minutos_gracia) {
    return {
      valor_total: 0,
      valor_antes_descuento: 0,
      porcentaje_descuento: 0,
      descuento_aplicado: false,
      minutos_cobrados: 0,
      tarifa_aplicada: "Regla de gracia",
    };
  }

  const fractionValue = calculateFractionCharge(chargeableMinutes, tarifa);
  const hourlyRate = asNumber(tarifa?.tarifa_por_hora, 1000);
  const minimumRate = tarifa?.tarifa_minima ? asNumber(tarifa.tarifa_minima, null) : null;

  let valorTotal = fractionValue;
  let tarifaAplicada = `$${hourlyRate} COP/hora`;

  if (valorTotal === null) {
    valorTotal = Math.ceil((chargeableMinutes / 60) * hourlyRate);
    if (minimumRate && valorTotal < minimumRate) valorTotal = Math.ceil(minimumRate);
  } else {
    tarifaAplicada = `$${asNumber(tarifa.valor_dia, 0)} dia / $${asNumber(tarifa.valor_primera_fraccion, 0)} primera fraccion / $${asNumber(tarifa.valor_segunda_fraccion, 0)} segunda fraccion`;
  }

  const discountHours = asNumber(tarifa?.descuento_prolongada_horas, 0);
  const discountPercent = asNumber(tarifa?.descuento_prolongada_porcentaje, 0);
  const descuentoAplicado = discountHours > 0 && chargeableMinutes / 60 >= discountHours && discountPercent > 0;
  const valorAntesDescuento = Math.ceil(valorTotal);

  if (descuentoAplicado) {
    valorTotal = Math.ceil(valorTotal * (1 - discountPercent / 100));
  }

  return {
    valor_total: Math.ceil(valorTotal),
    valor_antes_descuento: valorAntesDescuento,
    porcentaje_descuento: descuentoAplicado ? discountPercent : 0,
    descuento_aplicado: descuentoAplicado,
    minutos_cobrados: chargeableMinutes,
    tarifa_aplicada: tarifaAplicada,
  };
}

module.exports = {
  DAY_DEFAULTS,
  VEHICLE_DEFAULTS,
  calculateParkingCharge,
  ensureParqueaderoConfigSchema,
  getParqueaderoConfig,
  saveParqueaderoConfig,
};
