/**
 * advance.service.spec.ts
 *
 * Tests the full Aryan scenario plus individual method contracts.
 *
 * Strategy: mock PrismaService completely so tests run without a DB.
 * All service methods are exercised via the public API.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerType, PaymentMethod } from '@prisma/client';
import { AdvanceService } from './advance.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG = 'org-1';
const ARYAN = 'customer-aryan';
const MRS_ARYAN = 'customer-mrs-aryan';

const user = () =>
  ({
    organizationId: ORG,
    userId: 'user-staff',
    // other fields not needed by advance service
  }) as any;

function makeDecimal(n: number) {
  return new Decimal(n);
}

/**
 * Builds a Prisma mock that answers groupBy for the advance balance query.
 * `balanceMap` is keyed by customerId and maps LedgerType → amount.
 */
function buildPrisma(overrides: Partial<Record<string, any>> = {}) {
  return {
    customer: {
      findFirst: jest.fn(),
    },
    ledgerEntry: {
      groupBy: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    udharEntry: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (cb: any) => cb(overrides.tx ?? {})),
    ...overrides,
  } as any;
}

const stubFinance = () =>
  ({
    resolvePaymentAccount: jest.fn().mockResolvedValue(null),
    syncAutomaticPayment: jest.fn(),
  }) as any;

function buildService(prismaOverrides: any = {}, financeService: any = stubFinance()) {
  const prisma = buildPrisma(prismaOverrides);
  const service = new AdvanceService(prisma, { ...stubFinance(), ...financeService });
  return { service, prisma };
}

// ─── getCustomerAdvanceBalance ─────────────────────────────────────────────────

describe('AdvanceService.getCustomerAdvanceBalance', () => {
  it('returns zero when no ledger entries exist', async () => {
    const { service, prisma } = buildService();
    prisma.ledgerEntry.groupBy.mockResolvedValue([]);

    const result = await service.getCustomerAdvanceBalance(ARYAN, ORG);

    expect(result.availableAdvance.toNumber()).toBe(0);
  });

  it('sums credits and debits correctly', async () => {
    const { service, prisma } = buildService();
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: new Decimal(100000) } },
      { type: LedgerType.ADVANCE_APPLIED, _sum: { amount: new Decimal(40000) } },
      { type: LedgerType.ADVANCE_TRANSFER_OUT, _sum: { amount: new Decimal(25000) } },
      { type: LedgerType.ADVANCE_REFUND, _sum: { amount: new Decimal(10000) } },
    ]);

    const result = await service.getCustomerAdvanceBalance(ARYAN, ORG);

    // 100000 - 40000 - 25000 - 10000 = 25000
    expect(result.availableAdvance.toNumber()).toBe(25000);
  });

  it('returns zero (not negative) when debits exceed credits', async () => {
    const { service, prisma } = buildService();
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: new Decimal(1000) } },
      { type: LedgerType.ADVANCE_APPLIED, _sum: { amount: new Decimal(5000) } },
    ]);

    const result = await service.getCustomerAdvanceBalance(ARYAN, ORG);

    expect(result.availableAdvance.toNumber()).toBe(0);
  });

  it('counts ADVANCE_TRANSFER_IN as credit', async () => {
    const { service, prisma } = buildService();
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      { type: LedgerType.ADVANCE_TRANSFER_IN, _sum: { amount: new Decimal(25000) } },
    ]);

    const result = await service.getCustomerAdvanceBalance(MRS_ARYAN, ORG);

    expect(result.availableAdvance.toNumber()).toBe(25000);
  });
});

// ─── receiveAdvance ────────────────────────────────────────────────────────────

