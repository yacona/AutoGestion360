# Contrato Backend / Frontend — Panel Admin SaaS

Última actualización: 2026-04-21

Todos los endpoints requieren:
- Header: `Authorization: Bearer <token>`
- Rol del usuario autenticado: `SuperAdmin`
- Base URL: `/api/admin`

Errores estándar devueltos por cualquier endpoint:
- `401` — token inválido o expirado
- `403` — usuario no es SuperAdmin
- `400` — payload inválido (incluye `details` con errores Zod)
- `404` — recurso no encontrado
- `409` — dato duplicado (ej.: código de plan ya existe)
- `500` — error interno del servidor

---

## A. Vistas del panel admin y sus endpoints

---

### Vista 1 — Dashboard / KPIs SaaS

#### `GET /api/admin/resumen`

```json
{
  "total": 42,
  "trial": 8,
  "activas": 30,
  "trials_vencidos": 2,
  "vencidas": 2,
  "mrr": 4500000,
  "arr": 54000000
}
```

#### `GET /api/admin/proximas-vencer?dias=30`

Query params: `dias` (entero positivo, default 30)

```json
[
  {
    "suscripcion_id": 7,
    "empresa_id": 3,
    "estado": "ACTIVA",
    "fecha_fin": "2026-05-10T00:00:00Z",
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

---

### Vista 2 — Lista de empresas

#### `GET /api/admin/empresas`

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
    "creado_en": "2026-01-15T10:00:00Z",
    "plan_codigo": "pro",
    "plan_nombre": "Pro",
    "suscripcion_estado": "ACTIVA",
    "suscripcion_fin": "2026-05-10T00:00:00Z",
    "trial_hasta": null,
    "usuarios_total": 4,
    "clientes_total": 120,
    "parqueados_activos": 3
  }
]
```

---

### Vista 3 — Detalle de empresa

#### `GET /api/admin/empresas/:id`

Path params: `id` (integer)

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
  "creado_en": "2026-01-15T10:00:00Z",
  "plan_codigo": "pro",
  "plan_nombre": "Pro",
  "precio_mensual": 150000,
  "suscripcion_id": 7,
  "suscripcion_estado": "ACTIVA",
  "suscripcion_inicio": "2026-02-01T00:00:00Z",
  "suscripcion_fin": "2026-05-10T00:00:00Z",
  "trial_hasta": null,
  "ciclo": "MENSUAL",
  "precio_pactado": 140000,
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
      "override_notas": "Desactivado por solicitud del cliente",
      "en_plan": true,
      "limite_plan": null,
      "estado_efectivo": "desactivado"
    }
  ]
}
```

---

### Vista 4 — Suscripción actual de una empresa

#### `GET /api/admin/suscripcion/:empresaId`

Path params: `empresaId` (integer)

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
  "fecha_inicio": "2026-02-01T00:00:00Z",
  "fecha_fin": "2026-05-10T00:00:00Z",
  "trial_hasta": null,
  "ciclo": "MENSUAL",
  "precio_pactado": 140000,
  "moneda": "COP",
  "pasarela": "MANUAL",
  "observaciones": "Descuento comercial aplicado",
  "creado_en": "2026-02-01T00:00:00Z",
  "actualizado_en": "2026-03-01T00:00:00Z"
}
```

Si no hay suscripción activa:
```json
{ "suscripcion": null, "mensaje": "Sin suscripción activa." }
```

---

### Vista 5 — Catálogo de planes

#### `GET /api/admin/planes`

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
    "creado_en": "2026-01-01T00:00:00Z",
    "actualizado_en": "2026-01-01T00:00:00Z",
    "modulos_incluidos": 3
  }
]
```

---

### Vista 6 — Detalle de plan con módulos

#### `GET /api/admin/planes/:id`

Path params: `id` (integer)

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
    },
    {
      "id": 2,
      "nombre": "taller",
      "descripcion": "Gestión de órdenes de taller",
      "icono_clave": "wrench",
      "orden": 2,
      "limite_registros": null,
      "activo": true,
      "metadata": null
    }
  ]
}
```

---

### Vista 7 — Módulos del catálogo global

#### `GET /api/admin/modulos`

