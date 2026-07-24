import { PurchasesService } from './purchases.service';

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
