import { FinancialAccountType, FinancialTransactionType, PaymentMethod } from '@prisma/client';
import { FinanceService } from './finance.service';

describe('FinanceService automatic posting', () => {
  const transaction = { id: 'txn-1' };
  const makeDb = () =>
    ({
      financialAccount: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      financialTransaction: {
        upsert: jest.fn().mockResolvedValue(transaction),
        findUnique: jest.fn(),
      },
      financialMovement: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'movement-1' }),
      },
    }) as any;

  it('requires an explicit bank account for a non-cash payment', async () => {
    const service = new FinanceService({} as any);
    const db = makeDb();

    await expect(service.resolvePaymentAccount(db, 'org-1', PaymentMethod.UPI)).rejects.toThrow(
      'accountId is required',
    );
  });

  it('posts cash receipts to the default cash account', async () => {
    const service = new FinanceService({} as any);
    const db = makeDb();
    db.financialAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      type: FinancialAccountType.CASH,
    });

    await service.syncAutomaticPayment(db, {
      organizationId: 'org-1',
      sourceType: 'INVOICE_PAYMENT',
      sourceId: 'payment-1',
      sourceParentType: 'INVOICE',
      sourceParentId: 'invoice-1',
      transactionType: FinancialTransactionType.SALE_RECEIPT,
      paymentMethod: PaymentMethod.CASH,
      amount: 500,
      occurredAt: new Date('2026-07-21'),
    });

    expect(db.financialTransaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_sourceType_sourceId: {
            organizationId: 'org-1',
            sourceType: 'INVOICE_PAYMENT',
            sourceId: 'payment-1',
          },
        },
      }),
    );
    const movement = db.financialMovement.create.mock.calls[0][0].data;
    expect(movement.accountId).toBe('cash-1');
    expect(Number(movement.amount)).toBe(500);
  });

  it('ignores zero-value payment placeholders', async () => {
    const service = new FinanceService({} as any);
    const db = makeDb();
    db.financialAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      type: FinancialAccountType.CASH,
    });

    await service.syncAutomaticPayment(db, {
      organizationId: 'org-1',
      sourceType: 'INVOICE_PAYMENT',
      sourceId: 'payment-0',
      sourceParentType: 'INVOICE',
      sourceParentId: 'invoice-1',
      transactionType: FinancialTransactionType.SALE_RECEIPT,
      paymentMethod: PaymentMethod.CASH,
      amount: 0,
      occurredAt: new Date('2026-07-21'),
    });

    expect(db.financialTransaction.upsert).not.toHaveBeenCalled();
    expect(db.financialMovement.create).not.toHaveBeenCalled();
  });

  it('posts purchase payments and advance refunds as outflows', async () => {
    const service = new FinanceService({} as any);
    const db = makeDb();
    db.financialAccount.findFirst.mockResolvedValue({
      id: 'bank-1',
      type: FinancialAccountType.BANK,
    });

    for (const transactionType of [
      FinancialTransactionType.PURCHASE_PAYMENT,
      FinancialTransactionType.ADVANCE_REFUND,
    ]) {
      await service.syncAutomaticPayment(db, {
        organizationId: 'org-1',
        sourceType: transactionType,
        sourceId: transactionType,
        sourceParentType: 'SOURCE',
        sourceParentId: 'source-1',
        transactionType,
        paymentMethod: PaymentMethod.UPI,
        accountId: 'bank-1',
        amount: 125,
        occurredAt: new Date('2026-07-21'),
      });
    }

    expect(
      db.financialMovement.create.mock.calls.map(([call]: any[]) => ({
        accountId: call.data.accountId,
        amount: Number(call.data.amount),
      })),
    ).toEqual([
      { accountId: 'bank-1', amount: -125 },
      { accountId: 'bank-1', amount: -125 },
    ]);
  });
});
