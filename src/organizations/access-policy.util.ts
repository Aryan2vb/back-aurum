import { OrganizationRole } from '@prisma/client';
import {
  ACCESS_MODULES,
  AccessModule,
  DEFAULT_MODULE_ROLES,
  DELEGATED_ROLES,
  DelegatedRole,
} from './access-policy.constants';

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHmToMinutes(value: string): number | null {
  if (!HM_RE.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** Current wall-clock minutes since midnight in `timeZone` (IANA). */
export function minutesNowInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // en-GB can emit "24" for midnight in some engines — normalize
  const h = hour === 24 ? 0 : hour;
  return h * 60 + minute;
}

/**
 * Inclusive start, exclusive end. Overnight windows (start > end) wrap midnight.
 * Disabled / missing bounds → allowed.
 */
export function isWithinAccessWindow(
  now: Date,
  timeZone: string,
  startHm: string,
  endHm: string,
  enabled: boolean,
): boolean {
  if (!enabled) return true;
  const start = parseHmToMinutes(startHm);
  const end = parseHmToMinutes(endHm);
  if (start === null || end === null) return true;
  if (start === end) return false; // zero-width window = locked for non-owners
  const nowM = minutesNowInTimeZone(now, timeZone);
  if (start < end) return nowM >= start && nowM < end;
  return nowM >= start || nowM < end;
}

export function normalizeModuleAccess(raw: unknown): Record<AccessModule, DelegatedRole[]> {
  const out = {} as Record<AccessModule, DelegatedRole[]>;
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  for (const mod of ACCESS_MODULES) {
    const entry = src[mod];
    if (!Array.isArray(entry)) {
      out[mod] = [...DEFAULT_MODULE_ROLES];
      continue;
    }
    const roles = entry
      .map(String)
      .filter((r): r is DelegatedRole => (DELEGATED_ROLES as readonly string[]).includes(r));
    out[mod] = [...new Set(roles)];
  }
  return out;
}

export function roleCanAccessModule(
  role: OrganizationRole,
  module: AccessModule,
  moduleAccess: Record<AccessModule, DelegatedRole[]>,
): boolean {
  if (role === OrganizationRole.OWNER) return true;
  if (!(DELEGATED_ROLES as readonly string[]).includes(role)) return false;
  return moduleAccess[module]?.includes(role as DelegatedRole) ?? true;
}

/**
 * Map request path → access module. Returns null when the path is not module-gated
 * (auth, orgs lifecycle, uploads, health, etc.).
 */
export function moduleForPath(pathname: string): AccessModule | null {
  const path = pathname.replace(/^\/+/, '').toLowerCase();

  // Customer advance sub-routes before generic customers
  if (/^customers\/[^/]+\/advance/.test(path) || path === 'reports/advances') {
    return 'advance';
  }

  if (path === 'customers' || path.startsWith('customers/')) return 'customers';
  if (path === 'credits' || path.startsWith('credits/')) return 'credits';
  if (path === 'invoices' || path.startsWith('invoices/')) return 'invoices';
  if (path === 'stock' || path.startsWith('stock/')) return 'stock';
  if (
    path === 'purchases' ||
    path.startsWith('purchases/') ||
    path === 'vendors' ||
    path.startsWith('vendors/')
  ) {
    return 'purchases';
  }
  if (
    path === 'finance' ||
    path.startsWith('finance/') ||
    path.startsWith('finance/bank-statements')
  ) {
    return 'books';
  }
  if (path === 'reports' || path.startsWith('reports/')) return 'reports';

  return null;
}
