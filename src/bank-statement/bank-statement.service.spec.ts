import { BadRequestException } from '@nestjs/common';
import { BankStatementLineStatus } from '@prisma/client';
import { BankStatementService } from './bank-statement.service';

describe('BankStatementService reconcile cleanup', () => {
  const line = {
    id: 'line-1',
    organizationId: 'org-1',
    status: BankStatementLineStatus.MATCHED,
    invoicePaymentId: 'pay-1',
    matchedInvoiceId: 'inv-1',
  };

  const makeService = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      bankStatementLine: {
        findFirst: jest.fn().mockResolvedValue(line),
        findMany: jest.fn().mockResolvedValue([line]),
        update: jest.fn().mockResolvedValue(line),
        delete: jest.fn().mockResolvedValue(line),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      ...overrides,
    };
    return {
      service: new BankStatementService(
        prisma as any,
        { reverseTransaction: jest.fn() } as any,
        {} as any,
      ),
      prisma,
    };
  };

  it('unlinks matched statement credits', async () => {
    const { service, prisma } = makeService();
    await service.unmatch('line-1', { organizationId: 'org-1' } as any);
    expect(prisma.bankStatementLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: {
        status: BankStatementLineStatus.UNMATCHED,
        matchedInvoiceId: null,
        invoicePaymentId: null,
        purchasePaymentId: null,
        financialTransactionId: null,
      },
    });
  });

  it('does not reverse a treasury entry that was only matched, not created from the line', async () => {
    const matchedTreasury = {
      ...line,
      invoicePaymentId: null,
      matchedInvoiceId: null,
      financialTransactionId: 'tx-existing',
    };
    const reverseTransaction = jest.fn();
    const prisma = {
      bankStatementLine: {
        findFirst: jest.fn().mockResolvedValue(matchedTreasury),
        update: jest.fn().mockResolvedValue(matchedTreasury),
      },
      financialTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new BankStatementService(
      prisma as any,
      { reverseTransaction } as any,
      {} as any,
    );
    await service.unmatch('line-1', { organizationId: 'org-1' } as any);
    expect(reverseTransaction).not.toHaveBeenCalled();
  });

  it('reverses a treasury entry created from the statement line', async () => {
    const created = {
      ...line,
      invoicePaymentId: null,
      matchedInvoiceId: null,
      financialTransactionId: 'tx-created',
    };
    const reverseTransaction = jest.fn();
    const prisma = {
      bankStatementLine: {
        findFirst: jest.fn().mockResolvedValue(created),
        update: jest.fn().mockResolvedValue(created),
      },
      financialTransaction: { findFirst: jest.fn().mockResolvedValue({ id: 'tx-created' }) },
    };
    const service = new BankStatementService(
      prisma as any,
      { reverseTransaction } as any,
      {} as any,
    );
    await service.unmatch('line-1', { organizationId: 'org-1', userId: 'u1' } as any);
    expect(reverseTransaction).toHaveBeenCalledWith(
      'tx-created',
      expect.objectContaining({ organizationId: 'org-1' }),
    );
  });

  it('rejects deleting matched lines without unlinking first', async () => {
    const { service } = makeService();
    await expect(
      service.deleteLine('line-1', { organizationId: 'org-1' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes unmatched statement lines', async () => {
    const unmatched = { ...line, status: BankStatementLineStatus.UNMATCHED };
    const { service, prisma } = makeService();
    prisma.bankStatementLine.findMany.mockResolvedValue([unmatched]);
    await service.deleteLine('line-1', { organizationId: 'org-1' } as any);
    expect(prisma.bankStatementLine.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        id: { in: ['line-1'] },
        status: { not: BankStatementLineStatus.MATCHED },
      },
    });
  });

  it('deletes many unmatched lines in one query', async () => {
    const unmatched = { ...line, status: BankStatementLineStatus.UNMATCHED };
    const { service, prisma } = makeService();
    prisma.bankStatementLine.findMany.mockResolvedValue([
      { ...unmatched, id: 'line-1' },
      { ...unmatched, id: 'line-2' },
    ]);
    prisma.bankStatementLine.deleteMany.mockResolvedValue({ count: 2 });
    const result = await service.deleteLines(['line-1', 'line-2'], {
      organizationId: 'org-1',
    } as any);
    expect(result.count).toBe(2);
    expect(prisma.bankStatementLine.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('BankStatementService.confirmMatchMany', () => {
  const paidAt = new Date('2026-07-20T00:00:00.000Z');
  const user = { organizationId: 'org-1', userId: 'u1' } as any;

  const unmatchedLine = (id: string, credit: number, overrides: Record<string, unknown> = {}) => ({
    id,
    organizationId: 'org-1',
    accountId: 'bank-a',
    status: BankStatementLineStatus.UNMATCHED,
    credit,
    txnDate: paidAt,
    ...overrides,
  });

  const makeMatchPrisma = (
    lines: ReturnType<typeof unmatchedLine>[],
    paymentOverrides: Record<string, unknown> = {},
  ) => {
    const payment = {
      id: 'pay-1',
      organizationId: 'org-1',
      invoiceId: 'inv-1',
      accountId: 'bank-a',
      mode: 'UPI',
      amount: 50000,
      paidAt,
      notes: null,
      invoice: { id: 'inv-1', invoiceNumber: 'INV-1', status: 'PAID' },
      ...paymentOverrides,
    };
    const prisma = {
      bankStatementLine: {
        findMany: jest.fn().mockResolvedValue(lines),
        aggregate: jest.fn().mockResolvedValue({ _sum: { credit: 0 } }),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ ...lines.find((l) => l.id === where.id), ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: lines.length }),
      },
      invoicePayment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    return { prisma, payment };
  };

  it('rejects linking a payment booked to a different bank account', async () => {
    const { prisma } = makeMatchPrisma([unmatchedLine('line-1', 100)], {
      accountId: 'bank-b',
      amount: 100,
    });
    const service = new BankStatementService(prisma as any, {} as any, {} as any);
    await expect(service.confirmMatch('line-1', 'pay-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects credits on a different calendar day than payment.paidAt', async () => {
    const { prisma } = makeMatchPrisma([
      unmatchedLine('line-1', 10000, { txnDate: new Date('2026-07-21T00:00:00.000Z') }),
    ]);
    const service = new BankStatementService(prisma as any, {} as any, {} as any);
    await expect(service.confirmMatchMany(['line-1'], 'pay-1', user)).rejects.toThrow(
      /same calendar day/i,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when selected credits exceed remaining capacity beyond ₹1', async () => {
    const { prisma } = makeMatchPrisma(
      [unmatchedLine('line-1', 10000), unmatchedLine('line-2', 20000)],
      { amount: 50000 },
    );
    prisma.bankStatementLine.aggregate.mockResolvedValue({ _sum: { credit: 40000 } });
    const service = new BankStatementService(prisma as any, {} as any, {} as any);
    await expect(service.confirmMatchMany(['line-1', 'line-2'], 'pay-1', user)).rejects.toThrow(
      /exceed remaining payment capacity/i,
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.bankStatementLine.updateMany).not.toHaveBeenCalled();
  });

  it('upserts Treasury once with the full booked payment amount for split credits', async () => {
    const lines = [
      unmatchedLine('line-1', 10000),
      unmatchedLine('line-2', 20000),
      unmatchedLine('line-3', 20000),
    ];
    const { prisma, payment } = makeMatchPrisma(lines, { amount: 50000 });
    const financeService = {
      syncAutomaticPayment: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BankStatementService(prisma as any, financeService as any, {} as any);

    const result = await service.confirmMatchMany(['line-1', 'line-2', 'line-3'], 'pay-1', user);

    expect(financeService.syncAutomaticPayment).toHaveBeenCalledTimes(1);
    expect(prisma.bankStatementLine.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.bankStatementLine.update).not.toHaveBeenCalled();
    expect(financeService.syncAutomaticPayment).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        sourceType: 'INVOICE_PAYMENT',
        sourceId: payment.id,
        amount: payment.amount,
      }),
    );
    expect(result.payment).toMatchObject({
      linkedCredits: 50000,
      remaining: 0,
      complete: true,
    });
  });
});

describe('BankStatementService.listInbox', () => {
  it('loads unmatched, payments, and matched in one pass without scanning every linked row', async () => {
    const prisma = {
      bankStatementLine: {
        findMany: jest
          .fn()
          .mockImplementation(
            async ({
              where,
            }: {
              where: { status?: string; debit?: unknown; credit?: unknown };
            }) => {
              if (where.status === BankStatementLineStatus.UNMATCHED) return [];
              return [];
            },
          ),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      invoicePayment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      purchasePayment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      financialTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ledgerEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new BankStatementService(prisma as any, {} as any, {} as any);
    const result = await service.listInbox('org-1');
    expect(result).toEqual({
      unmatched: [],
      unmatchedDebits: [],
      payments: [],
      paymentsOut: [],
      matched: [],
      matchedDebits: [],
    });
    expect(prisma.bankStatementLine.groupBy).toHaveBeenCalledTimes(5);
    expect(prisma.invoicePayment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.purchasePayment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.financialTransaction.findMany).toHaveBeenCalledTimes(3);
  });
});

describe('BankStatementService treasury match', () => {
  const txnDate = new Date('2026-07-20T00:00:00.000Z');
  const user = { organizationId: 'org-1', userId: 'u1' } as any;
  const line = {
    id: 'line-1',
    organizationId: 'org-1',
    accountId: 'bank-a',
    status: BankStatementLineStatus.UNMATCHED,
    credit: 10000,
    txnDate,
    narration: 'NEFT/AXIS BANK LOAN DISB',
    refNumber: 'HDFC123',
  };

  const makePrisma = (transaction: Record<string, unknown>) => {
    const prisma = {
      bankStatementLine: {
        findFirst: jest.fn().mockResolvedValue(line),
        findFirstOrThrow: jest.fn().mockResolvedValue(line),
        findMany: jest.fn().mockResolvedValue([line]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { credit: 0 } }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...line, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoicePayment: { findFirst: jest.fn().mockResolvedValue(null) },
      financialTransaction: { findFirst: jest.fn().mockResolvedValue(transaction) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    return prisma;
  };

  it('links a same-day loan money-in without posting another treasury row', async () => {
    const prisma = makePrisma({
      id: 'tx-loan',
      type: 'ADJUSTMENT',
      description: 'Loan',
      occurredAt: txnDate,
      movements: [{ accountId: 'bank-a', amount: 10000, account: { type: 'BANK' } }],
    });
    const financeService = {
      syncAutomaticPayment: jest.fn(),
      createManualTransactionIn: jest.fn(),
    };
    const service = new BankStatementService(prisma as any, financeService as any, {} as any);
    const result = await service.confirmMatch('line-1', 'tx-loan', user, 'FINANCIAL_TRANSACTION');
    expect(financeService.syncAutomaticPayment).not.toHaveBeenCalled();
    expect(prisma.bankStatementLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BankStatementLineStatus.MATCHED,
          financialTransactionId: 'tx-loan',
        }),
      }),
    );
    expect(result.payment).toMatchObject({ kind: 'LOAN', remaining: 0, complete: true });
  });

  it('creates a loan from the statement credit and links it', async () => {
    const prisma = makePrisma({});
    const financeService = {
      createManualTransactionIn: jest.fn().mockResolvedValue({ id: 'tx-new' }),
    };
    const service = new BankStatementService(prisma as any, financeService as any, {} as any);
    const result = await service.createAndMatch('line-1', { kind: 'LOAN' }, user);
    expect(financeService.createManualTransactionIn).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'ADJUSTMENT',
        accountId: 'bank-a',
        amount: 10000,
        description: 'Loan — NEFT/AXIS BANK LOAN DISB',
        reference: 'HDFC123',
      }),
      user,
    );
    expect(prisma.bankStatementLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'line-1',
        organizationId: 'org-1',
        status: BankStatementLineStatus.UNMATCHED,
      },
      data: {
        status: BankStatementLineStatus.MATCHED,
        financialTransactionId: 'tx-new',
      },
    });
    expect(result.payment).toMatchObject({ kind: 'LOAN', remaining: 0, complete: true });
  });

  it('creates a loan from the statement debit and links it', async () => {
    const debitLine = {
      ...line,
      credit: 0,
      debit: 10000,
      narration: 'TPT-LOAN RETURN-AJAY SONI',
    };

    const prisma = {
      bankStatementLine: {
        findFirst: jest.fn().mockResolvedValue(debitLine),
        findFirstOrThrow: jest.fn().mockResolvedValue(debitLine),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };

    const financeService = {
      createManualTransactionIn: jest.fn().mockResolvedValue({ id: 'tx-new' }),
    };

    const service = new BankStatementService(prisma as any, financeService as any, {} as any);
    const result = await service.createAndMatch('line-1', { kind: 'LOAN' }, user);

    expect(financeService.createManualTransactionIn).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'ADJUSTMENT',
        accountId: 'bank-a',
        amount: -10000,
        description: `Loan — ${debitLine.narration}`,
        reference: 'HDFC123',
      }),
      user,
    );

    expect(prisma.bankStatementLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'line-1',
        organizationId: 'org-1',
        status: BankStatementLineStatus.UNMATCHED,
      },
      data: {
        status: BankStatementLineStatus.MATCHED,
        financialTransactionId: 'tx-new',
      },
    });

    expect(result.payment).toMatchObject({ kind: 'LOAN', remaining: 0, complete: true });
  });

  it('creates a money-out from the statement debit and links it', async () => {
    const debitLine = {
      ...line,
      credit: 0,
      debit: 900000,
      narration: 'SELF - CHQ PAID - SEMARIYA',
    };
    const prisma = {
      bankStatementLine: {
        findFirst: jest.fn().mockResolvedValue(debitLine),
        findFirstOrThrow: jest.fn().mockResolvedValue(debitLine),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const financeService = {
      createManualTransactionIn: jest.fn().mockResolvedValue({ id: 'tx-out' }),
    };
    const service = new BankStatementService(prisma as any, financeService as any, {} as any);
    const result = await service.createAndMatch('line-1', { kind: 'MONEY_OUT' }, user);
    expect(financeService.createManualTransactionIn).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'ADJUSTMENT',
        accountId: 'bank-a',
        amount: -900000,
        description: 'SELF - CHQ PAID - SEMARIYA',
      }),
      user,
    );
    expect(result.payment).toMatchObject({ kind: 'MONEY_OUT', remaining: 0, complete: true });
  });

  it('creates a cash deposit from default cash into the statement bank', async () => {
    const prisma = makePrisma({});
    const financeService = {
      ensureDefaultCash: jest.fn().mockResolvedValue({ id: 'cash-1' }),
      createManualTransactionIn: jest.fn().mockResolvedValue({ id: 'tx-dep' }),
    };
    const service = new BankStatementService(prisma as any, financeService as any, {} as any);
    await service.createAndMatch('line-1', { kind: 'CASH_DEPOSIT' }, user);
    expect(financeService.ensureDefaultCash).toHaveBeenCalled();
    expect(financeService.createManualTransactionIn).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'CASH_BANK_TRANSFER',
        fromAccountId: 'cash-1',
        toAccountId: 'bank-a',
        amount: 10000,
        description: 'NEFT/AXIS BANK LOAN DISB',
      }),
      user,
    );
  });

  it('creates a customer advance from the statement credit', async () => {
    const prisma = makePrisma({});
    prisma.financialTransaction = {
      findFirst: jest.fn().mockResolvedValue({ id: 'tx-adv' }),
      update: jest.fn().mockResolvedValue({ id: 'tx-adv' }),
    } as any;
    const advanceService = {
      receiveAdvanceIn: jest.fn().mockResolvedValue({
        transactionId: 'tx-adv',
        customerName: 'Ajay Soni',
      }),
    };
    const service = new BankStatementService(
      prisma as any,
      { createManualTransactionIn: jest.fn() } as any,
      advanceService as any,
    );
    const result = await service.createAndMatch(
      'line-1',
      { kind: 'ADVANCE', customerId: 'cust-1' },
      user,
    );
    expect(advanceService.receiveAdvanceIn).toHaveBeenCalledWith(
      prisma,
      'cust-1',
      expect.objectContaining({
        amount: 10000,
        notes: 'Advance — NEFT/AXIS BANK LOAN DISB',
      }),
      user,
    );
    expect(result.payment).toMatchObject({ kind: 'ADVANCE', remaining: 0, complete: true });
  });

  it('links a debit to a purchase payment', async () => {
    const debitLine = {
      ...line,
      credit: 0,
      debit: 5000,
      narration: 'NEFT/VENDOR PAYMENT',
    };
    const prisma = {
      bankStatementLine: {
        findMany: jest.fn().mockResolvedValue([debitLine]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { debit: 0 } }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(debitLine),
      },
      purchasePayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'pp-1',
          amount: 5000,
          mode: 'NEFT',
          paidAt: txnDate,
          accountId: null,
          notes: null,
          purchaseInvoiceId: 'pi-1',
          purchaseInvoice: {
            id: 'pi-1',
            invoiceNumber: 'PB-1',
            status: 'PAID',
            vendorName: 'Vendor',
          },
        }),
        update: jest.fn(),
      },
      invoicePayment: { findFirst: jest.fn().mockResolvedValue(null) },
      financialTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const financeService = { syncAutomaticPayment: jest.fn() };
    const service = new BankStatementService(prisma as any, financeService as any, {} as any);
    const result = await service.confirmMatch('line-1', 'pp-1', user, 'PURCHASE_PAYMENT');
    expect(prisma.bankStatementLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BankStatementLineStatus.MATCHED,
          purchasePaymentId: 'pp-1',
        }),
      }),
    );
    expect(result.payment).toMatchObject({ kind: 'PURCHASE', remaining: 0, complete: true });
  });
});
