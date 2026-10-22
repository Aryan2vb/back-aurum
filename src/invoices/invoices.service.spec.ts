import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { InvoicesService } from './invoices.service';

jest.mock('./utils/pdf.service', () => ({
  PdfService: jest.fn(),
}));

describe('InvoicesService payment dates', () => {
  const buildService = () => new InvoicesService({} as any, {} as any, {} as any, {} as any) as any;

  it('normalizes a selected payment date to the start of that UTC day', () => {
    const service = buildService();

    expect(service._parsePaymentPaidAt('2026-05-22', new Date('2026-06-01'))).toEqual(
      new Date('2026-05-22T00:00:00.000Z'),
    );
  });

  it('uses the invoice date when legacy clients omit paidAt', () => {
    const service = buildService();

    expect(service._parsePaymentPaidAt(undefined, new Date('2026-06-01'))).toEqual(
      new Date('2026-06-01T00:00:00.000Z'),
    );
  });

  it('rejects payment dates after the invoice date', () => {
    const service = buildService();

    expect(() => service._parsePaymentPaidAt('2026-06-12', new Date('2026-06-01'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects future payment dates even when the invoice date is later', () => {
    const service = buildService();

    expect(() => service._parsePaymentPaidAt('2999-01-01', new Date('2999-02-01'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid calendar dates', () => {
    const service = buildService();

    expect(() => service._parsePaymentPaidAt('2026-02-31', new Date('2026-06-01'))).toThrow(
      BadRequestException,
    );
  });

  it('allows an unchanged existing later payment only once', () => {
    const service = buildService();
    const existingPayments = [
      {
        mode: 'CASH',
        amount: new Decimal(100),
        paidAt: new Date('2026-06-12T00:00:00.000Z'),
        reference: null,
      },
    ];
    const payment = { mode: 'CASH', amount: 100, paidAt: '2026-06-12', reference: undefined };

    expect(service._consumeMatchingExistingPayment(payment, existingPayments)).toBe(true);
    expect(service._consumeMatchingExistingPayment(payment, existingPayments)).toBe(false);
  });

  it('does not preserve an existing future payment date', () => {
    const service = buildService();
    const existingPayments = [
      {
        mode: 'CASH',
        amount: new Decimal(100),
        paidAt: new Date('2999-01-01T00:00:00.000Z'),
        reference: null,
      },
    ];

    expect(
      service._consumeMatchingExistingPayment(
        { mode: 'CASH', amount: 100, paidAt: '2999-01-01' },
        existingPayments,
      ),
    ).toBe(false);
  });
});

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
        findMany: jest.fn().mockResolvedValue([
          { sequence: 10, invoiceDate: new Date('2025-04-01') },
          { sequence: 11, invoiceDate: new Date('2025-04-02') },
          { sequence: 13, invoiceDate: new Date('2025-04-04') },
          { sequence: 16, invoiceDate: new Date('2025-04-07') },
          { sequence: 17, invoiceDate: new Date('2025-04-08') },
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
      missingDetails: [
        {
          sequence: 12,
          invoiceNumber: 'BILL/12/25-26',
          minDate: new Date('2025-04-02'),
          maxDate: new Date('2025-04-04'),
        },
        {
          sequence: 14,
          invoiceNumber: 'BILL/14/25-26',
          minDate: new Date('2025-04-04'),
          maxDate: new Date('2025-04-07'),
        },
        {
          sequence: 15,
          invoiceNumber: 'BILL/15/25-26',
          minDate: new Date('2025-04-04'),
          maxDate: new Date('2025-04-07'),
        },
      ],
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        financialYear: '25-26',
        sequence: { gte: 10, lt: 18 },
      },
      select: { sequence: true, invoiceDate: true },
      orderBy: { sequence: 'asc' },
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

describe('InvoicesService.update print format', () => {
  const organizationId = 'org-1';

  const build = (existingTemplate: string) => {
    const tx = {
      invoice: {
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'invoice-1', ...data })),
      },
      invoiceItem: { deleteMany: jest.fn(), createMany: jest.fn() },
      invoicePayment: { deleteMany: jest.fn(), createMany: jest.fn() },
      orgInvoiceSettings: { findUnique: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          organizationId,
          customerId: 'customer-1',
          status: 'PAID',
          paidAmount: new Decimal(103),
          modeOfPayment: 'CASH',
          templateType: existingTemplate,
          invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
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
      buyerSnapshot: { version: 1, data: { name: 'B' } },
      invoiceDate: new Date('2025-04-01T00:00:00.000Z'),
      financialYear: '2025-26',
      notes: '',
      lineItems: [],
    });
    service._syncInvoiceFinancialsWithLedger = jest.fn();
    return { service, tx };
  };

  it('saves a new format chosen while editing a finalized standard invoice', async () => {
    const { service, tx } = build('standard');
    await service.update(
      'invoice-1',
      { templateType: 'jewellery' },
      { organizationId, userId: 'u' },
    );
    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateType: 'jewellery' }) }),
    );
  });

  it('stores the canonical name when the editor sends the "classic" alias', async () => {
    const { service, tx } = build('jewellery');
    await service.update('invoice-1', { templateType: 'classic' }, { organizationId, userId: 'u' });
    expect(tx.invoice.update.mock.calls[0][0].data.templateType).toBe('standard');
  });

  it('leaves the stored format alone when the update does not mention one', async () => {
    const { service, tx } = build('jewellery');
    await service.update(
      'invoice-1',
      { customerId: 'customer-2' },
      { organizationId, userId: 'u' },
    );
    expect(tx.invoice.update.mock.calls[0][0].data).not.toHaveProperty('templateType');
  });
});