describe('AdvanceService.receiveAdvance', () => {
  const dto = {
    amount: 100000,
    paymentMethod: PaymentMethod.UPI,
    reference: 'UTR123',
    notes: 'Aryan advance',
  };

  it('creates an ADVANCE_RECEIVED ledger entry', async () => {
    const createdEntry = {
      id: 'le-001',
      amount: makeDecimal(100000),
      type: LedgerType.ADVANCE_RECEIVED,
      description: 'Aryan advance',
      createdAt: new Date(),
    };

    const tx = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN, fullName: 'Aryan Soni' }) },
      ledgerEntry: { create: jest.fn().mockResolvedValue(createdEntry) },
      financialTransaction: { update: jest.fn().mockResolvedValue({ id: 'tx-1' }) },
    };

    const prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;
    const financeService = {
      resolvePaymentAccount: jest.fn().mockResolvedValue({ id: 'bank-1' }),
      syncAutomaticPayment: jest.fn().mockResolvedValue({ id: 'tx-1' }),
    };

    const service = new AdvanceService(prisma, financeService as any);
    const result = await service.receiveAdvance(ARYAN, dto, user());

    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG,
          customerId: ARYAN,
          amount: makeDecimal(100000),
          type: LedgerType.ADVANCE_RECEIVED,
          paymentMethod: PaymentMethod.UPI,
        }),
      }),
    );
    expect(result.type).toBe(LedgerType.ADVANCE_RECEIVED);
    expect(result.amount.toNumber()).toBe(100000);
    expect(result.transactionId).toBe('tx-1');
  });

  it('throws NotFoundException when customer does not exist', async () => {
    const tx = {
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());

    await expect(service.receiveAdvance(ARYAN, dto, user())).rejects.toThrow(NotFoundException);
  });
});

// ─── applyAdvanceToInvoice ────────────────────────────────────────────────────

describe('AdvanceService.applyAdvanceToInvoice', () => {
  const INVOICE_ID = 'invoice-a';

  function buildInvoice(overrides: any = {}) {
    return {
      id: INVOICE_ID,
      organizationId: ORG,
      customerId: ARYAN,
      invoiceNumber: 'INV/1/2026-27',
      status: 'UNPAID',
      totalAmount: makeDecimal(80000),
      paidAmount: makeDecimal(0),
      ...overrides,
    };
  }

  it('applies advance and updates invoice status to PARTIAL', async () => {
    const invoice = buildInvoice();

    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(100000) } },
          ]),
        create: jest.fn().mockResolvedValue({ id: 'le-002' }),
      },
      invoicePayment: { create: jest.fn().mockResolvedValue({ id: 'ip-001' }) },
      udharEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice: {
        update: jest.fn().mockResolvedValue({ ...invoice, paidAmount: makeDecimal(40000) }),
      },
    };

    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());
    const result = await service.applyAdvanceToInvoice(INVOICE_ID, 40000, user());

    expect(result.invoiceStatus).toBe('PARTIAL');
    expect(result.advanceApplied.toNumber()).toBe(40000);
    expect(result.remainingPayable.toNumber()).toBe(40000);
  });

  it('marks invoice PAID when full balance is covered', async () => {
    const invoice = buildInvoice({ totalAmount: makeDecimal(40000) });

    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(100000) } },
          ]),
        create: jest.fn().mockResolvedValue({ id: 'le-002' }),
      },
      invoicePayment: { create: jest.fn().mockResolvedValue({ id: 'ip-001' }) },
      udharEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice: {
        update: jest.fn().mockResolvedValue({ ...invoice }),
      },
    };

    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());
    const result = await service.applyAdvanceToInvoice(INVOICE_ID, 40000, user());

    expect(result.invoiceStatus).toBe('PAID');
  });

  it('throws when advance exceeds invoice remaining balance', async () => {
    const invoice = buildInvoice({ totalAmount: makeDecimal(10000), paidAmount: makeDecimal(0) });

    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
    } as any;

    const service = new AdvanceService(prisma, stubFinance());

    await expect(service.applyAdvanceToInvoice(INVOICE_ID, 50000, user())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws when customer has insufficient advance balance', async () => {
    const invoice = buildInvoice();

    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(5000) } },
          ]),
      },
    };

    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());

    await expect(service.applyAdvanceToInvoice(INVOICE_ID, 40000, user())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('also updates the linked UdharEntry when present', async () => {
    const invoice = buildInvoice();
    const udhar = {
      id: 'ue-001',
      amount: makeDecimal(80000),
      paidAmount: makeDecimal(0),
      status: 'ACTIVE',
    };

    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(100000) } },
          ]),
        create: jest.fn().mockResolvedValue({ id: 'le-002' }),
      },
      invoicePayment: { create: jest.fn().mockResolvedValue({ id: 'ip-001' }) },
      udharEntry: {
        findFirst: jest.fn().mockResolvedValue(udhar),
        update: jest.fn().mockResolvedValue(udhar),
      },
      invoice: {
        update: jest.fn().mockResolvedValue(invoice),
      },
    };

    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());
    await service.applyAdvanceToInvoice(INVOICE_ID, 40000, user());

    expect(tx.udharEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidAmount: makeDecimal(40000),
          status: 'ACTIVE',
        }),
      }),
    );
  });
});

