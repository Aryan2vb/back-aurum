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
    return { service: new BankStatementService(prisma as any), prisma };
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
      },
    });
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
      where: { organizationId: 'org-1', id: { in: ['line-1'] } },
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

  const makeMatchPrisma = (lines: ReturnType<typeof unmatchedLine>[], paymentOverrides: Record<string, unknown> = {}) => {
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
        update: jest.fn().mockImplementation(({ where, data }) =>
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
    const { prisma } = makeMatchPrisma([unmatchedLine('line-1', 100)], { accountId: 'bank-b', amount: 100 });
    const service = new BankStatementService(prisma as any);
    await expect(service.confirmMatch('line-1', 'pay-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects credits on a different calendar day than payment.paidAt', async () => {
    const { prisma } = makeMatchPrisma([
      unmatchedLine('line-1', 10000, { txnDate: new Date('2026-07-21T00:00:00.000Z') }),
    ]);
    const service = new BankStatementService(prisma as any);
    await expect(
      service.confirmMatchMany(['line-1'], 'pay-1', user),
    ).rejects.toThrow(/same calendar day/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when selected credits exceed remaining capacity beyond ₹1', async () => {
    const { prisma } = makeMatchPrisma(
      [unmatchedLine('line-1', 10000), unmatchedLine('line-2', 20000)],
      { amount: 50000 },
    );
    prisma.bankStatementLine.aggregate.mockResolvedValue({ _sum: { credit: 40000 } });
    const service = new BankStatementService(prisma as any);
    await expect(
      service.confirmMatchMany(['line-1', 'line-2'], 'pay-1', user),
    ).rejects.toThrow(/exceed remaining payment capacity/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
    const service = new BankStatementService(prisma as any, financeService as any);

    const result = await service.confirmMatchMany(
      ['line-1', 'line-2', 'line-3'],
      'pay-1',
      user,
    );

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
        findMany: jest.fn().mockImplementation(async ({ where }: { where: { status?: string } }) => {
          if (where.status === BankStatementLineStatus.UNMATCHED) return [];
          return [];
        }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      invoicePayment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new BankStatementService(prisma as any);
    const result = await service.listInbox('org-1');
    expect(result).toEqual({ unmatched: [], payments: [], matched: [] });
    expect(prisma.bankStatementLine.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.invoicePayment.findMany).toHaveBeenCalledTimes(1);
  });
});
