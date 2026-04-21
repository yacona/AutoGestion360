# Contrato Frontend / Backend — Panel Admin SaaS

Última actualización: 2026-04-21

## 1. Convenciones generales

- Base URL: `/api/admin`
- Header obligatorio: `Authorization: Bearer <jwt>`
- Autorización requerida: rol `SuperAdmin`
- Errores comunes:
  - `400` payload/query/params inválidos
  - `401` token inválido o ausente
  - `403` rol insuficiente
  - `404` recurso no encontrado
  - `409` dato duplicado
  - `429` rate limit
  - `500` error interno

## 2. Pantallas del frontend admin

### Pantalla 1 — Listado de empresas

- Endpoint: `/api/admin/empresas`
- Método: `GET`
- Params: ninguno
- Query: ninguna
- Body: ninguno
- Autorización requerida: `SuperAdmin`
- Observaciones: devuelve empresas con plan actual, estado de suscripción y métricas básicas.

Ejemplo request:

```http
GET /api/admin/empresas
Authorization: Bearer <token>
```

Ejemplo response:

```json
[
  {
    "id": 3,
    "nombre": "Taller El Rápido",
    "nit": "900123456-1",
    "ciudad": "Bogotá",
    "email_contacto": "admin@elrapido.co",
    "telefono": "3001234567",
    "zona_horaria": "America/Bogota",
    "activa": true,
    "creado_en": "2026-01-15T10:00:00.000Z",
    "plan_codigo": "pro",
    "plan_nombre": "Pro",
    "suscripcion_estado": "ACTIVA",
    "suscripcion_fin": "2026-05-10T00:00:00.000Z",
    "trial_hasta": null,
    "usuarios_total": 4,
    "clientes_total": 120,
    "parqueados_activos": 3
  }
]
```

### Pantalla 2 — Detalle SaaS de empresa

- Endpoint: `/api/admin/estado/:empresaId`
- Método: `GET`
- Params:
  - `empresaId` number
- Query: ninguna
- Body: ninguno
- Autorización requerida: `SuperAdmin`
- Observaciones: payload consolidado para vista completa de tenant: empresa, suscripción actual, historial, módulos, límites y resolución SaaS.

Ejemplo request:

```http
GET /api/admin/estado/3
Authorization: Bearer <token>
```

Ejemplo response:

