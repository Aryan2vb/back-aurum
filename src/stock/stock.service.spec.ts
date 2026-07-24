import { StockService } from './stock.service';
import { StockTransactionType } from '@prisma/client';

describe('StockService.normalizePurity', () => {
  const service = new StockService({} as any);

  it('maps karat decimals and labels to canonical keys', () => {
    expect(service.normalizePurity('22.00', 'GOLD')).toBe('22K');
    expect(service.normalizePurity('22K', 'GOLD')).toBe('22K');
    expect(service.normalizePurity('916', 'GOLD')).toBe('22K');
    expect(service.normalizePurity('999', 'SILVER')).toBe('F');
  });
});

describe('StockService.syncSaleStockForInvoice', () => {
  it('reverses prior net then posts the new SALE weight', async () => {
    const stockLedger = {
      findMany: jest.fn().mockResolvedValue([
        {
          metalType: 'GOLD',
          purity: '22K',
          quantityIn: 0,
          quantityOut: 10,
          rate: 5000,
        },
      ]),
    };
    const prisma = { stockLedger } as any;
    const service = new StockService(prisma);
    service.recordStockTransaction = jest.fn().mockResolvedValue({ balance: 0 });

    await service.syncSaleStockForInvoice({
      organizationId: 'org-1',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV/1',
      items: [
        {
          metalType: 'GOLD',
          purityLabel: '22K',
          netWeight: 8,
          effectiveRate: 5000,
        },
      ],
    });

    expect(service.recordStockTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        transactionType: StockTransactionType.ADJUSTMENT,
        quantityIn: 10,
        metalType: 'GOLD',
        purity: '22K',
        referenceId: 'inv-1',
      }),
    );
    expect(service.recordStockTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        transactionType: StockTransactionType.SALE,
        quantityOut: 8,
        metalType: 'GOLD',
        purity: '22K',
        referenceId: 'inv-1',
      }),
    );
  });
});

describe('StockService.syncPurchaseStockForInvoice', () => {
  it('reverses prior net then posts the new PURCHASE weight', async () => {
    const stockLedger = {
      findMany: jest.fn().mockResolvedValue([
        {
          metalType: 'GOLD',
          purity: '22K',
          quantityIn: 10,
          quantityOut: 0,
          rate: 5000,
        },
      ]),
    };
    const prisma = { stockLedger } as any;
    const service = new StockService(prisma);
    service.recordStockTransaction = jest.fn().mockResolvedValue({ balance: 0 });

    await service.syncPurchaseStockForInvoice({
      organizationId: 'org-1',
      purchaseId: 'pur-1',
      invoiceNumber: 'PB/1',
      items: [
        {
          metalType: 'GOLD',
          purity: '22K',
          netWeight: 8,
          rate: 5000,
          itemName: 'Ornaments',
        },
      ],
    });

    expect(service.recordStockTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        transactionType: StockTransactionType.ADJUSTMENT,
        quantityOut: 10,
        metalType: 'GOLD',
        purity: '22K',
        referenceId: 'pur-1',
      }),
    );
    expect(service.recordStockTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        transactionType: StockTransactionType.PURCHASE,
        quantityIn: 8,
        metalType: 'GOLD',
        purity: '22K',
        referenceId: 'pur-1',
      }),
    );
  });
});

describe('StockService.purgeTransactionsByReference', () => {
  it('deletes ledger rows for the reference then rebuilds balances', async () => {
    const stockLedger = {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          { metalType: 'GOLD', purity: '22K' },
        ])
        .mockResolvedValueOnce([
          {
            id: 'ob-1',
            transactionType: StockTransactionType.OPENING_BALANCE,
            quantityIn: 50,
            quantityOut: 0,
          },
        ]),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      update: jest.fn().mockResolvedValue({}),
    };
    const stockBalance = {
      upsert: jest.fn().mockResolvedValue({}),
    };
    const prisma = { stockLedger, stockBalance } as any;
    const service = new StockService(prisma);

    await service.purgeTransactionsByReference('org-1', 'pur-1');

    expect(stockLedger.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', referenceId: 'pur-1' },
    });
    expect(stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: 50 },
      }),
    );
  });
});

describe('StockService.getGroupSummary', () => {
  it('includes end-date movements and ADJUSTMENT rows in the period', async () => {
    const stockLedger = {
      findMany: jest.fn().mockResolvedValue([
        {
          metalType: 'GOLD',
          purity: '22K',
          transactionType: StockTransactionType.OPENING_BALANCE,
          quantityIn: 100,
          quantityOut: 0,
          rate: 5000,
          date: new Date('2026-05-01T00:00:00.000Z'),
        },
        {
          metalType: 'GOLD',
          purity: '22K',
          transactionType: StockTransactionType.SALE,
          quantityIn: 0,
          quantityOut: 10,
          rate: 5500,
          date: new Date('2026-06-30T15:00:00.000Z'), // after UTC midnight of end day
        },
        {
          metalType: 'GOLD',
          purity: '22K',
          transactionType: StockTransactionType.ADJUSTMENT,
          quantityIn: 4,
          quantityOut: 0,
          rate: 5000,
          date: new Date('2026-06-15T10:00:00.000Z'),
        },
      ]),
    };
    const prisma = { stockLedger } as any;
    const service = new StockService(prisma);

    const rows = await service.getGroupSummary('org-1', '2026-06-01', '2026-06-30');
    const gold = rows.find((r) => r.metalType === 'GOLD' && r.purity === '22K');

    expect(gold).toBeDefined();
    expect(gold!.opening.quantity).toBe(100);
    expect(gold!.inwards.quantity).toBe(4);
    expect(gold!.outwards.quantity).toBe(10);
    expect(gold!.closing.quantity).toBe(94);
  });
});
