import { PurchasesService } from './purchases.service';

describe('PurchasesService computeTotals', () => {
  it('includes hallmark and other charges in taxable amount and GST', () => {
    const service = new PurchasesService({} as any, {} as any, {} as any);
    const result = (service as any).computeTotals(
      [
        {
          metalType: 'GOLD',
          purity: '22K',
          netWeight: 10,
          rate: 5000,
          hallmarkingCharge: 45,
          otherCharges: 100,
        },
      ],
      {
        addGst: true,
        gstInclusive: false,
        taxType: 'CGST_SGST',
        cgstRate: 1.5,
        sgstRate: 1.5,
      },
    );

    expect(result.totalMetalAmount).toBe(50000);
    expect(result.totalHallmarkingCharges).toBe(45);
    expect(result.totalOtherCharges).toBe(100);
    expect(result.taxableAmount).toBe(50145);
    expect(result.cgstAmount).toBe(752.18);
    expect(result.sgstAmount).toBe(752.18);
    expect(result.grandTotal).toBe(51649.36);
  });

  it('applies signed bill-level adjustment after GST', () => {
    const service = new PurchasesService({} as any, {} as any, {} as any);
    const base = {
      addGst: true,
      gstInclusive: false,
      taxType: 'CGST_SGST' as const,
      cgstRate: 1.5,
      sgstRate: 1.5,
    };
    const items = [
      {
        metalType: 'GOLD' as const,
        purity: '22K',
        netWeight: 10,
        rate: 5000,
      },
    ];

    const reduced = (service as any).computeTotals(items, { ...base, adjustment: -100 });
    expect(reduced.grandTotal).toBe(51400);

    const increased = (service as any).computeTotals(items, { ...base, adjustment: 50 });
    expect(increased.grandTotal).toBe(51550);
  });
});

describe('PurchasesService fund validation', () => {
  it('rejects combined payments that exceed the account balance', async () => {
    const service = new PurchasesService({} as any, {} as any, {} as any);
    const tx = {
      financialMovement: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100_000 } }),
      },
    };

    await expect(
      (service as any).assertSufficientTreasuryFunds(tx, 'org-1', [
        { accountId: 'cash-1', amount: 60_000 },
        { accountId: 'cash-1', amount: 50_000 },
      ]),
    ).rejects.toThrow('Insufficient account funds');
  });

  it('allows payments within the available account balance', async () => {
    const service = new PurchasesService({} as any, {} as any, {} as any);
    const tx = {
      financialMovement: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100_000 } }),
      },
    };

    await expect(
      (service as any).assertSufficientTreasuryFunds(tx, 'org-1', [
        { accountId: 'bank-1', amount: 40_000 },
      ]),
    ).resolves.toBeUndefined();
  });
});