```json
{
  "id": 3,
  "nombre": "Taller El Rápido",
  "nit": "900123456-1",
  "ciudad": "Bogotá",
  "direccion": "Calle 45 # 12-30",
  "telefono": "3001234567",
  "email_contacto": "admin@elrapido.co",
  "zona_horaria": "America/Bogota",
  "activa": true,
  "plan_codigo": "pro",
  "plan_nombre": "Pro",
  "precio_mensual": 150000,
  "suscripcion_id": 7,
  "suscripcion_estado": "ACTIVA",
  "suscripcion_inicio": "2026-02-01T00:00:00.000Z",
  "suscripcion_fin": "2026-05-10T00:00:00.000Z",
  "trial_hasta": null,
  "ciclo": "MENSUAL",
  "precio_pactado": 140000,
  "suscripcion_actual": {
    "id": 7,
    "empresa_id": 3,
    "plan_id": 2,
    "plan_codigo": "pro",
    "plan_nombre": "Pro",
    "precio_mensual": 150000,
    "precio_anual": 1500000,
    "max_usuarios": 10,
    "max_vehiculos": null,
    "max_empleados": 15,
    "estado": "ACTIVA",
    "fecha_inicio": "2026-02-01T00:00:00.000Z",
    "fecha_fin": "2026-05-10T00:00:00.000Z",
    "trial_hasta": null,
    "ciclo": "MENSUAL",
    "precio_pactado": 140000,
    "moneda": "COP",
    "pasarela": "MANUAL",
    "observaciones": "Descuento comercial aplicado",
    "creado_en": "2026-02-01T00:00:00.000Z",
    "actualizado_en": "2026-03-01T00:00:00.000Z"
  },
  "historial_suscripciones": [
    {
      "id": 7,
      "empresa_id": 3,
      "plan_id": 2,
      "plan_codigo": "pro",
      "plan_nombre": "Pro",
      "estado": "ACTIVA",
      "fecha_inicio": "2026-02-01T00:00:00.000Z",
      "fecha_fin": "2026-05-10T00:00:00.000Z",
      "trial_hasta": null,
      "ciclo": "MENSUAL",
      "precio_pactado": 140000,
      "moneda": "COP",
      "pasarela": "MANUAL",
      "observaciones": "Descuento comercial aplicado",
      "creado_en": "2026-02-01T00:00:00.000Z",
      "actualizado_en": "2026-03-01T00:00:00.000Z"
    }
  ],
  "modulos": [
    {
      "id": 1,
      "nombre": "parqueadero",
      "descripcion": "Gestión de parqueadero",
      "icono_clave": "parking",
      "orden": 1,
      "tiene_override": false,
      "override_activo": null,
      "limite_override": null,
      "override_notas": null,
      "en_plan": true,
      "limite_plan": null,
      "estado_efectivo": "incluido"
    }
  ],
  "limites": {
    "plan": {
      "plan_id": 2,
      "plan_codigo": "pro",
      "plan_nombre": "Pro",
      "max_usuarios": 10,
      "max_vehiculos": null,
      "max_empleados": 15,
      "suscripcion_estado": "ACTIVA",
      "fecha_fin": "2026-05-10T00:00:00.000Z",
      "trial_hasta": null
    },
    "limites_globales": {
      "max_usuarios": 10,
      "max_vehiculos": null,
      "max_empleados": 15
    },
    "modulos": [
      {
        "id": 1,
        "nombre": "parqueadero",
        "estado_efectivo": "incluido",
        "limite_plan": null,
        "limite_override": null,
        "limite_efectivo": null
      }
    ]
  },
  "saas_status": {
    "fuente": "planes",
    "oficial": true,
    "estado": "ACTIVA",
    "vigente": true,
    "legacy_fallback_used": false,
    "modulos": ["parqueadero", "taller", "reportes"],
    "modulos_detalle": [
      {
        "nombre": "parqueadero",
        "descripcion": "Gestión de parqueadero",
        "icono_clave": "parking",
        "limite": null,
        "es_addon": false
      }
    ],
    "limites": {
      "usuarios": 10,
      "vehiculos": null,
      "empleados": 15
    },
    "plan": {
      "id": 2,
      "codigo": "pro",
      "nombre": "Pro"
    },
    "suscripcion": {
      "id": 7,
      "estado_real": "ACTIVA"
    }
  }
}
```

### Pantalla 3 — Plan actual de empresa

- Endpoint: `/api/admin/suscripcion/:empresaId`
- Método: `GET`
- Params:
  - `empresaId` number
- Query: ninguna
- Body: ninguno
- Autorización requerida: `SuperAdmin`
- Observaciones: devuelve la suscripción `TRIAL` o `ACTIVA` más reciente.

Ejemplo request:

```http
GET /api/admin/suscripcion/3
Authorization: Bearer <token>
```

Ejemplo response:

```json
{
  "id": 7,
  "empresa_id": 3,
  "plan_id": 2,
  "plan_codigo": "pro",
  "plan_nombre": "Pro",
  "precio_mensual": 150000,
  "precio_anual": 1500000,
  "max_usuarios": 10,
  "max_vehiculos": null,
  "max_empleados": 15,
  "estado": "ACTIVA",
  "fecha_inicio": "2026-02-01T00:00:00.000Z",
  "fecha_fin": "2026-05-10T00:00:00.000Z",
  "trial_hasta": null,
  "ciclo": "MENSUAL",
  "precio_pactado": 140000,
  "moneda": "COP",
  "pasarela": "MANUAL",
  "observaciones": "Descuento comercial aplicado",
  "creado_en": "2026-02-01T00:00:00.000Z",
  "actualizado_en": "2026-03-01T00:00:00.000Z"
}
```

### Pantalla 4 — Historial / estado de suscripción

- Endpoint: `/api/admin/suscripcion/:empresaId/historial`
- Método: `GET`
- Params:
  - `empresaId` number
- Query: ninguna
- Body: ninguno
- Autorización requerida: `SuperAdmin`
- Observaciones: lista toda la historia de suscripciones de la empresa, incluyendo canceladas, vencidas y activas.

