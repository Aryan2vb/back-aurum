import { TaxType } from '@prisma/client';
import { resolveTaxConfig } from './tax-config';

const settings = {
  defaultTaxType: TaxType.CGST_SGST,
  defaultCgstRate: 1.5,
  defaultSgstRate: 1.5,
  defaultIgstRate: 3,
};

describe('resolveTaxConfig', () => {
  it('falls back to the org settings when the request sends no tax fields', () => {
    expect(resolveTaxConfig({}, settings)).toEqual({
      taxType: TaxType.CGST_SGST,
      cgst: '1.5',
      sgst: '1.5',
      igst: '0',
    });
  });

  it('zeroes every rate for NONE even when settings default to GST', () => {
    expect(
      resolveTaxConfig({ taxType: TaxType.NONE, cgstRate: 1.5, sgstRate: 1.5 }, settings),
    ).toEqual({
      taxType: TaxType.NONE,
      cgst: '0',
      sgst: '0',
      igst: '0',
    });
  });

  it('uses the requested IGST rate and zeroes CGST/SGST', () => {
    expect(resolveTaxConfig({ taxType: TaxType.IGST, igstRate: 5 }, settings)).toEqual({
      taxType: TaxType.IGST,
      cgst: '0',
      sgst: '0',
      igst: '5',
    });
  });

  it('uses the IGST settings default when the request omits the rate', () => {
    expect(resolveTaxConfig({ taxType: TaxType.IGST }, settings).igst).toBe('3');
  });

  it('prefers requested CGST/SGST rates over settings, including an explicit 0', () => {
    expect(
      resolveTaxConfig({ taxType: TaxType.CGST_SGST, cgstRate: 0, sgstRate: 2 }, settings),
    ).toEqual({
      taxType: TaxType.CGST_SGST,
      cgst: '0',
      sgst: '2',
      igst: '0',
    });
  });

  it('honours a NONE default in settings', () => {
    expect(resolveTaxConfig({}, { ...settings, defaultTaxType: TaxType.NONE }).taxType).toBe(
      TaxType.NONE,
    );
  });
});
