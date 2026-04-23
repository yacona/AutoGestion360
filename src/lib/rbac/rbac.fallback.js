'use strict';

const TENANT_ALL_PERMISSIONS = [
  'clientes:ver', 'clientes:crear', 'clientes:editar', 'clientes:eliminar',
  'vehiculos:ver', 'vehiculos:crear', 'vehiculos:editar',
  'empleados:ver', 'empleados:crear', 'empleados:editar', 'empleados:eliminar',
  'parqueadero:ver', 'parqueadero:crear', 'parqueadero:editar',
  'lavadero:ver', 'lavadero:crear', 'lavadero:editar',
  'taller:ver', 'taller:crear', 'taller:editar',
  'ordenes:ver', 'ordenes:crear', 'ordenes:editar', 'ordenes:cancelar',
  'reportes:ver', 'reportes:exportar',
  'usuarios:ver', 'usuarios:crear', 'usuarios:editar', 'usuarios:eliminar',
  'configuracion:ver', 'configuracion:editar',
  'sedes:ver', 'sedes:crear', 'sedes:editar', 'sedes:eliminar',
];

const PLATFORM_ALL_PERMISSIONS = [
  'platform:empresas:ver',
  'platform:empresas:crear',
  'platform:empresas:editar',
  'platform:suscripciones:gestionar',
  'platform:planes:gestionar',
  'platform:usuarios:gestionar',
];

const FALLBACK_PERMISSIONS_BY_ROLE = {
  superadmin: ['*'],
  admin: [...TENANT_ALL_PERMISSIONS],
  operador: [
    'clientes:ver', 'clientes:crear', 'clientes:editar',
    'vehiculos:ver', 'vehiculos:crear',
    'ordenes:ver', 'ordenes:crear', 'ordenes:editar',
    'parqueadero:ver', 'parqueadero:crear',
    'lavadero:ver', 'lavadero:crear',
    'taller:ver', 'taller:crear',
    'reportes:ver',
  ],
  empleado: [
    'parqueadero:ver', 'parqueadero:crear',
    'lavadero:ver', 'lavadero:crear',
    'taller:ver', 'taller:crear',
    'reportes:ver',
  ],
};

const ROLE_LABELS = {
  superadmin: 'SuperAdmin',
  admin: 'Administrador',
  operador: 'Operador',
  empleado: 'Empleado',
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .trim();
}

function resolveRoleCode(role, scope = 'tenant') {
  const normalized = normalizeText(role);

  if (scope === 'platform') {
    return 'superadmin';
  }

  if (normalized === 'superadmin') return 'superadmin';
  if (['admin', 'administrador'].includes(normalized)) return 'admin';
  if (normalized === 'operador') return 'operador';
  return 'empleado';
}

function getFallbackRoleCodesForUser(user = {}) {
  if (Array.isArray(user.roles) && user.roles.length > 0) {
    return user.roles.map((role) => normalizeText(role)).filter(Boolean);
  }

  return [resolveRoleCode(user.rol, user.scope || 'tenant')];
}

function getFallbackPermissionsForRole(role, scope = 'tenant') {
  const roleCode = resolveRoleCode(role, scope);
  const permissions = FALLBACK_PERMISSIONS_BY_ROLE[roleCode] || FALLBACK_PERMISSIONS_BY_ROLE.empleado;

  if (roleCode === 'superadmin' && scope === 'platform') {
    return ['*', ...PLATFORM_ALL_PERMISSIONS];
  }

  return [...permissions];
}

function getFallbackPermissionsForRoles(roles = [], scope = 'tenant') {
  const permissionSet = new Set();

  if (!Array.isArray(roles) || roles.length === 0) {
    getFallbackPermissionsForRole(null, scope).forEach((permission) => permissionSet.add(permission));
    return Array.from(permissionSet);
  }

  roles.forEach((role) => {
    getFallbackPermissionsForRole(role, scope).forEach((permission) => permissionSet.add(permission));
  });

  return Array.from(permissionSet);
}

function getLegacyRoleLabel(roleCode) {
  return ROLE_LABELS[resolveRoleCode(roleCode)] || ROLE_LABELS.empleado;
}

module.exports = {
  TENANT_ALL_PERMISSIONS,
  PLATFORM_ALL_PERMISSIONS,
  FALLBACK_PERMISSIONS_BY_ROLE,
  normalizeText,
  resolveRoleCode,
  getFallbackRoleCodesForUser,
  getFallbackPermissionsForRole,
  getFallbackPermissionsForRoles,
  getLegacyRoleLabel,
};