Ejemplo request:

```http
GET /api/admin/suscripcion/3/historial
Authorization: Bearer <token>
```

Ejemplo response:

```json
[
  {
    "id": 12,
    "empresa_id": 3,
    "plan_id": 3,
    "plan_codigo": "enterprise",
    "plan_nombre": "Enterprise",
    "estado": "CANCELADA",
    "fecha_inicio": "2026-01-01T00:00:00.000Z",
    "fecha_fin": "2026-02-01T00:00:00.000Z",
    "trial_hasta": null,
    "ciclo": "MENSUAL",
    "precio_pactado": 350000,
    "moneda": "COP",
    "pasarela": "MANUAL",
    "observaciones": "Upgrade posterior",
    "creado_en": "2026-01-01T00:00:00.000Z",
    "actualizado_en": "2026-02-01T00:00:00.000Z"
  },
  {
    "id": 7,
    "empresa_id": 3,
    "plan_id": 2,
    "plan_codigo": "pro",
    "plan_nombre": "Pro",
    "estado": "ACTIVA",
    "fecha_inicio": "2026-02-01T00:00:00.000Z",
    "fecha_fin": "2026-05-10T00:00:00.000Z",
    "trial_hasta": null,
    "ciclo": "MENSUAL",
    "precio_pactado": 140000,
    "moneda": "COP",
    "pasarela": "MANUAL",
    "observaciones": "Descuento comercial aplicado",
    "creado_en": "2026-02-01T00:00:00.000Z",
    "actualizado_en": "2026-03-01T00:00:00.000Z"
  }
]
```

### Pantalla 5 — Catálogo de planes

- Endpoint: `/api/admin/planes`
- Método: `GET`
- Params: ninguno
- Query: ninguna
- Body: ninguno
- Autorización requerida: `SuperAdmin`
- Observaciones: lista planes activos con conteo de módulos.

Ejemplo request:

```http
GET /api/admin/planes
Authorization: Bearer <token>
```

Ejemplo response:

```json
[
  {
    "id": 1,
    "codigo": "starter",
    "nombre": "Starter",
    "descripcion": "Plan básico para talleres pequeños",
    "precio_mensual": 50000,
    "precio_anual": 500000,
    "moneda": "COP",
    "trial_dias": 14,
    "max_usuarios": 3,
    "max_vehiculos": null,
    "max_empleados": 5,
    "es_publico": true,
    "activo": true,
    "orden": 1,
    "metadata": null,
    "creado_en": "2026-01-01T00:00:00.000Z",
    "actualizado_en": "2026-01-01T00:00:00.000Z",
    "modulos_incluidos": 3
  }
]
```

### Pantalla 6 — Detalle de plan

- Endpoint: `/api/admin/planes/:id`
- Método: `GET`
- Params:
  - `id` number
- Query: ninguna
- Body: ninguno
- Autorización requerida: `SuperAdmin`
- Observaciones: devuelve datos del plan y sus módulos efectivos.

Ejemplo request:

```http
GET /api/admin/planes/2
Authorization: Bearer <token>
```

Ejemplo response:

```json
{
  "id": 2,
  "codigo": "pro",
  "nombre": "Pro",
  "descripcion": "Para talleres medianos y lavaderos",
  "precio_mensual": 150000,
  "precio_anual": 1500000,
  "moneda": "COP",
  "trial_dias": 14,
  "max_usuarios": 10,
  "max_vehiculos": null,
  "max_empleados": 15,
  "es_publico": true,
  "activo": true,
  "orden": 2,
  "metadata": null,
  "modulos": [
    {
      "id": 1,
      "nombre": "parqueadero",
      "descripcion": "Gestión de parqueadero",
      "icono_clave": "parking",
      "orden": 1,
      "limite_registros": null,
      "activo": true,
      "metadata": null
    }
  ]
}
```

### Pantalla 7 — Módulos por plan

- Endpoint: `/api/admin/planes/:id/modulos`
- Método: `GET` y `PUT`
- Params:
  - `id` number
- Query: ninguna
- Body `GET`: ninguno
- Body `PUT`:

