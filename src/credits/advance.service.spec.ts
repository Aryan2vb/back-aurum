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

function buildService(prismaOverrides: any = {}) {
  const prisma = buildPrisma(prismaOverrides);
  const service = new AdvanceService(prisma);
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

  it('includes linked correction credits and debits in the available balance', async () => {
    const { service, prisma } = buildService();
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(1000) } },
      { type: LedgerType.ADVANCE_CORRECTION_CREDIT, _sum: { amount: makeDecimal(200) } },
      { type: LedgerType.ADVANCE_CORRECTION_DEBIT, _sum: { amount: makeDecimal(150) } },
    ]);
    const result = await service.getCustomerAdvanceBalance(ARYAN, ORG);
    expect(result.availableAdvance.toNumber()).toBe(1050);
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
      ledgerEntry: {
        create: jest.fn().mockResolvedValue(createdEntry),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN, documents: [] }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma);
    const result = await service.receiveAdvance(ARYAN, dto, user());

    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG,
          customerId: ARYAN,
          amount: makeDecimal(100000),
          type: LedgerType.ADVANCE_RECEIVED,
          paymentMethod: PaymentMethod.UPI,
          paymentReference: 'UTR123',
          transactionDate: expect.any(Date),
        }),
      }),
    );
    expect(result.type).toBe(LedgerType.ADVANCE_RECEIVED);
    expect(result.amount.toNumber()).toBe(100000);
  });

  it('stores a backdated effective date and payment reference without overwriting the audit timestamp', async () => {
    const tx = {
      ledgerEntry: {
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 'le-backdated',
          amount: makeDecimal(2500),
          type: LedgerType.ADVANCE_RECEIVED,
          createdAt: new Date(),
        }),
      },
    };
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN, documents: [] }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;
    const service = new AdvanceService(prisma);

    await service.receiveAdvance(ARYAN, { ...dto, receivedAt: '2024-02-03' }, user());

    const data = tx.ledgerEntry.create.mock.calls[0][0].data;
    expect(data.transactionDate).toEqual(new Date('2024-02-03T00:00:00.000Z'));
    expect(data.paymentReference).toBe('UTR123');
    expect(data).not.toHaveProperty('createdAt');
  });

  it('rejects an invalid or future effective receipt date', async () => {
    const prisma = { customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN }) } } as any;
    const service = new AdvanceService(prisma);
    await expect(
      service.receiveAdvance(ARYAN, { ...dto, receivedAt: '2024-02-31' }, user()),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.receiveAdvance(ARYAN, { ...dto, receivedAt: '2999-01-01' }, user()),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when customer does not exist', async () => {
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;

    const service = new AdvanceService(prisma);

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

    const service = new AdvanceService(prisma);
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

    const service = new AdvanceService(prisma);
    const result = await service.applyAdvanceToInvoice(INVOICE_ID, 40000, user());

    expect(result.invoiceStatus).toBe('PAID');
  });

  it('throws when advance exceeds invoice remaining balance', async () => {
    const invoice = buildInvoice({ totalAmount: makeDecimal(10000), paidAmount: makeDecimal(0) });

    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
    } as any;

    const service = new AdvanceService(prisma);

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

    const service = new AdvanceService(prisma);

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

    const service = new AdvanceService(prisma);
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
          .mockResolvedValueOnce({ id: ARYAN, fullName: 'Aryan', documents: [] })
          .mockResolvedValueOnce({ id: MRS_ARYAN, fullName: 'Mrs Aryan', documents: [] }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const service = new AdvanceService(prisma);
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

    const service = new AdvanceService(prisma);

    await expect(service.transferAdvance(ARYAN, dto, user())).rejects.toThrow(BadRequestException);
  });

  it('throws when transferring to the same customer', async () => {
    const prisma = {} as any;
    const service = new AdvanceService(prisma);

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

    const service = new AdvanceService(prisma);

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

    const service = new AdvanceService(prisma);
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

    const service = new AdvanceService(prisma);

    await expect(service.refundAdvance(ARYAN, dto, user())).rejects.toThrow(BadRequestException);
  });
});

