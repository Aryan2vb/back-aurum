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
  it('purges prior rows then posts the new SALE weight', async () => {
    const service = new StockService({} as any);
    service.purgeTransactionsByReference = jest.fn().mockResolvedValue(undefined);
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

    expect(service.purgeTransactionsByReference).toHaveBeenCalledWith('org-1', 'inv-1', undefined);
    expect(service.recordStockTransaction).toHaveBeenCalledTimes(1);
    expect(service.recordStockTransaction).toHaveBeenCalledWith(
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
  it('purges prior rows then posts the new PURCHASE weight', async () => {
    const service = new StockService({} as any);
    service.purgeTransactionsByReference = jest.fn().mockResolvedValue(undefined);
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

    expect(service.purgeTransactionsByReference).toHaveBeenCalledWith('org-1', 'pur-1', undefined);
    expect(service.recordStockTransaction).toHaveBeenCalledTimes(1);
    expect(service.recordStockTransaction).toHaveBeenCalledWith(
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

describe('StockService.initializeOpeningBalance', () => {
  it('updates an existing opening balance and recalculates running balances', async () => {
    const existingOB = {
      id: 'ob-1',
      date: new Date('2026-04-01T00:00:00.000Z'),
    };
    const stockLedger = {
      findFirst: jest.fn().mockResolvedValueOnce(existingOB).mockResolvedValueOnce(null),
      update: jest.fn().mockResolvedValue({ id: 'ob-1' }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ob-1',
          transactionType: StockTransactionType.OPENING_BALANCE,
          quantityIn: 120,
          quantityOut: 0,
        },
      ]),
    };
    const stockBalance = {
      upsert: jest.fn().mockResolvedValue({}),
    };
    const tx = { stockLedger, stockBalance };
    const prisma = {
      stockLedger,
      $transaction: jest.fn((fn) => fn(tx)),
    } as any;
    const service = new StockService(prisma);
    const recalcSpy = jest
      .spyOn(service as any, 'recalcRunningBalances')
      .mockResolvedValue(undefined);

    await service.initializeOpeningBalance('org-1', 'GOLD', '22K', 120, 5100, '2026-04-01');

    expect(stockLedger.update).toHaveBeenCalledWith({
      where: { id: 'ob-1' },
      data: {
        quantityIn: 120,
        rate: 5100,
        totalValue: 612000,
        date: new Date('2026-04-01'),
      },
    });
    expect(recalcSpy).toHaveBeenCalledWith('org-1', 'GOLD', '22K', tx);
    expect(prisma.$transaction).toHaveBeenCalled();
    recalcSpy.mockRestore();
  });

  it('reuses the stored rate when an update omits rate', async () => {
    const existingOB = {
      id: 'ob-1',
      date: new Date('2026-04-01T00:00:00.000Z'),
      rate: 5000,
    };
    const stockLedger = {
      // 1st call: the existing opening balance, 2nd: earliest other movement (none).
      findFirst: jest.fn().mockResolvedValueOnce(existingOB).mockResolvedValueOnce(null),
      update: jest.fn().mockResolvedValue({ id: 'ob-1' }),
    };
    const tx = { stockLedger, stockBalance: {} };
    const prisma = {
      stockLedger,
      $transaction: jest.fn((fn) => fn(tx)),
    } as any;
    const service = new StockService(prisma);
    jest.spyOn(service as any, 'recalcRunningBalances').mockResolvedValue(undefined);

    await service.initializeOpeningBalance('org-1', 'GOLD', '22K', 120);

    expect(stockLedger.update).toHaveBeenCalledWith({
      where: { id: 'ob-1' },
      data: {
        quantityIn: 120,
        rate: 5000,
        totalValue: 600000,
        date: existingOB.date,
      },
    });
  });
});

describe('StockService.purgeTransactionsByReference', () => {
  it('deletes ledger rows for the reference then rebuilds balances in one transaction', async () => {
    const stockLedger = {
      findMany: jest.fn().mockResolvedValue([{ metalType: 'GOLD', purity: '22K' }]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantityIn: 50, quantityOut: 0 } }),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const stockBalance = {
      upsert: jest.fn().mockResolvedValue({}),
    };
    const tx = { stockLedger, stockBalance, $executeRaw: jest.fn().mockResolvedValue(1) };
    const prisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as any;
    const service = new StockService(prisma);

    await service.purgeTransactionsByReference('org-1', 'pur-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(stockLedger.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', referenceId: 'pur-1' },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: 50 },
      }),
    );
  });
});