```json
{
  "modulos": [
    { "modulo_id": 1, "activo": true, "limite_registros": null },
    { "modulo_id": 4, "activo": true, "limite_registros": 500 }
  ]
}
```

- Autorización requerida: `SuperAdmin`
- Observaciones: `PUT` reemplaza completamente la lista de módulos del plan.

Ejemplo request:

```http
PUT /api/admin/planes/2/modulos
Authorization: Bearer <token>
Content-Type: application/json
```

Ejemplo response:

```json
{
  "mensaje": "Módulos del plan actualizados.",
  "modulos": [
    {
      "id": 1,
      "nombre": "parqueadero",
      "descripcion": "Gestión de parqueadero",
      "icono_clave": "parking",
      "orden": 1,
      "limite_registros": null,
      "activo": true,
      "metadata": null
    }
  ]
}
```

### Pantalla 8 — Overrides por empresa

- Endpoint: `/api/admin/empresa-modulos/:empresaId`
- Método: `GET`, `PUT`, `DELETE`
- Params:
  - `empresaId` number
  - `moduloId` number en rutas individuales
- Query: ninguna
- Body `GET`: ninguno
- Body `PUT /:empresaId/:moduloId`:

```json
{
  "activo": false,
  "limite_override": null,
  "notas": "Módulo desactivado por solicitud del cliente"
}
```

- Body `PUT /:empresaId/bulk`:

```json
{
  "overrides": [
    { "modulo_id": 1, "activo": true, "limite_override": null },
    { "modulo_id": 5, "activo": false, "notas": "No contratado" },
    { "modulo_id": 3, "eliminar": true }
  ]
}
```

- Autorización requerida: `SuperAdmin`
- Observaciones: `activo: true` sobre módulo no incluido en plan lo convierte en add-on.

Ejemplo response `GET`:

```json
[
  {
    "id": 1,
    "nombre": "parqueadero",
    "descripcion": "Gestión de parqueadero",
    "icono_clave": "parking",
    "orden": 1,
    "tiene_override": false,
    "override_activo": null,
    "limite_override": null,
    "override_notas": null,
    "en_plan": true,
    "limite_plan": null,
    "estado_efectivo": "incluido"
  },
  {
    "id": 5,
    "nombre": "lavadero",
    "descripcion": "Gestión de lavadero",
    "icono_clave": "wash",
    "orden": 2,
    "tiene_override": true,
    "override_activo": false,
    "limite_override": null,
    "override_notas": "No contratado",
    "en_plan": true,
    "limite_plan": null,
    "estado_efectivo": "desactivado"
  }
]
```

### Pantalla 9 — Próximos vencimientos

- Endpoint: `/api/admin/proximas-vencer`
- Método: `GET`
- Params: ninguno
- Query:
  - `dias` number opcional
- Body: ninguno
- Autorización requerida: `SuperAdmin`
- Observaciones: mezcla trial por vencer y suscripciones activas cercanas al fin de vigencia.

Ejemplo request:

```http
GET /api/admin/proximas-vencer?dias=30
Authorization: Bearer <token>
```

Ejemplo response:

```json
[
  {
    "suscripcion_id": 7,
    "empresa_id": 3,
    "estado": "ACTIVA",
    "fecha_fin": "2026-05-10T00:00:00.000Z",
    "trial_hasta": null,
    "plan_codigo": "pro",
    "plan_nombre": "Pro",
    "precio_mensual": 150000,
    "empresa_nombre": "Taller El Rápido",
    "email_contacto": "admin@elrapido.co",
    "ciudad": "Bogotá",
    "dias_restantes": 18.5
  }
]
```

### Pantalla 10 — Onboarding de tenant

- Endpoint: `/api/admin/onboarding`
- Método: `POST`
- Params: ninguno
- Query: ninguna
- Body:

```json
{
  "nombre": "Taller El Rápido",
  "nit": "900123456-1",
  "ciudad": "Bogotá",
  "direccion": "Calle 45 # 12-30",
  "telefono": "3001234567",
  "emailContacto": "admin@elrapido.co",
  "zonaHoraria": "America/Bogota",
  "planCodigo": "starter",
  "adminNombre": "Juan Pérez",
  "adminEmail": "juan@elrapido.co",
  "adminPassword": "segura123"
}
```