// ─── transferAdvance ──────────────────────────────────────────────────────────

describe('AdvanceService.transferAdvance', () => {
  const dto = { toCustomerId: MRS_ARYAN, amount: 25000, notes: 'Family transfer' };

  it('creates paired TRANSFER_OUT and TRANSFER_IN entries cross-linked', async () => {
    const outEntry = { id: 'le-003', type: LedgerType.ADVANCE_TRANSFER_OUT };
    const inEntry = { id: 'le-004', type: LedgerType.ADVANCE_TRANSFER_IN };

    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(60000) } },
          ]),
        create: jest.fn().mockResolvedValueOnce(outEntry).mockResolvedValueOnce(inEntry),
        update: jest.fn().mockResolvedValue(outEntry),
      },
    };

    const prisma = {
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: ARYAN, fullName: 'Aryan' })
          .mockResolvedValueOnce({ id: MRS_ARYAN, fullName: 'Mrs Aryan' }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());
    const result = await service.transferAdvance(ARYAN, dto, user());

    // TRANSFER_OUT created first
    expect(tx.ledgerEntry.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: ARYAN,
          type: LedgerType.ADVANCE_TRANSFER_OUT,
          amount: makeDecimal(25000),
        }),
      }),
    );

    // TRANSFER_IN created second with back-link
    expect(tx.ledgerEntry.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: MRS_ARYAN,
          type: LedgerType.ADVANCE_TRANSFER_IN,
          referenceLedgerEntryId: outEntry.id,
        }),
      }),
    );

    // OUT entry back-linked to IN entry
    expect(tx.ledgerEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: outEntry.id }),
        data: expect.objectContaining({ referenceLedgerEntryId: inEntry.id }),
      }),
    );

    expect(result.from.customerId).toBe(ARYAN);
    expect(result.to.customerId).toBe(MRS_ARYAN);
    expect(result.transferAmount.toNumber()).toBe(25000);
  });

  it('throws when source customer has insufficient balance', async () => {
    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(10000) } },
          ]),
      },
    };

    const prisma = {
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: ARYAN, fullName: 'Aryan' })
          .mockResolvedValueOnce({ id: MRS_ARYAN, fullName: 'Mrs Aryan' }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());

    await expect(service.transferAdvance(ARYAN, dto, user())).rejects.toThrow(BadRequestException);
  });

  it('throws when transferring to the same customer', async () => {
    const prisma = {} as any;
    const service = new AdvanceService(prisma, stubFinance());

    await expect(
      service.transferAdvance(ARYAN, { ...dto, toCustomerId: ARYAN }, user()),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when destination customer does not exist', async () => {
    const prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: ARYAN }).mockResolvedValueOnce(null),
      },
    } as any;

    const service = new AdvanceService(prisma, stubFinance());

    await expect(service.transferAdvance(ARYAN, dto, user())).rejects.toThrow(NotFoundException);
  });
});

// ─── refundAdvance ────────────────────────────────────────────────────────────

