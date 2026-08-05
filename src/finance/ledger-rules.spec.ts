import { BadRequestException } from '@nestjs/common';
import { FinancialAccountType, FinancialTransactionType, PaymentMethod } from '@prisma/client';
import { buildManualMovements, isTreasuryPayment } from './ledger-rules';

const account = (id: string, type: FinancialAccountType) => ({ id, type });

describe('finance ledger rules', () => {
  it('excludes credit and old gold from treasury', () => {
    expect(isTreasuryPayment(PaymentMethod.CREDIT)).toBe(false);
    expect(isTreasuryPayment(PaymentMethod.OLD_GOLD)).toBe(false);
    expect(isTreasuryPayment(PaymentMethod.CASH)).toBe(true);
    expect(isTreasuryPayment(PaymentMethod.UPI)).toBe(true);
  });

  it('moves cash to bank with opposite signed movements', () => {
    expect(
      buildManualMovements(FinancialTransactionType.CASH_BANK_TRANSFER, 100, {
        from: account('cash', FinancialAccountType.CASH),
        to: account('bank', FinancialAccountType.BANK),
      }),
    ).toEqual([
      { accountId: 'cash', amount: -100 },
      { accountId: 'bank', amount: 100 },
    ]);
  });

  it('moves bank to cash with opposite signed movements', () => {
    expect(
      buildManualMovements(FinancialTransactionType.CASH_BANK_TRANSFER, 75, {
        from: account('bank', FinancialAccountType.BANK),
        to: account('cash', FinancialAccountType.CASH),
      }),
    ).toEqual([
      { accountId: 'bank', amount: -75 },
      { accountId: 'cash', amount: 75 },
    ]);
  });

  it('moves bank to bank with opposite signed movements', () => {
    expect(
      buildManualMovements(FinancialTransactionType.BANK_BANK_TRANSFER, 40, {
        from: account('hdfc', FinancialAccountType.BANK),
        to: account('sbi', FinancialAccountType.BANK),
      }),
    ).toEqual([
      { accountId: 'hdfc', amount: -40 },
      { accountId: 'sbi', amount: 40 },
    ]);
  });

  it('rejects identical transfer accounts', () => {
    expect(() =>
      buildManualMovements(FinancialTransactionType.BANK_BANK_TRANSFER, 10, {
        from: account('bank', FinancialAccountType.BANK),
        to: account('bank', FinancialAccountType.BANK),
      }),
    ).toThrow(BadRequestException);
  });

  it('records money in and money out as signed adjustments', () => {
    expect(
      buildManualMovements(FinancialTransactionType.ADJUSTMENT, 12.5, {
        account: account('cash', FinancialAccountType.CASH),
      }),
    ).toEqual([{ accountId: 'cash', amount: 12.5 }]);
    expect(
      buildManualMovements(FinancialTransactionType.ADJUSTMENT, -12.5, {
        account: account('bank', FinancialAccountType.BANK),
      }),
    ).toEqual([{ accountId: 'bank', amount: -12.5 }]);
  });

  it('rejects legacy manual types that are no longer supported', () => {
    expect(() =>
      buildManualMovements(
        FinancialTransactionType.OPENING_BALANCE as FinancialTransactionType,
        10,
        {
          account: account('cash', FinancialAccountType.CASH),
        },
      ),
    ).toThrow(BadRequestException);
  });
});