```json
[
  {
    "id": 1,
    "nombre": "parqueadero",
    "descripcion": "Gestión de parqueadero",
    "icono_clave": "parking",
    "orden": 1,
    "activo": true
  },
  {
    "id": 2,
    "nombre": "taller",
    "descripcion": "Gestión de órdenes de taller",
    "icono_clave": "wrench",
    "orden": 2,
    "activo": true
  }
]
```

---

### Vista 8 — Límites efectivos de una empresa

#### `GET /api/admin/limites/:empresaId`

Path params: `empresaId` (integer)

Combina los límites globales del plan con los overrides individuales por módulo.

```json
{
  "plan": {
    "plan_id": 2,
    "plan_codigo": "pro",
    "plan_nombre": "Pro",
    "max_usuarios": 10,
    "max_vehiculos": null,
    "max_empleados": 15,
    "suscripcion_estado": "ACTIVA",
    "fecha_fin": "2026-05-10T00:00:00Z",
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
    },
    {
      "id": 3,
      "nombre": "reportes",
      "estado_efectivo": "addon",
      "limite_plan": null,
      "limite_override": 500,
      "limite_efectivo": 500
    }
  ]
}
```

`limite_efectivo = null` significa "sin límite".

---

### Vista 9 — Overrides de módulos por empresa

#### `GET /api/admin/empresa-modulos/:empresaId`

Path params: `empresaId` (integer)

Devuelve el mismo payload que el `modulos` array de `GET /empresas/:id`.
Útil para cargar solo la vista de toggles sin el resto de datos de empresa.

---

### Vista 10 — Onboarding de tenant

#### `POST /api/admin/onboarding`

Body:
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

Campos obligatorios: `nombre`
Si se envía `adminEmail`, `adminPassword` es obligatorio (mínimo 6 caracteres).

Respuesta `201`:
```json
{
  "mensaje": "Empresa creada con éxito.",
  "empresa": {
    "id": 10,
    "nombre": "Taller El Rápido",
    "nit": "900123456-1",
    "ciudad": "Bogotá",
    "activa": true,
    "creado_en": "2026-04-21T14:00:00Z"
  },
  "plan": {
    "id": 1,
    "codigo": "starter",
    "nombre": "Starter",
    "precio_mensual": 50000
  }
}
```

---

### Vista 11 — Crear / editar planes

#### `POST /api/admin/planes`