describe('StockService.getGroupSummary', () => {
  it('keeps opening-balance stock in closing when no start date is given', async () => {
    const prisma = {
      stockLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            metalType: 'GOLD',
            purity: '22K',
            transactionType: StockTransactionType.OPENING_BALANCE,
            quantityIn: 100,
            quantityOut: 0,
            rate: 5000,
            date: new Date('2026-04-01T00:00:00.000Z'),
          },
          {
            metalType: 'GOLD',
            purity: '22K',
            transactionType: StockTransactionType.SALE,
            quantityIn: 0,
            quantityOut: 30,
            rate: 6000,
            date: new Date('2026-05-01T00:00:00.000Z'),
          },
        ]),
      },
    } as any;
    const service = new StockService(prisma);

    const [row] = await service.getGroupSummary('org-1');

    expect(row.opening.quantity).toBe(0);
    expect(row.closing.quantity).toBe(70);
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

describe('StockService metal purities', () => {
  const seedRows = [
    { organizationId: 'org-1', metalType: 'GOLD', label: '24K', sortOrder: 0 },
    { organizationId: 'org-1', metalType: 'GOLD', label: '22K', sortOrder: 1 },
    { organizationId: 'org-1', metalType: 'GOLD', label: '20K', sortOrder: 2 },
    { organizationId: 'org-1', metalType: 'GOLD', label: '18K', sortOrder: 3 },
    { organizationId: 'org-1', metalType: 'SILVER', label: 'F', sortOrder: 0 },
    { organizationId: 'org-1', metalType: 'SILVER', label: '925', sortOrder: 1 },
  ];

  it('seeds defaults when org has no purity rows', async () => {
    const created: any[] = [];
    const prisma = {
      orgMetalPurity: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockImplementation(({ data }) => {
          created.push(...data);
          return Promise.resolve({ count: data.length });
        }),
        findMany: jest
          .fn()
          .mockImplementation(() => Promise.resolve(created.filter((r) => r.isActive !== false))),
      },
    };
    // After seed, listPurities calls ensure then findMany — mock findMany to return seeded shape
    prisma.orgMetalPurity.findMany = jest
      .fn()
      .mockResolvedValue(seedRows.map((r) => ({ ...r, id: r.label, isActive: true })));
    const service = new StockService(prisma as any);

    const rows = await service.listPurities('org-1');
    expect(prisma.orgMetalPurity.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(prisma.orgMetalPurity.createMany.mock.calls[0][0].data).toHaveLength(6);
    expect(rows).toHaveLength(6);
  });

  it('rejects duplicate active labels case-insensitively', async () => {
    const prisma = {
      orgMetalPurity: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1',
          label: '22K',
          isActive: true,
          metalType: 'GOLD',
        }),
      },
    };
    const service = new StockService(prisma as any);
    await expect(service.createPurity('org-1', 'GOLD' as any, '22k')).rejects.toThrow(
      /already exists/i,
    );
  });

  it('soft-hides purity and excludes it from active list', async () => {
    const rows = [
      {
        id: 'p1',
        organizationId: 'org-1',
        metalType: 'GOLD',
        label: '22K',
        sortOrder: 0,
        isActive: true,
      },
      {
        id: 'p2',
        organizationId: 'org-1',
        metalType: 'GOLD',
        label: '20K',
        sortOrder: 1,
        isActive: true,
      },
    ];
    const prisma = {
      orgMetalPurity: {
        count: jest.fn().mockResolvedValue(2),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(rows.find((r) => r.id === where.id) || null),
          ),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const row = rows.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
        findMany: jest.fn().mockImplementation(({ where }) => {
          const list = where.isActive === true ? rows.filter((r) => r.isActive) : rows;
          return Promise.resolve(list);
        }),
      },
    };
    const service = new StockService(prisma as any);

    await service.hidePurity('org-1', 'p1');
    expect(prisma.orgMetalPurity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ isActive: false }),
      }),
    );

    const active = await service.listPurities('org-1', false);
    expect(active.map((r) => r.label)).toEqual(['20K']);

    const all = await service.listPurities('org-1', true);
    expect(all.map((r) => r.label).sort()).toEqual(['20K', '22K']);
  });

  it('restores a previously hidden purity instead of creating a duplicate', async () => {
    const prisma = {
      orgMetalPurity: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1',
          label: 'fancy',
          isActive: false,
          metalType: 'SILVER',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'p1',
          label: 'fancy',
          isActive: true,
          metalType: 'SILVER',
        }),
      },
    };
    const service = new StockService(prisma as any);
    const restored = await service.createPurity('org-1', 'SILVER' as any, 'fancy');
    expect(prisma.orgMetalPurity.update).toHaveBeenCalled();
    expect(restored.isActive).toBe(true);
  });
});
