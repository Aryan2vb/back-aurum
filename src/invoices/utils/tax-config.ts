import { TaxType } from '@prisma/client';

export interface TaxConfigInput {
  taxType?: TaxType | null;
  cgstRate?: number | string | { toString(): string } | null;
  sgstRate?: number | string | { toString(): string } | null;
  igstRate?: number | string | { toString(): string } | null;
}

export interface TaxConfigDefaults {
  defaultTaxType?: TaxType | null;
  defaultCgstRate?: number | string | { toString(): string } | null;
  defaultSgstRate?: number | string | { toString(): string } | null;
  defaultIgstRate?: number | string | { toString(): string } | null;
}

export interface ResolvedTaxConfig {
  taxType: TaxType;
  cgst: string;
  sgst: string;
  igst: string;
}

const pick = (
  requested: TaxConfigInput['cgstRate'],
  fallback: TaxConfigInput['cgstRate'],
): string => String(requested ?? fallback ?? 0);

/**
 * Resolves the tax type and rates for an invoice. Values sent with the request win;
 * anything omitted falls back to the organization's invoice settings. Rates that do not
 * apply to the resolved type are zeroed, so `NONE` never carries CGST/SGST/IGST.
 */
export function resolveTaxConfig(
  requested: TaxConfigInput,
  settings: TaxConfigDefaults,
): ResolvedTaxConfig {
  const taxType = requested.taxType ?? settings.defaultTaxType ?? TaxType.CGST_SGST;

  if (taxType === TaxType.NONE) {
    return { taxType, cgst: '0', sgst: '0', igst: '0' };
  }
  if (taxType === TaxType.IGST) {
    return {
      taxType,
      cgst: '0',
      sgst: '0',
      igst: pick(requested.igstRate, settings.defaultIgstRate),
    };
  }
  return {
    taxType,
    cgst: pick(requested.cgstRate, settings.defaultCgstRate),
    sgst: pick(requested.sgstRate, settings.defaultSgstRate),
    igst: '0',
  };
}