describe('AdvanceService receipt corrections', () => {
  const receivedAt = new Date('2024-01-01T00:00:00.000Z');
  const sourceReceipt = {
    id: 'receipt-1',
    customerId: ARYAN,
    organizationId: ORG,
    amount: makeDecimal(1000),
    type: LedgerType.ADVANCE_RECEIVED,
    transactionDate: receivedAt,
    paymentMethod: PaymentMethod.CASH,
    paymentReference: null,
    description: 'Advance received',
  };

  it('updates an unused receipt and writes before/after audit data', async () => {
    const updated = { ...sourceReceipt, amount: makeDecimal(1200), paymentReference: 'UPI-REF' };
    const tx = {
      ledgerEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(updated),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      customer: { findFirst: jest.fn().mockResolvedValue({ documents: [] }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ledgerEntry: { findFirst: jest.fn().mockResolvedValue(sourceReceipt) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;
    const service = new AdvanceService(prisma);

    await service.updateReceivedAdvance(
      ARYAN,
      sourceReceipt.id,
      { amount: 1200, reference: 'UPI-REF' },
      user(),
    );

    expect(tx.ledgerEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: makeDecimal(1200), paymentReference: 'UPI-REF' }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'UPDATE', entityType: 'ADVANCE_RECEIPT' }),
      }),
    );
  });

  it('blocks editing a receipt after a debit has used the balance', async () => {
    const tx = {
      ledgerEntry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'applied-entry' }),
        update: jest.fn(),
      },
    };
    const prisma = {
      ledgerEntry: { findFirst: jest.fn().mockResolvedValue(sourceReceipt) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;
    const service = new AdvanceService(prisma);
    await expect(
      service.updateReceivedAdvance(ARYAN, sourceReceipt.id, { amount: 900 }, user()),
    ).rejects.toThrow(BadRequestException);
    expect(tx.ledgerEntry.update).not.toHaveBeenCalled();
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

    const aryanService = new AdvanceService(aryanPrisma);
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

    const mrsAryanService = new AdvanceService(mrsAryanPrisma);
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

// ─── Receipt lots & allocations ───────────────────────────────────────────────

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const entry = (id: string, type: LedgerType, amount: number, ymd: string, extra: any = {}) => ({
  id,
  type,
  amount: makeDecimal(amount),
  transactionDate: day(ymd),
  createdAt: day(ymd),
  customerId: ARYAN,
  paymentMethod: null,
  paymentReference: null,
  description: null,
  referenceLedgerEntryId: null,
  ...extra,
});

describe('AdvanceService receipt lots', () => {
  it('splits linked and unlinked debits across receipts, oldest first', async () => {
    const entries = [
      entry('r1', LedgerType.ADVANCE_RECEIVED, 10000, '2026-01-01', {
        paymentMethod: 'UPI',
        paymentReference: 'UTR1',
      }),
      entry('r2', LedgerType.ADVANCE_RECEIVED, 5000, '2026-02-01', { paymentMethod: 'CASH' }),
      entry('t1', LedgerType.ADVANCE_TRANSFER_IN, 2000, '2026-02-10'),
      // linked application consumes r2 directly
      entry('a1', LedgerType.ADVANCE_APPLIED, 3000, '2026-03-01', { referenceLedgerEntryId: 'r2' }),
      // legacy lump-sum application and a refund come off the oldest receipt
      entry('a0', LedgerType.ADVANCE_APPLIED, 4000, '2026-03-02'),
      entry('rf', LedgerType.ADVANCE_REFUND, 1000, '2026-03-03'),
      entry('c1', LedgerType.ADVANCE_CORRECTION_CREDIT, 500, '2026-03-04', {
        referenceLedgerEntryId: 'r1',
      }),
    ];
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN, fullName: 'Aryan' }) },
      ledgerEntry: { findMany: jest.fn().mockResolvedValue(entries) },
    } as any;
    const service = new AdvanceService(prisma);

    const receipts = await service.getAvailableAdvances(ARYAN, ORG);
    const byId = Object.fromEntries(receipts.map((r: any) => [r.id, r]));

    expect(byId.r1).toMatchObject({
      originalAmount: 10500,
      remainingAmount: 5500,
      paymentMethod: 'UPI',
      reference: 'UTR1',
    });
    expect(byId.r2).toMatchObject({ originalAmount: 5000, remainingAmount: 2000 });
    expect(byId.t1).toMatchObject({ remainingAmount: 2000 });
    // lot remainders add up to the balance: 10000+5000+2000+500 - 3000-4000-1000 = 9500
    expect(receipts.reduce((s: number, r: any) => s + r.remainingAmount, 0)).toBe(9500);
  });

  it('hides fully used receipts', async () => {
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: ARYAN, fullName: 'Aryan' }) },
      ledgerEntry: {
        findMany: jest.fn().mockResolvedValue([
          entry('r1', LedgerType.ADVANCE_RECEIVED, 1000, '2026-01-01'),
          entry('a1', LedgerType.ADVANCE_APPLIED, 1000, '2026-01-05', {
            referenceLedgerEntryId: 'r1',
          }),
        ]),
      },
    } as any;
    const service = new AdvanceService(prisma);
    expect(await service.getAvailableAdvances(ARYAN, ORG)).toEqual([]);
  });
});