- Autorización requerida: `SuperAdmin`
- Observaciones: crea empresa, suscripción inicial `TRIAL`, admin opcional e inicializa configuración base.

Ejemplo response:

```json
{
  "mensaje": "Empresa creada con éxito.",
  "empresa": {
    "id": 10,
    "nombre": "Taller El Rápido",
    "nit": "900123456-1",
    "ciudad": "Bogotá",
    "activa": true,
    "creado_en": "2026-04-21T14:00:00.000Z"
  },
  "plan": {
    "id": 1,
    "codigo": "starter",
    "nombre": "Starter",
    "precio_mensual": 50000
  }
}
```

### Pantalla 11 — Creación / edición de plan

- Endpoint: `/api/admin/planes`
- Método: `POST`
- Params: ninguno
- Query: ninguna
- Body:

```json
{
  "codigo": "enterprise",
  "nombre": "Enterprise",
  "descripcion": "Para flotas grandes",
  "precio_mensual": 400000,
  "precio_anual": 4000000,
  "moneda": "COP",
  "trial_dias": 14,
  "max_usuarios": 50,
  "max_vehiculos": null,
  "max_empleados": null,
  "es_publico": true,
  "activo": true,
  "orden": 3,
  "modulos": [
    { "modulo_id": 1, "activo": true, "limite_registros": null },
    { "modulo_id": 3, "activo": true, "limite_registros": 10000 }
  ]
}
```

- Endpoint edición: `/api/admin/planes/:id`
- Método edición: `PUT`
- Params edición:
  - `id` number
- Query edición: ninguna
- Body edición: mismo shape que create, con todos los campos opcionales
- Autorización requerida: `SuperAdmin`
- Observaciones: si `modulos` se envía en `PUT`, reemplaza la configuración previa.

Ejemplo response:

```json
{
  "mensaje": "Plan actualizado.",
  "plan": {
    "id": 3,
    "codigo": "enterprise",
    "nombre": "Enterprise",
    "descripcion": "Para flotas grandes",
    "precio_mensual": 400000,
    "precio_anual": 4000000,
    "moneda": "COP",
    "trial_dias": 14,
    "max_usuarios": 50,
    "max_vehiculos": null,
    "max_empleados": null,
    "es_publico": true,
    "activo": true,
    "orden": 3,
    "metadata": null
  }
}
```

## 3. DTOs obligatorios

### `PlanDTO`

```json
{
  "id": 2,
  "codigo": "pro",
  "nombre": "Pro",
  "descripcion": "Para talleres medianos y lavaderos",
  "precio_mensual": 150000,
  "precio_anual": 1500000,
  "moneda": "COP",
  "trial_dias": 14,
  "max_usuarios": 10,
  "max_vehiculos": null,
  "max_empleados": 15,
  "es_publico": true,
  "activo": true,
  "orden": 2,
  "metadata": null,
  "creado_en": "2026-01-01T00:00:00.000Z",
  "actualizado_en": "2026-01-15T00:00:00.000Z",
  "modulos_incluidos": 5
}
```

### `PlanModuloDTO`

```json
{
  "id": 1,
  "nombre": "parqueadero",
  "descripcion": "Gestión de parqueadero",
  "icono_clave": "parking",
  "orden": 1,
  "limite_registros": null,
  "activo": true,
  "metadata": null
}
```

### `EmpresaModuloOverrideDTO`

```json
{
  "id": 5,
  "nombre": "lavadero",
  "descripcion": "Gestión de lavadero",
  "icono_clave": "wash",
  "orden": 2,
  "tiene_override": true,
  "override_activo": false,
  "limite_override": null,
  "override_notas": "No contratado",
  "en_plan": true,
  "limite_plan": null,
  "estado_efectivo": "desactivado"
}
```

### `SuscripcionEmpresaDTO`

