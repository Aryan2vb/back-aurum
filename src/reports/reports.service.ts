import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { InvoiceStatus, CreditStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getWhereClause(
    organizationId: string,
    filters: ReportFiltersDto,
    dateField = 'createdAt',
    includeDeletedAt = true,
    includeCustomerId = true,
  ): Record<string, any> {
    const where: any = { organizationId };
    if (includeDeletedAt) {
      where.deletedAt = null;
    }

    if (filters.dateFrom || filters.dateTo) {
      where[dateField] = {};
      if (filters.dateFrom) where[dateField].gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        toDate.setUTCHours(23, 59, 59, 999);
        where[dateField].lte = toDate;
      }
    }

    if (filters.customerId && includeCustomerId) {
      where.customerId = filters.customerId;
    }

    return where;
  }

  async getSalesSummary(organizationId: string, filters: ReportFiltersDto) {
    const where = this.getWhereClause(organizationId, filters, 'invoiceDate');
    where.status = { not: InvoiceStatus.DRAFT };

    const aggr = await this.prisma.invoice.aggregate({
      where,
      _sum: {
        totalAmount: true,
        taxableAmount: true,
        paidAmount: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      totalCount: aggr._count.id,
      totalSales: aggr._sum.totalAmount || 0,
      totalTaxable: aggr._sum.taxableAmount || 0,
      totalCollections: aggr._sum.paidAmount || 0,
    };
  }

  async getGstReport(organizationId: string, filters: ReportFiltersDto) {
    const where = this.getWhereClause(organizationId, filters, 'invoiceDate');
    where.status = { not: InvoiceStatus.DRAFT };

    const invoices = await this.prisma.invoice.findMany({
      where,
      select: {
        invoiceNumber: true,
        invoiceDate: true,
        taxType: true,
        cgstRate: true,
        sgstRate: true,
        igstRate: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        taxableAmount: true,
        totalAmount: true,
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const summary = invoices.reduce(
      (acc, inv) => {
        acc.totalCgst = acc.totalCgst.plus(inv.cgstAmount || 0);
        acc.totalSgst = acc.totalSgst.plus(inv.sgstAmount || 0);
        acc.totalIgst = acc.totalIgst.plus(inv.igstAmount || 0);
        acc.totalTax = acc.totalTax
          .plus(inv.cgstAmount || 0)
          .plus(inv.sgstAmount || 0)
          .plus(inv.igstAmount || 0);
        acc.totalTaxable = acc.totalTaxable.plus(inv.taxableAmount || 0);
        return acc;
      },
      {
        totalCgst: new Decimal(0),
        totalSgst: new Decimal(0),
        totalIgst: new Decimal(0),
        totalTax: new Decimal(0),
        totalTaxable: new Decimal(0),
      },
    );

    return {
      summary,
      details: invoices,
    };
  }

  async getCollectionsReport(organizationId: string, filters: ReportFiltersDto) {
    const where = this.getWhereClause(organizationId, filters, 'paidAt', false, false);

    if (filters.customerId) {
      where.invoice = { customerId: filters.customerId };
    }

    const payments = await this.prisma.invoicePayment.findMany({
      where,
      select: {
        mode: true,
        amount: true,
        paidAt: true,
        reference: true,
        invoice: { select: { invoiceNumber: true } },
      },
      orderBy: { paidAt: 'desc' },
    });

    const groupedByMode = payments.reduce(
      (acc, payment) => {
        const mode = payment.mode || 'OTHER';
        acc[mode] = (acc[mode] || new Decimal(0)).plus(payment.amount);
        return acc;
      },
      {} as Record<string, Decimal>,
    );

    return {
      groupedByMode,
      totalCollected: payments.reduce((sum, p) => sum.plus(p.amount), new Decimal(0)),
      recentPayments: payments,
    };
  }

  async getOutstandingDues(organizationId: string) {
    // Both active Udhar and Unpaid/Partial Invoices
    const customers = await this.prisma.customer.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        contactDetails: { select: { primaryPhone: true }, take: 1 },
        udharEntries: {
          where: { status: CreditStatus.ACTIVE, deletedAt: null },
          select: { amount: true, paidAmount: true },
        },
      },
    });

    const results = customers
      .map((c) => {
        let totalDue = new Decimal(0);
        c.udharEntries.forEach((u) => {
          totalDue = totalDue.plus((u.amount as Decimal).minus(u.paidAmount as Decimal));
        });

        return {
          customerId: c.id,
          customerName: c.fullName,
          phone: c.contactDetails?.[0]?.primaryPhone ?? '',
          outstandingAmount: totalDue,
        };
      })
      .filter((c) => c.outstandingAmount.greaterThan(0))
      .sort((a, b) => b.outstandingAmount.toNumber() - a.outstandingAmount.toNumber());

    return results;
  }

  /**
   * Returns all customers that have a non-zero advance (credit) balance,
   * sorted by balance descending. Also includes per-customer breakdown of
   * received / applied / transferred / refunded amounts for a full picture.
   */
  async getAdvancesReport(organizationId: string) {
    const { LedgerType } = await import('@prisma/client');

    // Fetch all advance ledger entries with dates — one query covers both aggregation and dates
    const allEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        organizationId,
        deletedAt: null,
        type: {
          in: [
            LedgerType.ADVANCE_RECEIVED,
            LedgerType.ADVANCE_APPLIED,
            LedgerType.ADVANCE_TRANSFER_OUT,
            LedgerType.ADVANCE_TRANSFER_IN,
            LedgerType.ADVANCE_REFUND,
          ],
        },
      },
      select: {
        id: true,
        customerId: true,
        type: true,
        amount: true,
        description: true,
        paymentMethod: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!allEntries.length) {
      return { summary: { totalAdvanceHeld: new Decimal(0), customersCount: 0 }, customers: [] };
    }

    // Build per-customer buckets with amounts AND date tracking
    const CREDIT_TYPES = [LedgerType.ADVANCE_RECEIVED, LedgerType.ADVANCE_TRANSFER_IN];
    const DEBIT_TYPES = [
      LedgerType.ADVANCE_APPLIED,
      LedgerType.ADVANCE_TRANSFER_OUT,
      LedgerType.ADVANCE_REFUND,
    ];

    const byCustomer = new Map<
      string,
      {
        amounts: Record<string, Decimal>;
        deposits: Array<{
          id: string;
          amount: Decimal;
          date: Date;
          paymentMethod: string | null;
          description: string | null;
        }>;
        firstReceivedAt: Date | null;
        lastReceivedAt: Date | null;
      }
    >();

    for (const e of allEntries) {
      if (!byCustomer.has(e.customerId)) {
        byCustomer.set(e.customerId, {
          amounts: {},
          deposits: [],
          firstReceivedAt: null,
          lastReceivedAt: null,
        });
      }
      const bucket = byCustomer.get(e.customerId)!;
      const amount = new Decimal(e.amount);
      bucket.amounts[e.type] = (bucket.amounts[e.type] ?? new Decimal(0)).plus(amount);

      if (e.type === LedgerType.ADVANCE_RECEIVED) {
        bucket.deposits.push({
          id: e.id,
          amount,
          date: e.createdAt,
          paymentMethod: e.paymentMethod,
          description: e.description,
        });
        if (!bucket.firstReceivedAt || e.createdAt < bucket.firstReceivedAt) {
          bucket.firstReceivedAt = e.createdAt;
        }
        if (!bucket.lastReceivedAt || e.createdAt > bucket.lastReceivedAt) {
          bucket.lastReceivedAt = e.createdAt;
        }
      }
    }

    // Fetch customer details
    const customerIds = [...byCustomer.keys()];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds }, organizationId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        customerCode: true,
        contactDetails: {
          where: { deletedAt: null },
          select: { primaryPhone: true },
          take: 1,
        },
      },
    });

    const result = customers
      .map((c) => {
        const bucket = byCustomer.get(c.id)!;
        const { amounts, deposits, firstReceivedAt, lastReceivedAt } = bucket;

        let balance = new Decimal(0);
        for (const type of CREDIT_TYPES) balance = balance.plus(amounts[type] ?? 0);
        for (const type of DEBIT_TYPES) balance = balance.minus(amounts[type] ?? 0);

        return {
          customerId: c.id,
          customerName: c.fullName,
          customerCode: c.customerCode,
          phone: c.contactDetails?.[0]?.primaryPhone ?? '',
          totalReceived: new Decimal(amounts[LedgerType.ADVANCE_RECEIVED] ?? 0),
          totalApplied: new Decimal(amounts[LedgerType.ADVANCE_APPLIED] ?? 0),
          totalTransferOut: new Decimal(amounts[LedgerType.ADVANCE_TRANSFER_OUT] ?? 0),
          totalTransferIn: new Decimal(amounts[LedgerType.ADVANCE_TRANSFER_IN] ?? 0),
          totalRefunded: new Decimal(amounts[LedgerType.ADVANCE_REFUND] ?? 0),
          availableBalance: balance,
          firstReceivedAt,
          lastReceivedAt,
          deposits, // individual receipt entries with date + method
        };
      })
      .filter((r) => r.availableBalance.greaterThan(0))
      .sort((a, b) => b.availableBalance.toNumber() - a.availableBalance.toNumber());

    const totalAdvanceHeld = result.reduce((s, r) => s.plus(r.availableBalance), new Decimal(0));

    return {
      summary: { totalAdvanceHeld, customersCount: result.length },
      customers: result,
    };
  }

  async getInventoryFlow(organizationId: string, filters: ReportFiltersDto) {
    const invWhere = this.getWhereClause(organizationId, filters, 'invoiceDate');
    invWhere.status = { not: InvoiceStatus.DRAFT };

    const items = await this.prisma.invoiceItem.findMany({
      where: {
        organizationId,
        invoice: invWhere,
      },
      select: {
        metalType: true,
        grossWeight: true,
        netWeight: true,
        purityLabel: true,
      },
    });

    const flow = items.reduce(
      (acc, item) => {
        if (!item.metalType) return acc;
        const mt = item.metalType.toUpperCase();

        if (!acc[mt]) {
          acc[mt] = {
            count: 0,
            totalGrossWeight: new Decimal(0),
            totalNetWeight: new Decimal(0),
            purities: {},
          };
        }

        acc[mt].count += 1;
        if (item.grossWeight)
          acc[mt].totalGrossWeight = acc[mt].totalGrossWeight.plus(item.grossWeight);
        if (item.netWeight) acc[mt].totalNetWeight = acc[mt].totalNetWeight.plus(item.netWeight);

        const purity = item.purityLabel || 'UNKNOWN';
        if (!acc[mt].purities[purity]) {
          acc[mt].purities[purity] = {
            count: 0,
            grossWeight: new Decimal(0),
            netWeight: new Decimal(0),
          };
        }
        acc[mt].purities[purity].count += 1;
        if (item.grossWeight) {
          acc[mt].purities[purity].grossWeight = acc[mt].purities[purity].grossWeight.plus(
            item.grossWeight,
          );
        }
        if (item.netWeight) {
          acc[mt].purities[purity].netWeight = acc[mt].purities[purity].netWeight.plus(
            item.netWeight,
          );
        }

        return acc;
      },
      {} as Record<string, any>,
    );

    return flow;
  }

  async getCustomerStatement(organizationId: string, customerId: string) {
    // Combines all ledger entries into a chronological account statement.
    // Convention (from the customer's perspective relative to the business):
    //   Debit  (+) = customer OWES us more  (e.g. invoice raised, advance consumed)
    //   Credit (-) = customer is OWED more  (e.g. payment received, advance deposited)
    // A positive runningBalance means the customer still owes the business.
    // A negative runningBalance means the business owes the customer (credit on account).
    const ledgers = await this.prisma.ledgerEntry.findMany({
      where: { organizationId, customerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    let runningBalance = new Decimal(0);
    const statement = ledgers.map((l) => {
      let debit = new Decimal(0);
      let credit = new Decimal(0);
      const amount = l.amount as Decimal;

      switch (l.type) {
        // ── Existing debt types ──────────────────────────────────────────
        case 'UDHAR':
        case 'LOAN' as any:
          // Invoice / udhar raised → customer owes us → Debit
          debit = amount;
          runningBalance = runningBalance.plus(debit);
          break;

        case 'PAYMENT':
        case 'REPAYMENT' as any:
          // Customer pays against a debt → Credit
          credit = amount;
          runningBalance = runningBalance.minus(credit);
          break;

        case 'ADJUSTMENT':
          // Signed adjustment: positive amount = reduces balance (credit), negative = increases (debit)
          credit = amount;
          runningBalance = runningBalance.minus(credit);
          break;

        case 'RETURN':
          // Goods returned → reduces amount owed → Credit
          credit = amount;
          runningBalance = runningBalance.minus(credit);
          break;

        // ── Advance / credit types ───────────────────────────────────────
        case 'ADVANCE_RECEIVED':
        case 'ADVANCE_TRANSFER_IN':
          // Customer deposits money with us → business owes customer → Credit (negative balance)
          credit = amount;
          runningBalance = runningBalance.minus(credit);
          break;

        case 'ADVANCE_APPLIED':
        case 'ADVANCE_TRANSFER_OUT':
        case 'ADVANCE_REFUND':
          // Advance consumed / moved out → reduces what business owes customer → Debit
          debit = amount;
          runningBalance = runningBalance.plus(debit);
          break;

        default:
          // Unknown future types — treat as neutral, don't move balance
          break;
      }

      return {
        id: l.id,
        date: l.createdAt,
        type: l.type,
        description: l.description,
        debit,
        credit,
        balance: runningBalance,
      };
    });

    return {
      statement,
      // Positive = customer owes us. Negative = we owe customer (advance on account).
      currentBalance: runningBalance,
    };
  }
}