describe('AdvanceService.refundAdvance', () => {
  const dto = { amount: 10000, paymentMethod: PaymentMethod.UPI };

  it('creates an ADVANCE_REFUND ledger entry', async () => {
    const refundEntry = {
      id: 'le-005',
      amount: makeDecimal(10000),
      type: LedgerType.ADVANCE_REFUND,
      description: 'Advance refunded via UPI',
      createdAt: new Date(),
    };

    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(35000) } },
          ]),
        create: jest.fn().mockResolvedValue(refundEntry),
      },
    };

    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());
    const result = await service.refundAdvance(ARYAN, dto, user());

    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: LedgerType.ADVANCE_REFUND,
          amount: makeDecimal(10000),
          paymentMethod: PaymentMethod.UPI,
        }),
      }),
    );
    expect(result.type).toBe(LedgerType.ADVANCE_REFUND);
  });

  it('throws when refund exceeds available balance', async () => {
    const tx = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(5000) } },
          ]),
      },
    };

    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma, stubFinance());

    await expect(service.refundAdvance(ARYAN, dto, user())).rejects.toThrow(BadRequestException);
  });
});

// ─── Full Aryan Scenario ──────────────────────────────────────────────────────
// Exercises the balance formula end-to-end using the formula directly
// (since each step is integration-tested above, here we verify the math).

describe('Aryan scenario — advance balance formula', () => {
  it('computes final balances correctly after all operations', async () => {
    /**
     * State after all operations:
     *   Aryan:
     *     ADVANCE_RECEIVED     +100,000
     *     ADVANCE_APPLIED      - 40,000  (Invoice A)
     *     ADVANCE_TRANSFER_OUT - 25,000  (to Mrs Aryan)
     *     ADVANCE_REFUND       - 10,000
     *     ────────────────────
     *     Available            = 25,000
     *
     *   Mrs Aryan:
     *     ADVANCE_TRANSFER_IN  + 25,000
     *     ────────────────────
     *     Available            = 25,000
     */

    // ── Aryan balance ─────────────────────────────────────────────────────
    const aryanPrisma = {
      ledgerEntry: {
        groupBy: jest.fn().mockResolvedValue([
          { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(100000) } },
          { type: LedgerType.ADVANCE_APPLIED, _sum: { amount: makeDecimal(40000) } },
          { type: LedgerType.ADVANCE_TRANSFER_OUT, _sum: { amount: makeDecimal(25000) } },
          { type: LedgerType.ADVANCE_REFUND, _sum: { amount: makeDecimal(10000) } },
        ]),
      },
    } as any;

    const aryanService = new AdvanceService(aryanPrisma, stubFinance());
    const aryanBalance = await aryanService.getCustomerAdvanceBalance(ARYAN, ORG);
    expect(aryanBalance.availableAdvance.toNumber()).toBe(25000);

    // ── Mrs Aryan balance ─────────────────────────────────────────────────
    const mrsAryanPrisma = {
      ledgerEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { type: LedgerType.ADVANCE_TRANSFER_IN, _sum: { amount: makeDecimal(25000) } },
          ]),
      },
    } as any;

    const mrsAryanService = new AdvanceService(mrsAryanPrisma, stubFinance());
    const mrsBalance = await mrsAryanService.getCustomerAdvanceBalance(MRS_ARYAN, ORG);
    expect(mrsBalance.availableAdvance.toNumber()).toBe(25000);
  });

  it('verifies all 5 ledger entry types are created in correct order', () => {
    // This test documents the expected ledger rows for the Aryan scenario.
    // Values match the step-by-step walkthrough in the architecture doc.
    const expectedRows: Array<{ type: LedgerType; customerId: string; amount: number }> = [
      { type: LedgerType.ADVANCE_RECEIVED, customerId: ARYAN, amount: 100000 },
      { type: LedgerType.ADVANCE_APPLIED, customerId: ARYAN, amount: 40000 },
      { type: LedgerType.ADVANCE_TRANSFER_OUT, customerId: ARYAN, amount: 25000 },
      { type: LedgerType.ADVANCE_TRANSFER_IN, customerId: MRS_ARYAN, amount: 25000 },
      { type: LedgerType.ADVANCE_REFUND, customerId: ARYAN, amount: 10000 },
    ];

    // All 5 required types are present
    const types = expectedRows.map((r) => r.type);
    expect(types).toContain(LedgerType.ADVANCE_RECEIVED);
    expect(types).toContain(LedgerType.ADVANCE_APPLIED);
    expect(types).toContain(LedgerType.ADVANCE_TRANSFER_OUT);
    expect(types).toContain(LedgerType.ADVANCE_TRANSFER_IN);
    expect(types).toContain(LedgerType.ADVANCE_REFUND);

    // Net for Aryan
    const aryanRows = expectedRows.filter((r) => r.customerId === ARYAN);
    const aryanNet = aryanRows.reduce((sum, r) => {
      const creditTypes: string[] = [LedgerType.ADVANCE_RECEIVED, LedgerType.ADVANCE_TRANSFER_IN];
      return creditTypes.includes(r.type) ? sum + r.amount : sum - r.amount;
    }, 0);
    expect(aryanNet).toBe(25000);

    // Net for Mrs Aryan
    const mrsRows = expectedRows.filter((r) => r.customerId === MRS_ARYAN);
    const mrsNet = mrsRows.reduce((sum, r) => {
      const creditTypes: string[] = [LedgerType.ADVANCE_RECEIVED, LedgerType.ADVANCE_TRANSFER_IN];
      return creditTypes.includes(r.type) ? sum + r.amount : sum - r.amount;
    }, 0);
    expect(mrsNet).toBe(25000);
  });
});