```json
{
  "id": 7,
  "empresa_id": 3,
  "plan_id": 2,
  "plan_codigo": "pro",
  "plan_nombre": "Pro",
  "precio_mensual": 150000,
  "precio_anual": 1500000,
  "max_usuarios": 10,
  "max_vehiculos": null,
  "max_empleados": 15,
  "estado": "ACTIVA",
  "fecha_inicio": "2026-02-01T00:00:00.000Z",
  "fecha_fin": "2026-05-10T00:00:00.000Z",
  "trial_hasta": null,
  "ciclo": "MENSUAL",
  "precio_pactado": 140000,
  "moneda": "COP",
  "pasarela": "MANUAL",
  "observaciones": "Descuento comercial aplicado",
  "creado_en": "2026-02-01T00:00:00.000Z",
  "actualizado_en": "2026-03-01T00:00:00.000Z"
}
```

### `EmpresaSaaSDetailDTO`

```json
{
  "id": 3,
  "nombre": "Taller El Rápido",
  "nit": "900123456-1",
  "ciudad": "Bogotá",
  "email_contacto": "admin@elrapido.co",
  "telefono": "3001234567",
  "zona_horaria": "America/Bogota",
  "activa": true,
  "plan_codigo": "pro",
  "plan_nombre": "Pro",
  "precio_mensual": 150000,
  "suscripcion_id": 7,
  "suscripcion_estado": "ACTIVA",
  "suscripcion_inicio": "2026-02-01T00:00:00.000Z",
  "suscripcion_fin": "2026-05-10T00:00:00.000Z",
  "trial_hasta": null,
  "ciclo": "MENSUAL",
  "precio_pactado": 140000,
  "suscripcion_actual": {
    "id": 7,
    "empresa_id": 3,
    "plan_id": 2,
    "plan_codigo": "pro",
    "plan_nombre": "Pro",
    "estado": "ACTIVA"
  },
  "historial_suscripciones": [
    {
      "id": 7,
      "empresa_id": 3,
      "plan_id": 2,
      "plan_codigo": "pro",
      "plan_nombre": "Pro",
      "estado": "ACTIVA"
    }
  ],
  "modulos": [
    {
      "id": 1,
      "nombre": "parqueadero",
      "estado_efectivo": "incluido"
    }
  ],
  "limites": {
    "limites_globales": {
      "max_usuarios": 10,
      "max_vehiculos": null,
      "max_empleados": 15
    }
  },
  "saas_status": {
    "fuente": "planes",
    "estado": "ACTIVA",
    "vigente": true
  }
}
```

### `ProximaVencimientoDTO`

```json
{
  "suscripcion_id": 7,
  "empresa_id": 3,
  "estado": "ACTIVA",
  "fecha_fin": "2026-05-10T00:00:00.000Z",
  "trial_hasta": null,
  "plan_codigo": "pro",
  "plan_nombre": "Pro",
  "precio_mensual": 150000,
  "empresa_nombre": "Taller El Rápido",
  "email_contacto": "admin@elrapido.co",
  "ciudad": "Bogotá",
  "dias_restantes": 18.5
}
```

## 4. Endpoints auxiliares del lifecycle

### Asignación genérica de plan

- Endpoint: `/api/admin/suscripcion/:empresaId`
- Método: `POST`

```json
{
  "plan_id": 3,
  "ciclo": "MENSUAL",
  "precio_pactado": 350000,
  "moneda": "COP",
  "fecha_fin": "2026-07-01",
  "estado": "ACTIVA",
  "observaciones": "Migración manual",
  "pasarela": "MANUAL"
}
```

### Upgrade

- Endpoint: `/api/admin/suscripcion/:empresaId/upgrade`
- Método: `POST`
- Observaciones: cancela la suscripción vigente y crea una nueva con semántica de upgrade.

### Downgrade

- Endpoint: `/api/admin/suscripcion/:empresaId/downgrade`
- Método: `POST`
- Observaciones: cancela la suscripción vigente y crea una nueva con semántica de downgrade.

### Reactivación

- Endpoint: `/api/admin/suscripcion/:empresaId/reactivar`
- Método: `POST`

```json
{
  "fecha_fin": "2026-07-01",
  "observaciones": "Reactivación tras pago recibido"
}
```

### Cambio manual de estado

- Endpoint: `/api/admin/suscripcion/:empresaId/estado`
- Método: `POST`

```json
{
  "estado": "SUSPENDIDA"
}
```

Valores permitidos:

```text
TRIAL
ACTIVA
SUSPENDIDA
VENCIDA
CANCELADA
```
