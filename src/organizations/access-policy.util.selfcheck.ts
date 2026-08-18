/**
 * Self-check for access-window + module path mapping (no test framework).
 * Run: npx ts-node -r tsconfig-paths/register src/organizations/access-policy.util.selfcheck.ts
 */
import {
  isWithinAccessWindow,
  moduleForPath,
  normalizeModuleAccess,
  roleCanAccessModule,
} from './access-policy.util';
import { OrganizationRole } from '@prisma/client';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Fixed "now" via mocking minutes: test pure window math with a fake Date in UTC
// and timezone UTC so wall clock === Date UTC hours.
const atUtc = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 15, h, m, 0));

assert(isWithinAccessWindow(atUtc(10), 'UTC', '09:00', '20:00', true), '10:00 in window');
assert(!isWithinAccessWindow(atUtc(8), 'UTC', '09:00', '20:00', true), '08:00 outside');
assert(!isWithinAccessWindow(atUtc(20), 'UTC', '09:00', '20:00', true), '20:00 exclusive end');
assert(isWithinAccessWindow(atUtc(8), 'UTC', '09:00', '20:00', false), 'disabled always ok');
assert(isWithinAccessWindow(atUtc(23), 'UTC', '22:00', '06:00', true), 'overnight late');
assert(isWithinAccessWindow(atUtc(5), 'UTC', '22:00', '06:00', true), 'overnight early');
assert(!isWithinAccessWindow(atUtc(12), 'UTC', '22:00', '06:00', true), 'overnight midday blocked');

assert(moduleForPath('/stock/balances') === 'stock', 'stock path');
assert(moduleForPath('customers/abc/advance') === 'advance', 'advance path');
assert(moduleForPath('customers/abc/advance-balance') === 'advance', 'advance-balance');
assert(moduleForPath('customers/abc') === 'customers', 'customer detail');
assert(moduleForPath('finance/books') === 'books', 'books');
assert(moduleForPath('vendors') === 'purchases', 'vendors→purchases');
assert(moduleForPath('auth/whoami') === null, 'auth not gated by module');

const mods = normalizeModuleAccess({ stock: ['ADMIN'], books: ['VIEWER', 'ADMIN'] });
assert(mods.stock.length === 1 && mods.stock[0] === 'ADMIN', 'normalize stock');
assert(roleCanAccessModule(OrganizationRole.OWNER, 'stock', mods), 'owner always');
assert(roleCanAccessModule(OrganizationRole.ADMIN, 'stock', mods), 'admin stock');
assert(!roleCanAccessModule(OrganizationRole.VIEWER, 'stock', mods), 'viewer no stock');
assert(roleCanAccessModule(OrganizationRole.VIEWER, 'customers', mods), 'default customers');

const malformed = normalizeModuleAccess({ stock: 'ADMIN', books: ['VIEWER'] });
assert(malformed.stock.length === 0, 'present non-array → empty');
assert(malformed.books.length === 1 && malformed.books[0] === 'VIEWER', 'valid array kept');
assert(malformed.customers.length === 3, 'missing module → default roles');

console.log('access-policy.util.selfcheck: ok');
