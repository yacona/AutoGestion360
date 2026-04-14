# Sistema de Licenciamiento - AutoGestión360

Este documento describe la implementación del sistema de licenciamiento para el proyecto AutoGestión360.

## Estructura de Base de Datos

### Nuevas Tablas

1. **licencias**: Define los tipos de licencia disponibles
   - id (SERIAL PRIMARY KEY)
   - nombre (VARCHAR(100) NOT NULL UNIQUE)
   - descripcion (TEXT)
   - precio (DECIMAL(10,2))
   - creado_en (TIMESTAMP WITH TIME ZONE DEFAULT NOW())

2. **modulos**: Lista los módulos/funcionalidades del sistema
   - id (SERIAL PRIMARY KEY)
   - nombre (VARCHAR(100) NOT NULL UNIQUE)
   - descripcion (TEXT)
   - creado_en (TIMESTAMP WITH TIME ZONE DEFAULT NOW())

3. **licencia_modulo**: Relación many-to-many entre licencias y módulos
   - id (SERIAL PRIMARY KEY)
   - licencia_id (INTEGER NOT NULL REFERENCES licencias(id))
   - modulo_id (INTEGER NOT NULL REFERENCES modulos(id))
   - UNIQUE(licencia_id, modulo_id)

4. **empresa_licencia**: Asigna licencias a empresas con fechas específicas
   - id (SERIAL PRIMARY KEY)
   - empresa_id (BIGINT NOT NULL REFERENCES empresas(id))
   - licencia_id (INTEGER NOT NULL REFERENCES licencias(id))
   - fecha_inicio (TIMESTAMP WITH TIME ZONE DEFAULT NOW())
   - fecha_fin (TIMESTAMP WITH TIME ZONE)
   - activa (BOOLEAN DEFAULT TRUE)
   - creado_en (TIMESTAMP WITH TIME ZONE DEFAULT NOW())
   - UNIQUE(empresa_id) - Una empresa tiene una licencia activa a la vez

## Instalación

1. Ejecutar el script SQL `licencias_setup.sql` en la base de datos PostgreSQL
2. Instalar dependencias: `npm install nodemailer`
3. Configurar variables de entorno para SMTP (opcional para notificaciones por correo)

## Middleware de Verificación de Licencia

El middleware `verificarLicencia` se aplica a las rutas de módulos específicos (parqueadero, lavadero, taller). Verifica:

- Que la empresa tenga una licencia activa asignada
- Que la licencia no haya expirado
- Que el módulo solicitado esté incluido en la licencia

Si alguna condición falla, devuelve un error 403.

## Rutas de Administración (Solo Admin)

### Licencias
- `POST /api/licencias` - Crear nueva licencia
- `GET /api/licencias` - Obtener todas las licencias
- `PUT /api/licencias/:id` - Actualizar licencia

### Módulos por Licencia
- `POST /api/licencias/:id/modulos` - Asignar módulos a una licencia
- `GET /api/licencias/:id/modulos` - Obtener módulos de una licencia
- `GET /api/licencias/modulos/disponibles` - Obtener todos los módulos disponibles

### Asignación de Licencias
- `POST /api/licencias/asignar` - Asignar licencia a empresa
- `GET /api/licencias/asignaciones` - Obtener todas las asignaciones

### Notificaciones
- `GET /api/licencias/proximas-vencer?dias=30` - Obtener licencias próximas a vencer
- `POST /api/licencias/enviar-notificaciones?dias=30` - Enviar notificaciones por correo

## Configuración de Correo (Opcional)

Para habilitar notificaciones por correo, configurar estas variables de entorno:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-contraseña-app
```

## Módulos Iniciales

- parqueadero: Gestión de parqueadero
- lavadero: Lavadero de vehículos
- taller: Taller mecánico
- matricula: Matrícula de vehículos
- evaluacion: Evaluación de vehículos

## Licencias Iniciales

- **Demo**: Solo parqueadero (Gratis)
- **Básica**: Parqueadero, lavadero, matrícula ($50)
- **Premium**: Todos los módulos ($100)

## Uso

1. Crear licencias y asignar módulos según necesidades
2. Asignar licencias a empresas con fechas de inicio y fin
3. El sistema automáticamente verificará permisos en cada solicitud
4. Usar los endpoints de notificación para alertar sobre vencimientos próximos

## Migración de Datos Existentes

Las empresas existentes pueden tener datos en los campos `licencia_tipo`, `licencia_inicio`, `licencia_fin` de la tabla `empresas`. Para migrar:

1. Crear una licencia correspondiente al `licencia_tipo` existente
2. Insertar en `empresa_licencia` con los datos migrados
3. Opcionalmente, remover los campos antiguos de `empresas`