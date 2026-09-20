/**
 * Invoice print formats. `standard` is the plain GST invoice, `modern` and `jewellery`
 * are the alternative layouts.
 *
 * Existing rows and older clients use a few aliases for the standard layout
 * ("classic" from the invoice editor, "default" from the org settings), so those are
 * still accepted on input and folded into `standard`.
 */
export const INVOICE_TEMPLATE_TYPES = ['standard', 'modern', 'jewellery'] as const;
export type InvoiceTemplateType = (typeof INVOICE_TEMPLATE_TYPES)[number];

/** Every value a client may send for `templateType`. */
export const INVOICE_TEMPLATE_INPUTS: readonly string[] = [
  ...INVOICE_TEMPLATE_TYPES,
  'classic',
  'default',
];

/** Canonical template for an incoming/stored value, or undefined when none was given. */
export function normalizeTemplateType(value?: string | null): InvoiceTemplateType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'jewellery' || value === 'modern') return value;
  return 'standard';
}
