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
        acc[mt].purities[purity] = (acc[mt].purities[purity] || 0) + 1;

        return acc;
      },
      {} as Record<string, any>,
    );

    return flow;
  }

  async getCustomerStatement(organizationId: string, customerId: string) {
    // Combines ledgers to form a chronology
    const ledgers = await this.prisma.ledgerEntry.findMany({
      where: { organizationId, customerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    let runningBalance = new Decimal(0);
    const statement = ledgers.map((l) => {
      let debit = new Decimal(0);
      let credit = new Decimal(0);

      // Depending on logic:
      // DEBT (Udhar/Invoice) adds to runningBalance (Customer owes us) -> Debit
      // PAYMENT reduces runningBalance (Customer pays us) -> Credit
      if (['UDHAR', 'LOAN'].includes(l.type)) {
        debit = l.amount as Decimal;
        runningBalance = runningBalance.plus(debit);
      } else if (['PAYMENT', 'REPAYMENT'].includes(l.type)) {
        credit = l.amount as Decimal;
        runningBalance = runningBalance.minus(credit);
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
      currentBalance: runningBalance,
    };
  }
}
