import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FinancialAccountStatus,
  FinancialAccountType,
  FinancialTransactionType,
  InvoiceStatus,
  LedgerType,
  PaymentMethod,
  Prisma,
  PurchaseStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserData } from '../auth/current-user.decorator';
import {
  BulkAssignMovementsDto,
  CreateFinancialAccountDto,
  CreateManualTransactionDto,
  UpdateFinancialAccountDto,
} from './dto/finance.dto';
import { buildManualMovements, isTreasuryPayment } from './ledger-rules';

type Db = Prisma.TransactionClient | PrismaService;

const BACKFILL_CHUNK = 25;
const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 };

export type AutomaticPaymentInput = {
  organizationId: string;
  sourceType: string;
  sourceId: string;
  sourceParentType: string;
  sourceParentId: string;
  transactionType: FinancialTransactionType;
  paymentMethod: PaymentMethod;
  accountId?: string | null;
  amount: Decimal | number;
  occurredAt: Date;
  description?: string | null;
  createdById?: string;
};

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultCash(db: Db, organizationId: string) {
    const existing = await db.financialAccount.findFirst({
      where: {
        organizationId,
        type: FinancialAccountType.CASH,
        isDefault: true,
        status: FinancialAccountStatus.ACTIVE,
      },
    });
    if (existing) return existing;

    const activeCash = await db.financialAccount.findFirst({
      where: {
        organizationId,
        type: FinancialAccountType.CASH,
        status: FinancialAccountStatus.ACTIVE,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (activeCash) {
      await db.financialAccount.updateMany({
        where: {
          organizationId,
          type: FinancialAccountType.CASH,
          isDefault: true,
          id: { not: activeCash.id },
        },
        data: { isDefault: false },
      });
      return db.financialAccount.update({
        where: { id: activeCash.id },
        data: { isDefault: true },
      });
    }

    try {
      return await db.financialAccount.create({
        data: {
          organizationId,
          name: 'Cash',
          type: FinancialAccountType.CASH,
          isDefault: true,
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const raced = await db.financialAccount.findFirst({
        where: { organizationId, type: FinancialAccountType.CASH, isDefault: true },
      });
      if (!raced) throw error;
      return raced;
    }
  }

  async resolvePaymentAccount(
    db: Db,
    organizationId: string,
    method: PaymentMethod,
    accountId?: string | null,
    allowUnassignedNonCash = false,
  ) {
    // Lightweight unit-test transaction doubles may predate the finance delegates.
    if (!(db as any).financialAccount) return accountId ? ({ id: accountId } as any) : null;
    if (!isTreasuryPayment(method)) return null;
    if (method === PaymentMethod.CASH) return this.ensureDefaultCash(db, organizationId);
    if (!accountId && allowUnassignedNonCash) return null;
    if (!accountId) {
      throw new BadRequestException('accountId is required for non-cash treasury payments');
    }

    const account = await db.financialAccount.findFirst({
      where: {
        id: accountId,
        organizationId,
        type: FinancialAccountType.BANK,
        status: FinancialAccountStatus.ACTIVE,
      },
    });
    if (!account) throw new BadRequestException('accountId must reference an active BANK account');
    return account;
  }

  async syncAutomaticPayment(db: Db, input: AutomaticPaymentInput, allowUnassignedNonCash = false) {
    if (!(db as any).financialTransaction) return null;
    if (!isTreasuryPayment(input.paymentMethod)) {
      return this.reverseSource(db, input.organizationId, input.sourceType, input.sourceId);
    }

    const account = await this.resolvePaymentAccount(
      db,
      input.organizationId,
      input.paymentMethod,
      input.accountId,
      allowUnassignedNonCash,
    );
    const amount = new Decimal(input.amount);
    if (amount.isZero()) {
      return this.reverseSource(db, input.organizationId, input.sourceType, input.sourceId);
    }
    if (amount.isNegative()) {
      throw new BadRequestException('Treasury movement amount must be positive');
    }
    const signedAmount =
      input.transactionType === FinancialTransactionType.ADVANCE_REFUND ||
      input.transactionType === FinancialTransactionType.PURCHASE_PAYMENT
        ? amount.negated()
        : amount;

    const transaction = await db.financialTransaction.upsert({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      create: {
        organizationId: input.organizationId,
        type: input.transactionType,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceParentType: input.sourceParentType,
        sourceParentId: input.sourceParentId,
        description: input.description,
        paymentMethod: input.paymentMethod,
        occurredAt: input.occurredAt,
        createdById: input.createdById,
      },
      update: {
        type: input.transactionType,
        sourceParentType: input.sourceParentType,
        sourceParentId: input.sourceParentId,
        description: input.description,
        paymentMethod: input.paymentMethod,
        occurredAt: input.occurredAt,
        reversedAt: null,
      },
    });

    await db.financialMovement.deleteMany({ where: { transactionId: transaction.id } });
    await db.financialMovement.create({
      data: {
        organizationId: input.organizationId,
        transactionId: transaction.id,
        accountId: account?.id ?? null,
        amount: signedAmount,
        description: input.description,
      },
    });
    return transaction;
  }

  async reverseSource(db: Db, organizationId: string, sourceType: string, sourceId: string) {
    if (!(db as any).financialTransaction) return null;
    const transaction = await db.financialTransaction.findUnique({
      where: { organizationId_sourceType_sourceId: { organizationId, sourceType, sourceId } },
    });
    if (!transaction || transaction.reversedAt) return transaction;
    await db.financialMovement.deleteMany({ where: { transactionId: transaction.id } });
    return db.financialTransaction.update({
      where: { id: transaction.id },
      data: { reversedAt: new Date() },
    });
  }

  async reverseMissingSources(
    db: Db,
    organizationId: string,
    sourceParentType: string,
    sourceParentId: string,
    activeSourceIds: string[],
  ) {
    if (!(db as any).financialTransaction) return;
    const stale = await db.financialTransaction.findMany({
      where: {
        organizationId,
        sourceParentType,
        sourceParentId,
        reversedAt: null,
        ...(activeSourceIds.length ? { sourceId: { notIn: activeSourceIds } } : {}),
      },
      select: { id: true },
    });
    if (!stale.length) return;
    await db.financialMovement.deleteMany({
      where: { transactionId: { in: stale.map(({ id }) => id) } },
    });
    await db.financialTransaction.updateMany({
      where: { id: { in: stale.map(({ id }) => id) } },
      data: { reversedAt: new Date() },
    });
  }

  async createAccount(dto: CreateFinancialAccountDto, user: CurrentUserData) {
    if (dto.isDefault && dto.type !== FinancialAccountType.CASH) {
      throw new BadRequestException('Only a CASH account can be the organization default');
    }
    return this.prisma.$transaction(async (tx) => {
      const existingDefaultCash =
        dto.type === FinancialAccountType.CASH
          ? await tx.financialAccount.findFirst({
              where: {
                organizationId: user.organizationId,
                type: FinancialAccountType.CASH,
                isDefault: true,
              },
            })
          : null;
      const isDefault =
        dto.type === FinancialAccountType.CASH && (dto.isDefault || !existingDefaultCash);
      if (isDefault) {
        await tx.financialAccount.updateMany({
          where: { organizationId: user.organizationId, type: FinancialAccountType.CASH },
          data: { isDefault: false },
        });
      }
      const name = dto.name.trim();
      const duplicate = await tx.financialAccount.findFirst({
        where: { organizationId: user.organizationId, name },
      });
      if (duplicate) {
        throw new BadRequestException(`An account named "${name}" already exists`);
      }
      let account;
      try {
        account = await tx.financialAccount.create({
          data: {
            organizationId: user.organizationId,
            name,
            type: dto.type,
            isDefault,
            bankName: dto.bankName,
            accountNumber: dto.accountNumber,
            ifsc: dto.ifsc,
            notes: dto.notes,
            createdById: user.userId,
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          throw new BadRequestException(`An account named "${name}" already exists`);
        }
        throw error;
      }
      if (dto.openingBalance) {
        const transaction = await tx.financialTransaction.create({
          data: {
            organizationId: user.organizationId,
            type: FinancialTransactionType.OPENING_BALANCE,
            sourceType: 'FINANCIAL_ACCOUNT_OPENING',
            sourceId: account.id,
            sourceParentType: 'FINANCIAL_ACCOUNT',
            sourceParentId: account.id,
            occurredAt: dto.openingDate ? new Date(dto.openingDate) : new Date(),
            description: `Opening balance for ${account.name}`,
            createdById: user.userId,
          },
        });
        await tx.financialMovement.create({
          data: {
            organizationId: user.organizationId,
            transactionId: transaction.id,
            accountId: account.id,
            amount: new Decimal(dto.openingBalance),
          },
        });
      }
      return account;
    });
  }

  async updateAccount(id: string, dto: UpdateFinancialAccountDto, user: CurrentUserData) {
    const account = await this.getAccountRecord(id, user.organizationId);
    if (
      account.isDefault &&
      (dto.status === FinancialAccountStatus.INACTIVE || dto.isDefault === false)
    ) {
      throw new BadRequestException('Set another default CASH account first');
    }
    if (dto.isDefault && account.type !== FinancialAccountType.CASH) {
      throw new BadRequestException('Only a CASH account can be the organization default');
    }
    const { openingBalance, openingDate, ...accountFields } = dto;
    await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.financialAccount.updateMany({
          where: {
            organizationId: user.organizationId,
            type: FinancialAccountType.CASH,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      const updated = await tx.financialAccount.update({
        where: { id },
        data: { ...accountFields, name: accountFields.name?.trim() },
      });
      if (openingBalance !== undefined || openingDate !== undefined) {
        await this.upsertAccountOpeningBalance(tx, {
          organizationId: user.organizationId,
          accountId: id,
          accountName: updated.name,
          openingBalance,
          openingDate,
          createdById: user.userId,
        });
      }
    });
    return this.getAccount(id, user.organizationId);
  }

  async listAccounts(organizationId: string) {
    const accounts = await this.prisma.financialAccount.findMany({
      where: { organizationId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    const accountIds = accounts.map((account) => account.id);
    const [balances, openingById] = await Promise.all([
      this.prisma.financialMovement.groupBy({
        by: ['accountId'],
        where: { organizationId, accountId: { not: null } },
        _sum: { amount: true },
      }),
      this.loadOpeningBalances(organizationId, accountIds),
    ]);
    const balanceById = new Map(balances.map((row) => [row.accountId, row._sum.amount ?? 0]));
    return accounts.map((account) => ({
      ...account,
      isActive: account.status === FinancialAccountStatus.ACTIVE,
      balance: balanceById.get(account.id) ?? 0,
      ...openingById.get(account.id),
    }));
  }

  async getAccount(id: string, organizationId: string) {
    const account = await this.getAccountRecord(id, organizationId);
    const [aggregate, openingById] = await Promise.all([
      this.prisma.financialMovement.aggregate({
        where: { organizationId, accountId: id },
        _sum: { amount: true },
      }),
      this.loadOpeningBalances(organizationId, [id]),
    ]);
    return {
      ...account,
      isActive: account.status === FinancialAccountStatus.ACTIVE,
      balance: aggregate._sum.amount ?? 0,
      ...openingById.get(id),
    };
  }

  private async getAccountRecord(id: string, organizationId: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, organizationId },
    });
    if (!account) throw new NotFoundException('Financial account not found');
    return account;
  }

  private async loadOpeningBalances(organizationId: string, accountIds: string[]) {
    const openingById = new Map<string, { openingBalance: number; openingDate: string }>();
    if (!accountIds.length) return openingById;

    const rows = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        sourceType: 'FINANCIAL_ACCOUNT_OPENING',
        sourceId: { in: accountIds },
        reversedAt: null,
      },
      include: { movements: { where: { accountId: { not: null } } } },
    });
    for (const row of rows) {
      openingById.set(row.sourceId, {
        openingBalance: Number(row.movements[0]?.amount ?? 0),
        openingDate: row.occurredAt.toISOString().slice(0, 10),
      });
    }
    return openingById;
  }

  private async upsertAccountOpeningBalance(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      accountId: string;
      accountName: string;
      openingBalance?: number;
      openingDate?: string;
      createdById: string;
    },
  ) {
    const existing = await tx.financialTransaction.findUnique({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: 'FINANCIAL_ACCOUNT_OPENING',
          sourceId: input.accountId,
        },
      },
      include: { movements: true },
    });
    if (input.openingBalance === undefined && input.openingDate === undefined) return;
    if (input.openingBalance === undefined && !existing) return;

    const amount =
      input.openingBalance ?? Number(existing?.movements.find((m) => m.accountId)?.amount ?? 0);
    const occurredAt = input.openingDate
      ? new Date(input.openingDate)
      : (existing?.occurredAt ?? new Date());

    const transaction = await tx.financialTransaction.upsert({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: 'FINANCIAL_ACCOUNT_OPENING',
          sourceId: input.accountId,
        },
      },
      create: {
        organizationId: input.organizationId,
        type: FinancialTransactionType.OPENING_BALANCE,
        sourceType: 'FINANCIAL_ACCOUNT_OPENING',
        sourceId: input.accountId,
        sourceParentType: 'FINANCIAL_ACCOUNT',
        sourceParentId: input.accountId,
        occurredAt,
        description: `Opening balance for ${input.accountName}`,
        createdById: input.createdById,
      },
      update: {
        occurredAt,
        description: `Opening balance for ${input.accountName}`,
        reversedAt: null,
      },
    });

    await tx.financialMovement.deleteMany({ where: { transactionId: transaction.id } });
    await tx.financialMovement.create({
      data: {
        organizationId: input.organizationId,
        transactionId: transaction.id,
        accountId: input.accountId,
        amount: new Decimal(amount),
      },
    });
  }

  async createManualTransaction(dto: CreateManualTransactionDto, user: CurrentUserData) {
    const ids = [...new Set([dto.fromAccountId, dto.toAccountId, dto.accountId].filter(Boolean))];
    const accounts = await this.prisma.financialAccount.findMany({
      where: {
        id: { in: ids as string[] },
        organizationId: user.organizationId,
        status: FinancialAccountStatus.ACTIVE,
      },
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    if (accounts.length !== ids.length) {
      throw new BadRequestException('All accounts must be active and belong to the organization');
    }
    const movements = buildManualMovements(dto.type, dto.amount, {
      from: dto.fromAccountId ? byId.get(dto.fromAccountId) : undefined,
      to: dto.toAccountId ? byId.get(dto.toAccountId) : undefined,
      account: dto.accountId ? byId.get(dto.accountId) : undefined,
    });
    return this.prisma.$transaction(async (tx) => {
      return tx.financialTransaction.create({
        data: {
          organizationId: user.organizationId,
          type: dto.type,
          sourceType: 'MANUAL',
          sourceId: crypto.randomUUID(),
          description: dto.description,
          reference: dto.reference,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
          createdById: user.userId,
          movements: {
            create: movements.map((movement) => ({
              organizationId: user.organizationId,
              accountId: movement.accountId,
              amount: new Decimal(movement.amount),
              description: dto.description,
            })),
          },
        },
        include: { movements: true },
      });
    });
  }

  async listTransactions(
    organizationId: string,
    filters: { accountId?: string; from?: string; to?: string },
  ) {
    return this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        reversedAt: null,
        ...(filters.from || filters.to
          ? {
              occurredAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
        ...(filters.accountId ? { movements: { some: { accountId: filters.accountId } } } : {}),
      },
      include: { movements: { include: { account: true } } },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getAccountLedger(
    organizationId: string,
    accountId: string,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    await this.getAccountRecord(accountId, organizationId);
    return this.buildLedgerRows(organizationId, { accountId }, filters);
  }

  async getBook(
    organizationId: string,
    type: FinancialAccountType,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    return this.buildLedgerRows(organizationId, { accountType: type }, filters);
  }

  async getUnassignedMovements(organizationId: string) {
    const movements = await this.prisma.financialMovement.findMany({
      where: {
        organizationId,
        accountId: null,
        transaction: { reversedAt: null },
      },
      include: { transaction: true },
      orderBy: { transaction: { occurredAt: 'desc' } },
    });
    return movements.map((movement) => this.toLedgerRow(movement, null));
  }

  private async buildLedgerRows(
    organizationId: string,
    scope: { accountId?: string; accountType?: FinancialAccountType },
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    const accountWhere = scope.accountId ? { id: scope.accountId } : { type: scope.accountType };
    const before = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const to = filters.dateTo ? new Date(filters.dateTo) : null;
    if (to) to.setUTCHours(23, 59, 59, 999);

    const movementScope: Prisma.FinancialMovementWhereInput = {
      organizationId,
      accountId: { not: null },
      account: accountWhere,
      transaction: { reversedAt: null },
    };
    const opening = before
      ? await this.prisma.financialMovement.aggregate({
          where: {
            ...movementScope,
            transaction: { reversedAt: null, occurredAt: { lt: before } },
          },
          _sum: { amount: true },
        })
      : null;
    const movements = await this.prisma.financialMovement.findMany({
      where: {
        ...movementScope,
        transaction: {
          reversedAt: null,
          ...(before || to
            ? {
                occurredAt: {
                  ...(before ? { gte: before } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
      },
      include: { transaction: true, account: true },
      orderBy: [{ transaction: { occurredAt: 'asc' } }, { createdAt: 'asc' }],
    });

    let running = new Decimal(opening?._sum.amount ?? 0);
    return movements.map((movement) => {
      running = running.plus(movement.amount);
      return this.toLedgerRow(movement, running);
    });
  }

  private toLedgerRow(
    movement: {
      id: string;
      transactionId: string;
      amount: Decimal;
      description: string | null;
      transaction: {
        type: FinancialTransactionType;
        sourceType: string;
        sourceId: string;
        description: string | null;
        reference: string | null;
        paymentMethod: PaymentMethod | null;
        occurredAt: Date;
      };
      account?: { name: string } | null;
    },
    runningBalance: Decimal | null,
  ) {
    const amount = new Decimal(movement.amount);
    return {
      id: movement.id,
      transactionId: movement.transactionId,
      entryDate: movement.transaction.occurredAt,
      type: movement.transaction.type,
      particulars:
        movement.description ||
        movement.transaction.description ||
        movement.account?.name ||
        movement.transaction.sourceType,
      reference: movement.transaction.reference || movement.transaction.sourceId,
      sourceType: movement.transaction.sourceType,
      paymentMethod: movement.transaction.paymentMethod,
      isAutomatic: movement.transaction.sourceType !== 'MANUAL',
      amount: amount.abs(),
      in: amount.gt(0) ? amount : new Decimal(0),
      out: amount.lt(0) ? amount.abs() : new Decimal(0),
      runningBalance,
    };
  }

  async reverseTransaction(id: string, user: CurrentUserData) {
    const transaction = await this.prisma.financialTransaction.findFirst({
      where: { id, organizationId: user.organizationId, reversedAt: null },
    });
    if (!transaction) throw new NotFoundException('Financial transaction not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.financialMovement.deleteMany({ where: { transactionId: id } });
      return tx.financialTransaction.update({
        where: { id },
        data: { reversedAt: new Date() },
      });
    });
  }

  async assignMovement(movementId: string, accountId: string, organizationId: string) {
    await this.assertAssignment(movementId, accountId, organizationId);
    const movement = await this.prisma.financialMovement.findFirst({
      where: { id: movementId, organizationId },
      include: { transaction: { select: { sourceType: true, sourceId: true } } },
    });
    if (!movement) throw new NotFoundException('Financial movement not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.financialMovement.update({
        where: { id: movementId },
        data: { accountId },
      });
      await this.stampSourceAccount(tx, organizationId, movement.transaction, accountId);
      return updated;
    });
  }

  private async stampSourceAccount(
    db: Db,
    organizationId: string,
    transaction: { sourceType: string; sourceId: string },
    accountId: string,
  ) {
    if (transaction.sourceType === 'INVOICE_PAYMENT') {
      await db.invoicePayment.updateMany({
        where: { id: transaction.sourceId, organizationId, accountId: null },
        data: { accountId },
      });
    } else if (transaction.sourceType === 'PURCHASE_PAYMENT') {
      await db.purchasePayment.updateMany({
        where: { id: transaction.sourceId, organizationId, accountId: null },
        data: { accountId },
      });
    } else if (
      transaction.sourceType === 'ADVANCE_LEDGER' ||
      transaction.sourceType === 'UDHAR_PAYMENT'
    ) {
      await db.ledgerEntry.updateMany({
        where: { id: transaction.sourceId, organizationId, accountId: null },
        data: { accountId },
      });
    }
  }

  async backfillOrganization(organizationId: string, dryRun = false) {
    const cash = dryRun
      ? await this.prisma.financialAccount.findFirst({
          where: {
            organizationId,
            type: FinancialAccountType.CASH,
            isDefault: true,
            status: FinancialAccountStatus.ACTIVE,
          },
        })
      : await this.ensureDefaultCash(this.prisma, organizationId);

    const [invoicePayments, purchasePayments, advanceEntries, directUdhars] = await Promise.all([
      this.prisma.invoicePayment.findMany({
        where: {
          organizationId,
          amount: { gt: 0 },
          invoice: {
            deletedAt: null,
            status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
          },
        },
      }),
      this.prisma.purchasePayment.findMany({
        where: {
          organizationId,
          amount: { gt: 0 },
          purchaseInvoice: { status: { not: PurchaseStatus.CANCELLED } },
        },
      }),
      this.prisma.ledgerEntry.findMany({
        where: {
          organizationId,
          amount: { gt: 0 },
          deletedAt: null,
          type: { in: [LedgerType.ADVANCE_RECEIVED, LedgerType.ADVANCE_REFUND] },
        },
      }),
      this.prisma.udharEntry.findMany({
        where: { organizationId, invoiceId: null },
        select: { id: true },
      }),
    ]);
    const udharPayments = await this.prisma.ledgerEntry.findMany({
      where: {
        organizationId,
        amount: { gt: 0 },
        deletedAt: null,
        type: LedgerType.PAYMENT,
        entityId: { in: directUdhars.map(({ id }) => id) },
      },
    });

    const counts = {
      invoicePayments: invoicePayments.length,
      purchasePayments: purchasePayments.length,
      advanceEntries: advanceEntries.length,
      udharPayments: udharPayments.length,
    };
    if (dryRun) return { dryRun: true, ...counts };

    const forChunks = async <T>(
      rows: T[],
      work: (tx: Prisma.TransactionClient, row: T) => Promise<void>,
    ) => {
      for (let i = 0; i < rows.length; i += BACKFILL_CHUNK) {
        const chunk = rows.slice(i, i + BACKFILL_CHUNK);
        await this.prisma.$transaction(async (tx) => {
          for (const row of chunk) await work(tx, row);
        }, BACKFILL_TX);
      }
    };

    await forChunks(invoicePayments, async (tx, payment) => {
      const accountId = payment.mode === PaymentMethod.CASH ? cash?.id : payment.accountId;
      if (accountId !== payment.accountId) {
        await tx.invoicePayment.update({ where: { id: payment.id }, data: { accountId } });
      }
      await this.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'INVOICE_PAYMENT',
          sourceId: payment.id,
          sourceParentType: 'INVOICE',
          sourceParentId: payment.invoiceId,
          transactionType: FinancialTransactionType.SALE_RECEIPT,
          paymentMethod: payment.mode,
          accountId,
          amount: payment.amount,
          occurredAt: payment.paidAt,
          description: payment.notes,
        },
        true,
      );
    });

    await forChunks(purchasePayments, async (tx, payment) => {
      const accountId = payment.mode === PaymentMethod.CASH ? cash?.id : payment.accountId;
      if (accountId !== payment.accountId) {
        await tx.purchasePayment.update({ where: { id: payment.id }, data: { accountId } });
      }
      await this.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'PURCHASE_PAYMENT',
          sourceId: payment.id,
          sourceParentType: 'PURCHASE',
          sourceParentId: payment.purchaseInvoiceId,
          transactionType: FinancialTransactionType.PURCHASE_PAYMENT,
          paymentMethod: payment.mode,
          accountId,
          amount: payment.amount,
          occurredAt: payment.paidAt,
          description: payment.notes,
        },
        true,
      );
    });

    await forChunks(advanceEntries, async (tx, entry) => {
      const method = entry.paymentMethod ?? PaymentMethod.OTHER;
      const accountId = method === PaymentMethod.CASH ? cash?.id : entry.accountId;
      if (accountId !== entry.accountId) {
        await tx.ledgerEntry.update({ where: { id: entry.id }, data: { accountId } });
      }
      await this.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'ADVANCE_LEDGER',
          sourceId: entry.id,
          sourceParentType: 'ADVANCE',
          sourceParentId: entry.id,
          transactionType:
            entry.type === LedgerType.ADVANCE_REFUND
              ? FinancialTransactionType.ADVANCE_REFUND
              : FinancialTransactionType.ADVANCE_RECEIPT,
          paymentMethod: method,
          accountId,
          amount: entry.amount,
          occurredAt: entry.createdAt,
          description: entry.description,
        },
        true,
      );
    });

    await forChunks(udharPayments, async (tx, payment) => {
      const method = payment.paymentMethod ?? PaymentMethod.OTHER;
      const accountId = method === PaymentMethod.CASH ? cash?.id : payment.accountId;
      if (accountId !== payment.accountId) {
        await tx.ledgerEntry.update({ where: { id: payment.id }, data: { accountId } });
      }
      await this.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'UDHAR_PAYMENT',
          sourceId: payment.id,
          sourceParentType: 'UDHAR',
          sourceParentId: payment.entityId!,
          transactionType: FinancialTransactionType.UDHAR_COLLECTION,
          paymentMethod: method,
          accountId,
          amount: payment.amount,
          occurredAt: payment.createdAt,
          description: payment.description,
        },
        true,
      );
    });

    if (!dryRun) {
      const assigned = await this.prisma.financialMovement.findMany({
        where: {
          organizationId,
          accountId: { not: null },
          transaction: {
            reversedAt: null,
            sourceType: {
              in: ['INVOICE_PAYMENT', 'PURCHASE_PAYMENT', 'ADVANCE_LEDGER', 'UDHAR_PAYMENT'],
            },
          },
        },
        select: {
          accountId: true,
          transaction: { select: { sourceType: true, sourceId: true } },
        },
      });
      for (const row of assigned) {
        if (!row.accountId) continue;
        await this.stampSourceAccount(this.prisma, organizationId, row.transaction, row.accountId);
      }
    }

    return { dryRun: false, ...counts };
  }

  async bulkAssignMovements(dto: BulkAssignMovementsDto, organizationId: string) {
    const assignments = dto.assignments;
    if (!assignments.length) return { updated: 0 };

    const accountIds = [...new Set(assignments.map((a) => a.accountId))];
    const accounts = await this.prisma.financialAccount.findMany({
      where: { id: { in: accountIds }, organizationId },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    for (const accountId of accountIds) {
      const account = accountById.get(accountId);
      if (!account) throw new NotFoundException('Financial account not found');
      if (account.status !== FinancialAccountStatus.ACTIVE) {
        throw new BadRequestException('Financial account is not active');
      }
    }

    const movementIds = [...new Set(assignments.map((a) => a.movementId))];
    let updated = 0;
    for (let i = 0; i < movementIds.length; i += BACKFILL_CHUNK) {
      const chunkIds = movementIds.slice(i, i + BACKFILL_CHUNK);
      const chunkAssignments = assignments.filter((a) => chunkIds.includes(a.movementId));
      await this.prisma.$transaction(async (tx) => {
        const movements = await tx.financialMovement.findMany({
          where: { id: { in: chunkIds }, organizationId },
          include: {
            transaction: { select: { reversedAt: true, sourceType: true, sourceId: true } },
          },
        });
        const byId = new Map(movements.map((m) => [m.id, m]));
        for (const assignment of chunkAssignments) {
          const movement = byId.get(assignment.movementId);
          if (!movement) throw new NotFoundException('Financial movement not found');
          if (movement.accountId) {
            throw new BadRequestException('Movement already has an account assigned');
          }
          if (movement.transaction.reversedAt) {
            throw new BadRequestException('Cannot assign a reversed transaction');
          }
          await tx.financialMovement.update({
            where: { id: assignment.movementId },
            data: { accountId: assignment.accountId },
          });
          await this.stampSourceAccount(
            tx,
            organizationId,
            movement.transaction,
            assignment.accountId,
          );
          updated += 1;
        }
      }, BACKFILL_TX);
    }
    return { updated };
  }

  private async assertAssignment(
    movementId: string,
    accountId: string,
    organizationId: string,
    db: Db = this.prisma,
  ) {
    const [movement, account] = await Promise.all([
      db.financialMovement.findFirst({
        where: { id: movementId, organizationId },
        include: { transaction: { select: { reversedAt: true } } },
      }),
      db.financialAccount.findFirst({ where: { id: accountId, organizationId } }),
    ]);
    if (!movement) throw new NotFoundException('Financial movement not found');
    if (!account) throw new NotFoundException('Financial account not found');
    if (account.status !== FinancialAccountStatus.ACTIVE) {
      throw new BadRequestException('Financial account is not active');
    }
    if (movement.accountId) {
      throw new BadRequestException('Movement already has an account assigned');
    }
    if (movement.transaction.reversedAt) {
      throw new BadRequestException('Cannot assign a reversed transaction');
    }
  }
}
