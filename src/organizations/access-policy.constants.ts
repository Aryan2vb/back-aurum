import { OrganizationRole } from '@prisma/client';

export const ACCESS_MODULES = [
  'customers',
  'credits',
  'advance',
  'invoices',
  'stock',
  'purchases',
  'books',
  'reports',
] as const;

export type AccessModule = (typeof ACCESS_MODULES)[number];

/** Roles the owner can grant module visibility to (OWNER is always allowed). */
export const DELEGATED_ROLES = [
  OrganizationRole.ADMIN,
  OrganizationRole.STAFF,
  OrganizationRole.VIEWER,
] as const;

export type DelegatedRole = (typeof DELEGATED_ROLES)[number];

export const DEFAULT_MODULE_ROLES: DelegatedRole[] = [
  OrganizationRole.ADMIN,
  OrganizationRole.STAFF,
  OrganizationRole.VIEWER,
];

export const ACCESS_WINDOW_CLOSED = 'ACCESS_WINDOW_CLOSED';
export const MODULE_ACCESS_DENIED = 'MODULE_ACCESS_DENIED';