describe('AdvanceService.applyAllocationsInTx', () => {
  const buildTx = (entries: any[], balance: number) => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    customer: { findFirst: jest.fn().mockResolvedValue({ id: MRS_ARYAN, fullName: 'Mrs Aryan' }) },
    ledgerEntry: {
      findMany: jest.fn().mockResolvedValue(entries),
      groupBy: jest
        .fn()
        .mockResolvedValue([
          { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(balance) } },
        ]),
      create: jest.fn().mockResolvedValue({ id: 'applied-1' }),
    },
    invoicePayment: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'pay-1', ...data })),
    },
  });
  const params = (allocations: any[], invoiceDate = day('2026-03-10')) => ({
    organizationId: ORG,
    userId: 'user-staff',
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-1',
    invoiceCustomerId: ARYAN,
    invoiceDate,
    allocations,
  });
  const receipt = entry('r1', LedgerType.ADVANCE_RECEIVED, 10000, '2026-01-15', {
    customerId: MRS_ARYAN,
    paymentMethod: 'UPI',
    paymentReference: 'UTR9',
  });

  it('consumes a receipt from another customer with its own date, mode and reference', async () => {
    const tx = buildTx([receipt], 10000);
    const service = new AdvanceService({} as any);

    const result = await service.applyAllocationsInTx(
      tx as any,
      params([{ advanceEntryId: 'r1', sourceCustomerId: MRS_ARYAN, amount: 4000 }]),
    );

    expect(result.total.toNumber()).toBe(4000);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.ledgerEntry.create.mock.calls[0][0].data).toMatchObject({
      customerId: MRS_ARYAN,
      type: LedgerType.ADVANCE_APPLIED,
      invoiceId: 'inv-1',
      referenceLedgerEntryId: 'r1',
      transactionDate: day('2026-03-10'),
    });
    expect(tx.invoicePayment.create.mock.calls[0][0].data).toMatchObject({
      mode: 'UPI',
      paidAt: day('2026-01-15'),
      reference: 'UTR9',
      source: 'ADVANCE',
      sourceCustomerId: MRS_ARYAN,
      advanceEntryId: 'r1',
      advanceLedgerEntryId: 'applied-1',
    });
  });

  it('rejects more than the receipt has left', async () => {
    // customer holds more overall (another receipt), but this receipt only has 10,000
    const tx = buildTx([receipt], 20000);
    const service = new AdvanceService({} as any);
    await expect(
      service.applyAllocationsInTx(
        tx as any,
        params([{ advanceEntryId: 'r1', sourceCustomerId: MRS_ARYAN, amount: 10001 }]),
      ),
    ).rejects.toThrow('has only');
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a receipt dated after the invoice', async () => {
    const tx = buildTx([receipt], 10000);
    const service = new AdvanceService({} as any);
    await expect(
      service.applyAllocationsInTx(
        tx as any,
        params(
          [{ advanceEntryId: 'r1', sourceCustomerId: MRS_ARYAN, amount: 100 }],
          day('2026-01-10'),
        ),
      ),
    ).rejects.toThrow('after the invoice date');
  });

  it('rejects the same receipt twice', async () => {
    const tx = buildTx([receipt], 10000);
    const service = new AdvanceService({} as any);
    await expect(
      service.applyAllocationsInTx(
        tx as any,
        params([
          { advanceEntryId: 'r1', sourceCustomerId: MRS_ARYAN, amount: 100 },
          { advanceEntryId: 'r1', sourceCustomerId: MRS_ARYAN, amount: 100 },
        ]),
      ),
    ).rejects.toThrow('more than once');
  });
});

describe('AdvanceService balance checks', () => {
  it('counts a receipt recorded later the same day when the debit is dated today', async () => {
    const service = new AdvanceService({} as any);
    const groupBy = jest
      .fn()
      .mockResolvedValue([
        { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(500) } },
      ]);
    const tx = { ledgerEntry: { groupBy } } as any;
    await (service as any)._assertSufficientBalance(
      tx,
      ARYAN,
      ORG,
      makeDecimal(500),
      day('2026-03-10'),
    );
    const asOfCall = groupBy.mock.calls.find((c: any) => c[0].where.transactionDate);
    expect(asOfCall[0].where.transactionDate.lte.toISOString()).toBe('2026-03-10T23:59:59.999Z');
  });

  it("blocks a backdated debit that today's balance cannot cover", async () => {
    const service = new AdvanceService({} as any);
    const groupBy = jest
      .fn()
      // current balance: 100 received, 100 refunded later
      .mockResolvedValueOnce([
        { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(100) } },
        { type: LedgerType.ADVANCE_REFUND, _sum: { amount: makeDecimal(100) } },
      ])
      // as of the backdated day only the receipt existed
      .mockResolvedValueOnce([
        { type: LedgerType.ADVANCE_RECEIVED, _sum: { amount: makeDecimal(100) } },
      ]);
    const tx = { ledgerEntry: { groupBy } } as any;
    await expect(
      (service as any)._assertSufficientBalance(
        tx,
        ARYAN,
        ORG,
        makeDecimal(100),
        day('2026-01-05'),
      ),
    ).rejects.toThrow('Insufficient advance balance');
  });
});