Body:
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
    { "modulo_id": 2, "activo": true, "limite_registros": null },
    { "modulo_id": 3, "activo": true, "limite_registros": 10000 }
  ]
}
```

Campos obligatorios: `codigo`, `nombre`, `precio_mensual`
`modulos` es opcional; si se omite el plan se crea sin módulos.

#### `PUT /api/admin/planes/:id`

Mismo schema que POST pero todos los campos son opcionales.
Si se envía `modulos`, reemplaza todos los módulos del plan.

#### `PUT /api/admin/planes/:id/modulos`

Body:
```json
{
  "modulos": [
    { "modulo_id": 1, "activo": true, "limite_registros": null },
    { "modulo_id": 4, "activo": true, "limite_registros": 500 }
  ]
}
```

Reemplaza completamente los módulos del plan.
`modulos: []` vacía la lista de módulos del plan.

---

### Vista 12 — Cambiar plan de empresa (upgrade / downgrade / asignación)

#### `POST /api/admin/suscripcion/:empresaId`

Asignación genérica de plan.

Body:
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

Solo `plan_id` es obligatorio.

#### `POST /api/admin/suscripcion/:empresaId/upgrade`
#### `POST /api/admin/suscripcion/:empresaId/downgrade`

Mismo body que la asignación genérica.
La diferencia es semántica: `observaciones` por defecto dice "Upgrade de plan"
o "Downgrade de plan" si no se envía uno personalizado.

**Lógica en ambos casos:**
1. Cancela la suscripción `TRIAL`/`ACTIVA` actual.
2. Crea una nueva suscripción con el plan indicado.

Respuesta:
```json
{
  "mensaje": "Upgrade aplicado.",
  "suscripcion": {
    "id": 12,
    "empresa_id": 3,
    "plan_id": 3,
    "estado": "ACTIVA",
    "fecha_inicio": "2026-04-21T14:00:00Z",
    "fecha_fin": "2026-07-01T00:00:00Z",
    "ciclo": "MENSUAL",
    "precio_pactado": 350000,
    "moneda": "COP"
  }
}
```

#### `POST /api/admin/suscripcion/:empresaId/reactivar`

Body:
```json
{
  "fecha_fin": "2026-07-01",
  "observaciones": "Reactivación tras pago recibido"
}
```

Ambos campos son opcionales.
Reactiva la suscripción más reciente en estado `SUSPENDIDA` o `VENCIDA`.
No cambia el plan.

#### `POST /api/admin/suscripcion/:empresaId/estado`

Body:
```json
{ "estado": "SUSPENDIDA" }
```

Valores válidos: `TRIAL`, `ACTIVA`, `SUSPENDIDA`, `CANCELADA`, `VENCIDA`

---

### Vista 13 — Overrides de módulos

#### `PUT /api/admin/empresa-modulos/:empresaId/:moduloId`

Body:
```json
{
  "activo": false,
  "limite_override": null,
  "notas": "Módulo desactivado por falta de pago del add-on"
}
```

`activo: false` desactiva el módulo para esta empresa aunque el plan lo incluya.
`activo: true` con módulo que no está en el plan lo añade como add-on.
`limite_override: null` hereda el límite del plan. `0` = sin límite.

#### `DELETE /api/admin/empresa-modulos/:empresaId/:moduloId`

Sin body. Elimina el override; el módulo vuelve al comportamiento del plan.

#### `PUT /api/admin/empresa-modulos/:empresaId/bulk`

Body:
```json
{
  "overrides": [
    { "modulo_id": 1, "activo": true, "limite_override": null },
    { "modulo_id": 5, "activo": false, "notas": "No contratado" },
    { "modulo_id": 3, "eliminar": true }
  ]
}
```

`eliminar: true` elimina el override en lugar de crearlo/actualizarlo.
Útil para guardar todos los toggles del panel de módulos en un solo request.

---

### Vista 14 — Crear usuario admin para tenant existente

#### `POST /api/admin/usuarios/:empresaId`

Body:
```json
{
  "nombre": "Carlos López",
  "email": "carlos@elrapido.co",
  "password": "segura456",
  "rol": "Administrador"
}
```

Campos obligatorios: `email`, `password` (mínimo 6 caracteres)

Respuesta `201`:
```json
{
  "mensaje": "Usuario creado.",
  "usuario": {
    "id": 25,
    "empresa_id": 3,
    "nombre": "Carlos López",
    "email": "carlos@elrapido.co",
    "rol": "Administrador",
    "activo": true,
    "creado_en": "2026-04-21T14:05:00Z"
  }
}
```

---

## B. DTOs / shapes de respuesta

### Plan completo

```ts
{
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual: number;
  precio_anual: number | null;
  moneda: string;
  trial_dias: number;
  max_usuarios: number | null;
  max_vehiculos: number | null;
  max_empleados: number | null;
  es_publico: boolean;
  activo: boolean;
  orden: number;
  metadata: Record<string, unknown> | null;
  creado_en: string;       // ISO timestamp
  actualizado_en: string;
  // Presente en GET /planes (lista)
  modulos_incluidos?: number;
  // Presente en GET /planes/:id (detalle)
  modulos?: ModuloPlan[];
}
```

### Módulo en plan

```ts
{
  id: number;
  nombre: string;
  descripcion: string | null;
  icono_clave: string | null;
  orden: number | null;
  limite_registros: number | null;  // null = sin límite
  activo: boolean;
  metadata: Record<string, unknown> | null;
}
```

### Módulo con estado de override por empresa

```ts
{
  id: number;
  nombre: string;
  descripcion: string | null;
  icono_clave: string | null;
  orden: number | null;
  tiene_override: boolean;
  override_activo: boolean | null;
  limite_override: number | null;
  override_notas: string | null;
  en_plan: boolean;
  limite_plan: number | null;
  estado_efectivo: 'incluido' | 'addon' | 'desactivado' | 'no_incluido';
}
```

### Suscripción activa de empresa

```ts
{
  id: number;
  empresa_id: number;
  plan_id: number;
  plan_codigo: string;
  plan_nombre: string;
  precio_mensual: number;
  precio_anual: number | null;
  max_usuarios: number | null;
  max_vehiculos: number | null;
  max_empleados: number | null;
  estado: 'TRIAL' | 'ACTIVA' | 'SUSPENDIDA' | 'VENCIDA' | 'CANCELADA';
  fecha_inicio: string;
  fecha_fin: string | null;
  trial_hasta: string | null;
  ciclo: 'MENSUAL' | 'ANUAL';
  precio_pactado: number;
  moneda: string;
  pasarela: string;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}
