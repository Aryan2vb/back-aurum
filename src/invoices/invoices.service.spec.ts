import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { InvoicesService } from './invoices.service';

jest.mock('./utils/pdf.service', () => ({
  PdfService: jest.fn(),
}));

describe('InvoicesService invoice sequence allocation', () => {
  const organizationId = 'org-1';
  const financialYear = '2025-26';
  const settings = {
    invoiceNumberPrefix: 'INV',
    startingSequence: 100,
  };

  const buildService = () => new InvoicesService({} as any, {} as any, {} as any, {} as any) as any;

  const buildTx = ({
    existingInvoice = null,
    currentSequence = null,
    upsertResult = { nextSequence: 111 },
  }: {
    existingInvoice?: any;
    currentSequence?: any;
    upsertResult?: any;
  } = {}) => ({
    invoice: {
      findFirst: jest.fn().mockResolvedValue(existingInvoice),
    },
    invoiceSequence: {
      findUnique: jest.fn().mockResolvedValue(currentSequence),
      upsert: jest.fn().mockResolvedValue(upsertResult),
    },
  });

  it('auto allocates the current next sequence and increments the counter', async () => {
    const service = buildService();
    const tx = buildTx({ upsertResult: { nextSequence: 111 } });

    const result = await service._allocateInvoiceNumber(tx, {
      organizationId,
      financialYear,
      settings,
    });

    expect(result).toEqual({
      invoiceNumber: 'INV/110/2025-26',
      sequenceVal: 110,
    });
    expect(tx.invoiceSequence.upsert).toHaveBeenCalledWith({
      where: { organizationId_financialYear: { organizationId, financialYear } },
      create: {
        organizationId,
        financialYear,
        nextSequence: 101,
      },
      update: { nextSequence: { increment: 1 } },
    });
  });

  it('manual sequence above current next advances the counter', async () => {
    const service = buildService();
    const tx = buildTx({ currentSequence: { nextSequence: 110 } });

    const result = await service._allocateInvoiceNumber(tx, {
      organizationId,
      financialYear,
      settings,
      manualSequence: 115,
    });

    expect(result).toEqual({
      invoiceNumber: 'INV/115/2025-26',
      sequenceVal: 115,
    });
    expect(tx.invoiceSequence.upsert).toHaveBeenCalledWith({
      where: { organizationId_financialYear: { organizationId, financialYear } },
      create: { organizationId, financialYear, nextSequence: 116 },
      update: { nextSequence: 116 },
    });
  });

  it('manual skipped sequence below current next does not lower the counter', async () => {
    const service = buildService();
    const tx = buildTx({ currentSequence: { nextSequence: 116 } });

    const result = await service._allocateInvoiceNumber(tx, {
      organizationId,
      financialYear,
      settings,
      manualSequence: 112,
    });

    expect(result).toEqual({
      invoiceNumber: 'INV/112/2025-26',
      sequenceVal: 112,
    });
    expect(tx.invoiceSequence.upsert).not.toHaveBeenCalled();
  });

  it('rejects duplicate manual sequence invoice numbers', async () => {
    const service = buildService();
    const tx = buildTx({
      existingInvoice: { id: 'existing-invoice', invoiceNumber: 'INV/115/2025-26' },
      currentSequence: { nextSequence: 110 },
    });

    await expect(
      service._allocateInvoiceNumber(tx, {
        organizationId,
        financialYear,
        settings,
        manualSequence: 115,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.invoiceSequence.upsert).not.toHaveBeenCalled();
  });

  it('rejects manual sequence reserved by a draft invoice', async () => {
    const service = buildService();
    const tx = buildTx({
      existingInvoice: { id: 'draft-invoice', invoiceNumber: null, sequence: 115 },
      currentSequence: { nextSequence: 120 },
    });

    await expect(
      service._allocateInvoiceNumber(tx, {
        organizationId,
        financialYear,
        settings,
        manualSequence: 115,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.invoice.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId,
        OR: [{ invoiceNumber: 'INV/115/2025-26' }, { financialYear, sequence: 115 }],
      },
    });
    expect(tx.invoiceSequence.upsert).not.toHaveBeenCalled();
  });

  it('allows manual sequence when the matching reserved draft is excluded', async () => {
    const service = buildService();
    const tx = buildTx({
      currentSequence: { nextSequence: 120 },
    });

    const result = await service._allocateInvoiceNumber(tx, {
      organizationId,
      financialYear,
      settings,
      manualSequence: 115,
      excludeInvoiceId: 'draft-invoice',
    });

    expect(result).toEqual({
      invoiceNumber: 'INV/115/2025-26',
      sequenceVal: 115,
    });
    expect(tx.invoice.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId,
        OR: [{ invoiceNumber: 'INV/115/2025-26' }, { financialYear, sequence: 115 }],
        NOT: { id: 'draft-invoice' },
      },
    });
  });

  it('reports whether a manual sequence is available', async () => {
    const prisma = {
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'invoice-1' }),
      },
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;

    await expect(
      service.getSequenceAvailability(organizationId, 112, '2025-04-01'),
    ).resolves.toEqual({
      sequence: 112,
      invoiceNumber: 'INV/112/25-26',
      financialYear: '25-26',
      available: true,
    });
    await expect(
      service.getSequenceAvailability(organizationId, 115, '2025-04-01'),
    ).resolves.toEqual({
      sequence: 115,
      invoiceNumber: 'INV/115/25-26',
      financialYear: '25-26',
      available: false,
    });
  });

  it('reports sequence availability while excluding the current draft invoice', async () => {
    const prisma = {
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;

    await service.getSequenceAvailability(organizationId, 115, '2025-04-01', 'draft-invoice');

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId,
        OR: [{ invoiceNumber: 'INV/115/25-26' }, { financialYear: '25-26', sequence: 115 }],
        NOT: { id: 'draft-invoice' },
      },
    });
  });

  it('excludes the draft itself when finalizing a reserved draft sequence', async () => {
    const tx = {
      ...buildTx({ currentSequence: { nextSequence: 120 } }),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'invoice-1', ...data })),
      },
    };
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          organizationId,
          customerId: 'customer-1',
          status: 'DRAFT',
          sequence: 115,
          paidAmount: new Decimal(0),
          totalAmount: new Decimal(103),
          invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
          buyerSnapshot: { data: {} },
          items: [],
        }),
      },
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._createInvoiceBalanceRecord = jest.fn();

    await service.finalize(
      'invoice-1',
      { organizationId, userId: 'user-1' },
      { invoiceDate: '2025-04-01' },
    );

    expect(tx.invoice.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId,
        OR: [{ invoiceNumber: 'INV/115/25-26' }, { financialYear: '25-26', sequence: 115 }],
        NOT: { id: 'invoice-1' },
      },
    });
  });

  it('reports missing invoice sequences before the current next sequence using settings prefix', async () => {
    const prisma = {
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue({
          invoiceNumberPrefix: 'BILL',
          startingSequence: 10,
        }),
      },
      invoiceSequence: {
        findUnique: jest.fn().mockResolvedValue({ nextSequence: 18 }),
      },
      invoice: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { sequence: 10 },
            { sequence: 11 },
            { sequence: 13 },
            { sequence: 16 },
            { sequence: 17 },
          ]),
      },
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.getMissingSequences(organizationId, '2025-04-01')).resolves.toEqual({
      prefix: 'BILL',
      financialYear: '25-26',
      nextSequence: 18,
      missingSequences: [12, 14, 15],
      missingInvoiceNumbers: ['BILL/12/25-26', 'BILL/14/25-26', 'BILL/15/25-26'],
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        financialYear: '25-26',
        sequence: { gte: 10, lt: 18 },
      },
      select: { sequence: true },
    });
  });

  it('reports no missing invoice sequences when the sequence has not advanced past the start', async () => {
    const prisma = {
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
      invoiceSequence: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      invoice: {
        findMany: jest.fn(),
      },
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.getMissingSequences(organizationId, '2025-04-01')).resolves.toEqual({
      prefix: 'INV',
      financialYear: '25-26',
      nextSequence: 100,
      missingSequences: [],
      missingInvoiceNumbers: [],
    });
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it('accepts legacy manual invoice numbers without consuming numeric sequence', async () => {
    const service = buildService();
    const tx = buildTx();

    const result = await service._allocateInvoiceNumber(tx, {
      organizationId,
      financialYear,
      settings,
      manualInvoiceNumber: 'LEGACY-42',
    });

    expect(result).toEqual({
      invoiceNumber: 'LEGACY-42',
      sequenceVal: null,
    });
    expect(tx.invoice.findFirst).toHaveBeenCalledWith({
      where: { organizationId, invoiceNumber: 'LEGACY-42' },
    });
    expect(tx.invoiceSequence.upsert).not.toHaveBeenCalled();
  });

  it('uses manual sequence when PATCH finalizes a draft invoice', async () => {
    const tx = {
      ...buildTx({ currentSequence: { nextSequence: 110 } }),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'invoice-1', ...data })),
      },
      invoiceItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      invoicePayment: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
    };
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          organizationId,
          customerId: 'customer-1',
          status: 'DRAFT',
          paidAmount: new Decimal(0),
          invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
          buyerSnapshot: { data: {} },
          items: [],
          payments: [],
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._calculateInvoiceFinancials = jest.fn().mockResolvedValue({
      taxType: 'CGST_SGST',
      placeOfSupply: '07',
      subtotal: new Decimal(100),
      taxableAmount: new Decimal(100),
      cgstRate: new Decimal(1.5),
      sgstRate: new Decimal(1.5),
      igstRate: new Decimal(0),
      cgstAmount: new Decimal(1.5),
      sgstAmount: new Decimal(1.5),
      igstAmount: new Decimal(0),
      totalHallmarkingCharges: new Decimal(0),
      roundOff: new Decimal(0),
      grandTotal: new Decimal(103),
      paidAmount: new Decimal(103),
      metalRateSource: 'MANUAL',
      metalRateDate: new Date('2025-04-01T00:00:00.000Z'),
      companySnapshot: { version: 1, data: {} },
      buyerSnapshot: { version: 1, data: {} },
      invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
      financialYear,
      notes: '',
      lineItems: [],
    });
    service._syncInvoiceFinancialsWithLedger = jest.fn();

    await service.update(
      'invoice-1',
      { finalize: true, manualSequence: 115 },
      { organizationId, userId: 'user-1' },
    );

    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNumber: 'INV/115/2025-26',
          sequence: 115,
          status: 'PAID',
        }),
      }),
    );
    expect(tx.invoiceSequence.upsert).toHaveBeenCalledWith({
      where: { organizationId_financialYear: { organizationId, financialYear } },
      create: { organizationId, financialYear, nextSequence: 116 },
      update: { nextSequence: 116 },
    });
  });

  it('does not carry stale buyer snapshot address when update sends no buyer override', async () => {
    const tx = {
      invoice: {
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'invoice-1', ...data })),
      },
      invoiceItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      invoicePayment: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
    };
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          organizationId,
          customerId: 'new-customer',
          status: 'PAID',
          paidAmount: new Decimal(103),
          modeOfPayment: 'CASH',
          templateType: 'jewellery',
          invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
          buyerSnapshot: {
            data: {
              name: 'OLD CUSTOMER',
              address: 'GERUAR',
              state: 'Madhya Pradesh',
              stateCode: '',
            },
          },
          items: [],
          payments: [],
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._calculateInvoiceFinancials = jest.fn().mockResolvedValue({
      taxType: 'CGST_SGST',
      placeOfSupply: '07',
      subtotal: new Decimal(100),
      taxableAmount: new Decimal(100),
      cgstRate: new Decimal(1.5),
      sgstRate: new Decimal(1.5),
      igstRate: new Decimal(0),
      cgstAmount: new Decimal(1.5),
      sgstAmount: new Decimal(1.5),
      igstAmount: new Decimal(0),
      totalHallmarkingCharges: new Decimal(0),
      roundOff: new Decimal(0),
      grandTotal: new Decimal(103),
      paidAmount: new Decimal(103),
      metalRateSource: 'MANUAL',
      metalRateDate: new Date('2025-04-01T00:00:00.000Z'),
      companySnapshot: { version: 1, data: {} },
      buyerSnapshot: {
        version: 1,
        data: {
          name: 'NEW CUSTOMER',
          address: 'DEHRADOON',
          phone: '9997947068',
          state: 'UTTARAKHAND',
          stateCode: '',
        },
      },
      invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
      financialYear,
      notes: '',
      lineItems: [],
    });
    service._syncInvoiceFinancialsWithLedger = jest.fn();

    await service.update(
      'invoice-1',
      { customerId: 'new-customer' },
      { organizationId, userId: 'user-1' },
    );

    expect(service._calculateInvoiceFinancials).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'new-customer',
        buyerAddress: undefined,
        buyerState: undefined,
        buyerStateCode: undefined,
      }),
      expect.anything(),
      true,
    );
    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'new-customer',
          buyerSnapshot: {
            version: 1,
            data: {
              name: 'NEW CUSTOMER',
              address: 'DEHRADOON',
              phone: '9997947068',
              state: 'UTTARAKHAND',
              stateCode: '',
            },
          },
        }),
      }),
    );
  });

  it('uses manual sequence when creating a finalized invoice directly', async () => {
    const tx = {
      ...buildTx({ currentSequence: { nextSequence: 18 } }),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'invoice-1', ...data, items: [] }),
          ),
      },
    };
    const prisma = {
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._calculateInvoiceFinancials = jest.fn().mockResolvedValue({
      status: 'PAID',
      taxType: 'CGST_SGST',
      placeOfSupply: '07',
      subtotal: new Decimal(100),
      taxableAmount: new Decimal(100),
      cgstRate: new Decimal(1.5),
      sgstRate: new Decimal(1.5),
      igstRate: new Decimal(0),
      cgstAmount: new Decimal(1.5),
      sgstAmount: new Decimal(1.5),
      igstAmount: new Decimal(0),
      totalHallmarkingCharges: new Decimal(0),
      roundOff: new Decimal(0),
      grandTotal: new Decimal(103),
      totalAmount: new Decimal(103),
      paidAmount: new Decimal(103),
      metalRateSource: 'MANUAL',
      metalRateDate: new Date('2025-04-01T00:00:00.000Z'),
      companySnapshot: { version: 1, data: {} },
      buyerSnapshot: { version: 1, data: {} },
      invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
      financialYear,
      notes: '',
      lineItems: [],
      needsCredit: false,
    });

    await service.create(
      {
        customerId: 'customer-1',
        manualSequence: 25,
        items: [],
      },
      { organizationId, userId: 'user-1' },
    );

    expect(tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNumber: 'INV/25/2025-26',
          sequence: 25,
        }),
      }),
    );
    expect(tx.invoiceSequence.upsert).toHaveBeenCalledWith({
      where: { organizationId_financialYear: { organizationId, financialYear } },
      create: { organizationId, financialYear, nextSequence: 26 },
      update: { nextSequence: 26 },
    });
  });

  it('reserves manual sequence when saving a draft invoice', async () => {
    const tx = {
      ...buildTx({ currentSequence: { nextSequence: 18 } }),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'invoice-1', ...data, items: [] }),
          ),
      },
    };
    const prisma = {
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._calculateInvoiceFinancials = jest.fn().mockResolvedValue({
      status: 'DRAFT',
      taxType: 'CGST_SGST',
      placeOfSupply: '07',
      subtotal: new Decimal(100),
      taxableAmount: new Decimal(100),
      cgstRate: new Decimal(1.5),
      sgstRate: new Decimal(1.5),
      igstRate: new Decimal(0),
      cgstAmount: new Decimal(1.5),
      sgstAmount: new Decimal(1.5),
      igstAmount: new Decimal(0),
      totalHallmarkingCharges: new Decimal(0),
      roundOff: new Decimal(0),
      grandTotal: new Decimal(103),
      paidAmount: new Decimal(0),
      metalRateSource: 'MANUAL',
      metalRateDate: new Date('2025-04-01T00:00:00.000Z'),
      companySnapshot: { version: 1, data: {} },
      buyerSnapshot: { version: 1, data: {} },
      invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
      financialYear,
      notes: '',
      lineItems: [],
      needsCredit: false,
    });

    await service.createDraft(
      {
        customerId: 'customer-1',
        manualSequence: 25,
        items: [],
      },
      { organizationId, userId: 'user-1' },
    );

    expect(tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNumber: null,
          sequence: 25,
        }),
      }),
    );
    expect(tx.invoiceSequence.upsert).toHaveBeenCalledWith({
      where: { organizationId_financialYear: { organizationId, financialYear } },
      create: { organizationId, financialYear, nextSequence: 26 },
      update: { nextSequence: 26 },
    });
  });

  it('uses reserved draft sequence when finalizing without a new manual sequence', async () => {
    const tx = {
      ...buildTx({ currentSequence: { nextSequence: 26 } }),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'invoice-1', ...data })),
      },
    };
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          organizationId,
          customerId: 'customer-1',
          status: 'DRAFT',
          sequence: 25,
          paidAmount: new Decimal(103),
          totalAmount: new Decimal(103),
          invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
          buyerSnapshot: { data: {} },
          items: [],
        }),
      },
      orgInvoiceSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._createInvoiceBalanceRecord = jest.fn();

    await service.finalize(
      'invoice-1',
      { organizationId, userId: 'user-1' },
      { invoiceDate: '2025-04-01' },
    );

    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNumber: 'INV/25/25-26',
          sequence: 25,
        }),
      }),
    );
    expect(tx.invoiceSequence.upsert).not.toHaveBeenCalled();
  });
});
