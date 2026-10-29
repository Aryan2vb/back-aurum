export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/**
 * Escapes every string reachable through arrays and plain objects. Invoice templates
 * interpolate user-entered fields (buyer, company, notes, items) into public HTML.
 */
export function escapeHtmlDeep<T>(value: T): T {
  if (typeof value === 'string') return escapeHtml(value) as T;
  if (Array.isArray(value)) return value.map((v) => escapeHtmlDeep(v)) as T;
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = escapeHtmlDeep(v);
    return out as T;
  }
  return value;
}