```

### Detalle consolidado de empresa SaaS

```ts
{
  id: number;
  nombre: string;
  nit: string | null;
  ciudad: string | null;
  email_contacto: string | null;
  telefono: string | null;
  zona_horaria: string;
  activa: boolean;
  creado_en: string;
  // Plan y suscripción activa
  plan_codigo: string | null;
  plan_nombre: string | null;
  precio_mensual: number | null;
  suscripcion_id: number | null;
  suscripcion_estado: string | null;
  suscripcion_inicio: string | null;
  suscripcion_fin: string | null;
  trial_hasta: string | null;
  ciclo: string | null;
  precio_pactado: number | null;
  // Módulos
  modulos: ModuloConOverride[];
}
```

### Límites efectivos de empresa

```ts
{
  plan: {
    plan_id: number;
    plan_codigo: string;
    plan_nombre: string;
    max_usuarios: number | null;
    max_vehiculos: number | null;
    max_empleados: number | null;
    suscripcion_estado: string;
    fecha_fin: string | null;
    trial_hasta: string | null;
  } | null;
  limites_globales: {
    max_usuarios: number | null;
    max_vehiculos: number | null;
    max_empleados: number | null;
  };
  modulos: {
    id: number;
    nombre: string;
    estado_efectivo: string;
    limite_plan: number | null;
    limite_override: number | null;
    limite_efectivo: number | null;  // null = sin límite
  }[];
}
```

### Próximas a vencer

```ts
{
  suscripcion_id: number;
  empresa_id: number;
  estado: string;
  fecha_fin: string | null;
  trial_hasta: string | null;
  plan_codigo: string;
  plan_nombre: string;
  precio_mensual: number;
  empresa_nombre: string;
  email_contacto: string | null;
  ciudad: string | null;
  dias_restantes: number;  // fracción decimal
}
```

---

## C. Reglas de autorización

Todos los endpoints de `/api/admin/*` requieren:
1. JWT válido (verificado por `authMiddleware`)
2. Rol normalizado `superadmin` (verificado por `ctrl.requireSuperAdmin`)

No existe autorización granular por recurso dentro del panel admin.
Un superadmin puede operar sobre cualquier empresa.

---

## D. Gaps resueltos en Sprint 4

| Gap | Solución |
|-----|---------|
| No había endpoint de detalle de plan con módulos | `GET /api/admin/planes/:id` |
| No había catálogo global de módulos | `GET /api/admin/modulos` |
| No había forma de editar solo los módulos de un plan | `PUT /api/admin/planes/:id/modulos` |
| No había endpoint de límites efectivos consolidados | `GET /api/admin/limites/:empresaId` |
| No había rutas semánticas de upgrade/downgrade | `POST /suscripcion/:id/upgrade`, `/downgrade` |
| No había endpoint de reactivación | `POST /suscripcion/:id/reactivar` |

---

## E. Gaps pendientes para Sprint 5

| Gap | Descripción |
|-----|-------------|
| Historial de suscripciones | No hay endpoint para ver suscripciones pasadas (canceladas/vencidas) de una empresa |
| Facturas del sistema nuevo | `facturas_saas` referencia el sistema legacy; Sprint 5 necesita `facturas` ligada a `suscripciones` |
| Listado de facturas por empresa (nuevo sistema) | Sin cobertura hasta Sprint 5 |
| Webhook de pasarela | Sin endpoint de confirmación de pago |
| Job de expiración automática | `trial_hasta` / `fecha_fin` no se procesan automáticamente |
| Notificaciones por email | Sin envío de emails de lifecycle (trial por vencer, vencimiento, etc.) |
