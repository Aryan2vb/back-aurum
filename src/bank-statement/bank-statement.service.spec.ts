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
        update: jest.fn().mockResolvedValue(line),
        delete: jest.fn().mockResolvedValue(line),
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
    const { service, prisma } = makeService();
    prisma.bankStatementLine.findFirst.mockResolvedValue({
      ...line,
      status: BankStatementLineStatus.UNMATCHED,
    });
    await service.deleteLine('line-1', { organizationId: 'org-1' } as any);
    expect(prisma.bankStatementLine.delete).toHaveBeenCalledWith({ where: { id: 'line-1' } });
  });
});

describe('BankStatementService.confirmMatch', () => {
  it('rejects linking a payment booked to a different bank account', async () => {
    const prisma = {
      bankStatementLine: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'line-1',
            organizationId: 'org-1',
            accountId: 'bank-a',
            status: BankStatementLineStatus.UNMATCHED,
            credit: 100,
          })
          .mockResolvedValueOnce(null),
      },
      invoicePayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'pay-1',
          organizationId: 'org-1',
          invoiceId: 'inv-1',
          accountId: 'bank-b',
          mode: 'UPI',
          amount: 100,
          paidAt: new Date(),
          invoice: { invoiceNumber: 'INV-1' },
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new BankStatementService(prisma as any);
    await expect(
      service.confirmMatch('line-1', 'pay-1', { organizationId: 'org-1', userId: 'u1' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