describe('InvoicesService bill book', () => {
  const organizationId = 'org-1';

  it('loads complete selected invoices in batches and renders them oldest first', async () => {
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'invoice-2', invoiceDate: new Date('2026-04-02') },
          { id: 'invoice-1', invoiceDate: new Date('2026-04-01') },
        ]),
      },
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._renderInvoiceHtml = jest.fn((invoice: any) => `<html>${invoice.id}</html>`);

    const html = await service.generateBillBook(
      { invoiceIds: ['invoice-2', 'invoice-1', 'invoice-2'] },
      organizationId,
    );

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['invoice-2', 'invoice-1'] },
        organizationId,
        deletedAt: null,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      include: expect.any(Object),
      orderBy: [{ invoiceDate: 'asc' }, { sequence: 'asc' }],
    });
    expect(service._renderInvoiceHtml.mock.calls.map(([invoice]: [any]) => invoice.id)).toEqual([
      'invoice-1',
      'invoice-2',
    ]);
    expect(html).toContain('Bill Book - 2 Bills');
  });

  it('loads and renders all filtered invoices with one full query per database batch', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `invoice-${index}`,
      invoiceDate: new Date('2026-04-01'),
    }));
    const prisma = {
      invoice: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(firstBatch)
          .mockResolvedValueOnce([{ id: 'invoice-100', invoiceDate: new Date('2026-04-02') }]),
      },
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    service._renderInvoiceHtml = jest.fn((invoice: any) => `<html>${invoice.id}</html>`);

    await service.generateBillBook(
      {
        search: 'MJ',
        status: 'PAID',
        dateFrom: '2026-04-01',
        dateTo: '2026-04-30',
      },
      organizationId,
    );

    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        skip: 0,
        take: 100,
        where: expect.objectContaining({
          organizationId,
          deletedAt: null,
          status: 'PAID',
        }),
      }),
    );
    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ skip: 100, take: 100 }),
    );
    expect(prisma.invoice.findMany).toHaveBeenCalledTimes(2);
    expect(service._renderInvoiceHtml).toHaveBeenCalledTimes(101);
  });

  it('rejects a bill book with no eligible invoices', async () => {
    const prisma = { invoice: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.generateBillBook({}, organizationId)).rejects.toThrow(BadRequestException);
  });

  it('does not export other statuses when filters request drafts', async () => {
    const prisma = { invoice: { findMany: jest.fn() } };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any);

    await expect(
      service.generateBillBook({ status: 'DRAFT' as any }, organizationId),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe('InvoicesService.findAll list query', () => {
  const buildListService = () => {
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new InvoicesService(prisma as any, {} as any, {} as any, {} as any) as any;
    return { prisma, service };
  };

  it('omits the company snapshot and caps page size when items are included', async () => {
    const { prisma, service } = buildListService();

    const result = await service.findAll({ includeItems: true, limit: 1000, page: 2 }, 'org-1');

    const args = prisma.invoice.findMany.mock.calls[0][0];
    expect(args.take).toBe(200);
    expect(args.skip).toBe(200);
    expect(args.select.companySnapshot).toBeUndefined();
    expect(args.select.organizationId).toBeUndefined();
    expect(args.select.buyerSnapshot).toBe(true);
    expect(args.select.items).toBeDefined();
    expect(args.where).toMatchObject({ organizationId: 'org-1', deletedAt: null });
    expect(result.meta.limit).toBe(200);
  });

  it('keeps the requested page size without items', async () => {
    const { prisma, service } = buildListService();

    await service.findAll({ limit: 500, page: 1 }, 'org-1');

    expect(prisma.invoice.findMany.mock.calls[0][0].take).toBe(500);
  });
});
