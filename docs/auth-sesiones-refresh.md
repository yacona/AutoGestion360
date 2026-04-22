# Autenticacion con sesiones y refresh tokens

Fecha: 2026-04-22

## Objetivo

Endurecer identidad y seguridad del backend sin romper el flujo actual de login del frontend.

## Cambios implementados

- access token JWT corto con `sid` y `typ=access`
- refresh token opaco con rotacion en cada uso
- tabla `user_sessions` para sesiones persistentes
- revocacion por sesion y logout global
- compatibilidad con el payload actual de `POST /api/login`
- auditoria de login, refresh, logout y accesos denegados
- soporte formal para usuarios `platform` y `tenant`

## SQL

Aplicar:

```bash
psql -U <usuario> -d autogestion360 -f database/007_auth_sessions.sql
```

## Endpoints

### Login

`POST /api/login`

Body:

```json
{
  "email": "usuario@empresa.com",
  "password": "secreto"
}
```

Respuesta:

```json
{
  "token": "jwt_access_token",
  "access_token": "jwt_access_token",
  "refresh_token": "sessionUid.secret",
  "token_type": "Bearer",
  "expires_in": 900,
  "expires_at": "2026-04-22T18:30:00.000Z",
  "refresh_expires_in": 2592000,
  "session": {
    "id": "session_uid",
    "refresh_expires_at": "2026-05-22T18:15:00.000Z",
    "ultimo_login_en": "2026-04-22T18:15:00.000Z",
    "ultimo_refresh_en": null,
    "ultima_actividad_en": "2026-04-22T18:15:00.000Z"
  },
  "usuario": {},
  "empresa": {}
}
```

Compatibilidad:

- `token` se conserva para el frontend actual
- `access_token` y `refresh_token` son la forma nueva recomendada

### Refresh

`POST /api/refresh`

Body:

```json
{
  "refresh_token": "sessionUid.secret"
}
```

Devuelve nuevo `access_token` y nuevo `refresh_token`.

Importante:

- el refresh token anterior deja de ser valido
- si se reusa un refresh token anterior, la sesion queda revocada

### Logout

`POST /api/logout`

Headers:

```text
Authorization: Bearer <access_token>
```

Body opcional:

```json
{
  "refresh_token": "sessionUid.secret"
}
```

### Logout global

`POST /api/logout-all`

Revoca todas las sesiones activas del usuario autenticado.

### Listar sesiones

`GET /api/sesiones`

### Revocar una sesion puntual

`DELETE /api/sesiones/:sessionUid`

## Guia de integracion frontend

### Flujo recomendado

1. hacer login y guardar `access_token`, `refresh_token` y `session.id`
2. enviar `Authorization: Bearer <access_token>` en cada request
3. si la API responde `401` por expiracion, llamar `POST /api/refresh`
4. reemplazar ambos tokens por los nuevos
5. reintentar la request original
6. si refresh falla, limpiar sesion local y enviar al login

### Storage

Recomendado para el MVP actual:

- `access_token`: memoria en runtime o storage de corta vida
- `refresh_token`: almacenamiento mas persistente protegido por la app

Si luego migras a cookies httpOnly, esta capa backend sigue sirviendo.

### Logout

En cierre de sesion:

1. llamar `POST /api/logout`
2. borrar `access_token`, `refresh_token` y datos de usuario del cliente

### Manejo de sesiones en UI

- usar `GET /api/sesiones` para mostrar dispositivos activos
- usar `DELETE /api/sesiones/:sessionUid` para cerrar una sesion especifica
- usar `POST /api/logout-all` para cerrar todo

## Eventos de auditoria

Se registran en `auditoria` eventos como:

- `AUTH_LOGIN_SUCCESS`
- `AUTH_LOGIN_FAILED`
- `AUTH_LOGIN_DENIED`
- `AUTH_REFRESH_SUCCESS`
- `AUTH_REFRESH_FAILED`
- `AUTH_REFRESH_REPLAY_DETECTED`
- `AUTH_LOGOUT`
- `AUTH_LOGOUT_ALL`
- `AUTH_SESSION_REVOKED`
- `AUTH_ACCESS_DENIED`
- `AUTH_TOKEN_INVALID`
- `AUTH_SESSION_REVOKED`

## Notas operativas

- los tokens legacy sin `sid` siguen siendo aceptados temporalmente
- las sesiones nuevas si respetan revocacion inmediata
- los usuarios `platform` no requieren empresa asociada
- los usuarios `tenant` quedan bloqueados si la empresa esta inactiva
