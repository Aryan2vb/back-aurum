import { BadRequestException } from '@nestjs/common';
import { FinancialAccountType, FinancialTransactionType, PaymentMethod } from '@prisma/client';

export const IGNORED_TREASURY_METHODS = new Set<PaymentMethod>([
  PaymentMethod.CREDIT,
  PaymentMethod.OLD_GOLD,
]);

export function isTreasuryPayment(method: PaymentMethod): boolean {
  return !IGNORED_TREASURY_METHODS.has(method);
}

type AccountRef = { id: string; type: FinancialAccountType };
export type MovementDraft = { accountId: string; amount: number };

const isCashOrBank = (account: AccountRef | undefined): account is AccountRef =>
  Boolean(
    account &&
    (account.type === FinancialAccountType.CASH || account.type === FinancialAccountType.BANK),
  );

function buildPairedTransfer(from?: AccountRef, to?: AccountRef, amount = 0): MovementDraft[] {
  if (!isCashOrBank(from) || !isCashOrBank(to)) {
    throw new BadRequestException('Transfers require cash or bank accounts');
  }
  if (from.id === to.id) {
    throw new BadRequestException('Transfer accounts must be different');
  }
  const positive = Math.abs(amount);
  return [
    { accountId: from.id, amount: -positive },
    { accountId: to.id, amount: positive },
  ];
}

export function buildManualMovements(
  type: FinancialTransactionType,
  amount: number,
  accounts: { from?: AccountRef; to?: AccountRef; account?: AccountRef },
): MovementDraft[] {
  if (!Number.isFinite(amount) || amount === 0) {
    throw new BadRequestException('Amount must be non-zero');
  }

  switch (type) {
    case FinancialTransactionType.CASH_BANK_TRANSFER:
    case FinancialTransactionType.BANK_BANK_TRANSFER:
      return buildPairedTransfer(accounts.from, accounts.to, amount);
    case FinancialTransactionType.ADJUSTMENT: {
      if (!isCashOrBank(accounts.account)) {
        throw new BadRequestException('accountId must be a cash or bank account');
      }
      return [{ accountId: accounts.account.id, amount }];
    }
    default:
      throw new BadRequestException('This transaction type cannot be entered manually');
  }
}