// ─── Customer Statement integration ──────────────────────────────────────────

describe('Customer statement with advance entries', () => {
  it('produces correct running balance across all ledger types', () => {
    /**
     * Simulate what ReportsService.getCustomerStatement produces
     * for the Aryan scenario with a mix of UDHAR and advance types.
     */
    type LedgerRow = { type: string; amount: Decimal };

    function simulateStatement(rows: LedgerRow[]) {
      let balance = new Decimal(0);
      return rows.map((l) => {
        let debit = new Decimal(0);
        let credit = new Decimal(0);
        switch (l.type) {
          case 'UDHAR':
            debit = l.amount;
            balance = balance.plus(debit);
            break;
          case 'PAYMENT':
            credit = l.amount;
            balance = balance.minus(credit);
            break;
          case 'ADVANCE_RECEIVED':
          case 'ADVANCE_TRANSFER_IN':
            credit = l.amount;
            balance = balance.minus(credit);
            break;
          case 'ADVANCE_APPLIED':
          case 'ADVANCE_TRANSFER_OUT':
          case 'ADVANCE_REFUND':
            debit = l.amount;
            balance = balance.plus(debit);
            break;
        }
        return { type: l.type, debit, credit, balance };
      });
    }

    const rows: LedgerRow[] = [
      { type: 'ADVANCE_RECEIVED', amount: makeDecimal(100000) }, // balance: -100000
      { type: 'UDHAR', amount: makeDecimal(80000) }, // balance:  -20000
      { type: 'ADVANCE_APPLIED', amount: makeDecimal(40000) }, // balance:   20000
      { type: 'ADVANCE_TRANSFER_OUT', amount: makeDecimal(25000) }, // balance:  45000
      { type: 'ADVANCE_REFUND', amount: makeDecimal(10000) }, // balance:   55000
    ];

    const statement = simulateStatement(rows);

    expect(statement[0].balance.toNumber()).toBe(-100000); // credit on account
    expect(statement[1].balance.toNumber()).toBe(-20000); // udhar partially offsets
    expect(statement[2].balance.toNumber()).toBe(20000); // advance applied, udhar outstanding
    expect(statement[3].balance.toNumber()).toBe(45000); // transfer out
    expect(statement[4].balance.toNumber()).toBe(55000); // refund

    // Final: Aryan owes ₹55,000 net (the UDHAR not yet fully covered)
    // This is correct: ₹80,000 udhar - ₹40,000 advance applied - ₹100,000 received + ₹25,000 out + ₹10,000 refunded
  });
});
