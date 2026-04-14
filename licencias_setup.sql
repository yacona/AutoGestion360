-- Crear tabla licencias
CREATE TABLE public.licencias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    precio DECIMAL(10,2),
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear tabla modulos
CREATE TABLE public.modulos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear tabla licencia_modulo (relación many-to-many)
CREATE TABLE public.licencia_modulo (
    id SERIAL PRIMARY KEY,
    licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
    modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    UNIQUE(licencia_id, modulo_id)
);

-- Crear tabla empresa_licencia (para asignar licencias a empresas con fechas específicas)
CREATE TABLE public.empresa_licencia (
    id SERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
    fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_fin TIMESTAMP WITH TIME ZONE,
    activa BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(empresa_id) -- Una empresa tiene una licencia activa a la vez
);

-- Insertar módulos iniciales
INSERT INTO modulos (nombre, descripcion) VALUES
('parqueadero', 'Módulo de gestión de parqueadero'),
('lavadero', 'Módulo de lavadero de vehículos'),
('taller', 'Módulo de taller mecánico'),
('matricula', 'Módulo de matrícula de vehículos'),
('evaluacion', 'Módulo de evaluación de vehículos');

-- Insertar licencias iniciales
INSERT INTO licencias (nombre, descripcion, precio) VALUES
('Demo', 'Licencia de demostración limitada', 0.00),
('Básica', 'Licencia básica con módulos esenciales', 50.00),
('Premium', 'Licencia completa con todos los módulos', 100.00);

-- Asignar módulos a licencias
-- Demo: solo parqueadero
INSERT INTO licencia_modulo (licencia_id, modulo_id) VALUES
(1, 1); -- Demo -> parqueadero

-- Básica: parqueadero, lavadero, matricula
INSERT INTO licencia_modulo (licencia_id, modulo_id) VALUES
(2, 1), -- Básica -> parqueadero
(2, 2), -- Básica -> lavadero
(2, 4); -- Básica -> matricula

-- Premium: todos
INSERT INTO licencia_modulo (licencia_id, modulo_id) VALUES
(3, 1), (3, 2), (3, 3), (3, 4), (3, 5);