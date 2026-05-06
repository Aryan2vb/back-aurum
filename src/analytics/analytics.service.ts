import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsFiltersDto, Granularity } from './dto/analytics-filters.dto';
import { InvoiceStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Shared filter builder ───────────────────────────────────────────

  private toNumber(value: unknown): number {
    return new Decimal((value as any) || 0).toNumber();
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundWeight(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private localDateString(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private buildItemFilters(filters: Partial<AnalyticsFiltersDto>) {
    const itemWhere: any = {};
    if (filters.metalType) itemWhere.metalType = filters.metalType;
    if (filters.hsnSac) itemWhere.hsnSac = filters.hsnSac;
    if (filters.purity) itemWhere.purityLabel = filters.purity;
    if (filters.item) {
      itemWhere.description = { contains: filters.item, mode: 'insensitive' };
    }
    return itemWhere;
  }

  private buildLocationFilter(location: string) {
    return {
      locations: {
        some: {
          deletedAt: null,
          OR: [
            { village: { contains: location, mode: 'insensitive' } },
            { tehsil: { contains: location, mode: 'insensitive' } },
            { district: { contains: location, mode: 'insensitive' } },
            { state: { contains: location, mode: 'insensitive' } },
            { pincode: { contains: location, mode: 'insensitive' } },
          ],
        },
      },
    };
  }

  private buildInvoiceWhere(organizationId: string, filters: Partial<AnalyticsFiltersDto> = {}) {
    const where: any = {
      organizationId,
      deletedAt: null,
      status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
    };

    if (filters.status) {
      where.status = filters.status as InvoiceStatus;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.invoiceDate = {};
      if (filters.dateFrom) where.invoiceDate.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        where.invoiceDate.lte = to;
      }
    }

    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.createdById) where.createdById = filters.createdById;
    if (filters.paymentMode) where.payments = { some: { mode: filters.paymentMode } };
    if (filters.location) where.customer = this.buildLocationFilter(filters.location);

    const itemFilters = this.buildItemFilters(filters);
    if (Object.keys(itemFilters).length > 0) {
      where.items = { some: itemFilters };
    }

    return where;
  }

  private buildItemWhere(organizationId: string, filters: Partial<AnalyticsFiltersDto> = {}) {
    const invoiceWhere = this.buildInvoiceWhere(organizationId, filters);
    return { organizationId, invoice: invoiceWhere, ...this.buildItemFilters(filters) };
  }

  private buildPaymentWhere(organizationId: string, filters: Partial<AnalyticsFiltersDto> = {}) {
    const invoiceFilters = { ...filters };
    delete invoiceFilters.dateFrom;
    delete invoiceFilters.dateTo;
    const where: any = {
      organizationId,
      invoice: this.buildInvoiceWhere(organizationId, invoiceFilters),
    };

    if (filters.paymentMode) where.mode = filters.paymentMode;
    if (filters.dateFrom || filters.dateTo) {
      where.paidAt = {};
      if (filters.dateFrom) where.paidAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        where.paidAt.lte = to;
      }
    }

    return where;
  }

  private dateKey(date: Date, granularity: Granularity = Granularity.DAY): string {
    const d = new Date(date);
    if (granularity === Granularity.MONTH) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (granularity === Granularity.WEEK) {
      // ISO week: use Monday-based week start
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return this.localDateString(d);
    }
    return this.localDateString(d);
  }

  // ─── Dashboard Summary ───────────────────────────────────────────────

  async getDashboardSummary(organizationId: string, filters: AnalyticsFiltersDto) {
    const where = this.buildInvoiceWhere(organizationId, filters);

    // Today's boundaries
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // This month boundaries
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Run aggregates in parallel
    const [periodAgg, todayAgg, monthAgg, itemAgg, paymentAgg, gstAgg, qualitySummary] = await Promise.all([
      // Period totals (respects filters)
      this.prisma.invoice.aggregate({
        where,
        _sum: { totalAmount: true, paidAmount: true, taxableAmount: true },
        _count: { id: true },
      }),

      // Today's totals
      this.prisma.invoice.aggregate({
        where: {
          ...this.buildInvoiceWhere(organizationId, {}),
          invoiceDate: { gte: todayStart, lte: todayEnd },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),

      // This month's totals
      this.prisma.invoice.aggregate({
        where: {
          ...this.buildInvoiceWhere(organizationId, {}),
          invoiceDate: { gte: monthStart, lte: todayEnd },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),

      // Metal-wise value and weight from items
      this.prisma.invoiceItem.groupBy({
        by: ['metalType'],
        where: this.buildItemWhere(organizationId, filters),
        _sum: {
          taxableAmount: true,
          netWeight: true,
          grossWeight: true,
          makingChargesAmount: true,
          stoneCharges: true,
          hallmarkingCharge: true,
        },
        _count: { id: true },
      }),

      // Payment mode breakdown
      this.prisma.invoicePayment.groupBy({
        by: ['mode'],
        where: this.buildPaymentWhere(organizationId, filters),
        _sum: { amount: true },
        _count: { id: true },
      }),

      // GST summary from invoice headers
      this.prisma.invoice.aggregate({
        where,
        _sum: {
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          taxableAmount: true,
        },
      }),
      this.getDataQualitySummary(organizationId, filters),
    ]);

    const totalSales = new Decimal(periodAgg._sum.totalAmount || 0).toNumber();
    const invoiceCount = periodAgg._count.id;
    const avgBillValue = invoiceCount > 0 ? totalSales / invoiceCount : 0;

    const totalTax =
      new Decimal(gstAgg._sum.cgstAmount || 0)
        .plus(gstAgg._sum.sgstAmount || 0)
        .plus(gstAgg._sum.igstAmount || 0)
        .toNumber();

    return {
      today: {
        sales: new Decimal(todayAgg._sum.totalAmount || 0).toNumber(),
        invoiceCount: todayAgg._count.id,
      },
      month: {
        sales: new Decimal(monthAgg._sum.totalAmount || 0).toNumber(),
        invoiceCount: monthAgg._count.id,
      },
      period: {
        totalSales,
        totalPaid: new Decimal(periodAgg._sum.paidAmount || 0).toNumber(),
        totalTaxable: new Decimal(periodAgg._sum.taxableAmount || 0).toNumber(),
        invoiceCount,
        avgBillValue: Math.round(avgBillValue * 100) / 100,
      },
      gst: {
        cgst: new Decimal(gstAgg._sum.cgstAmount || 0).toNumber(),
        sgst: new Decimal(gstAgg._sum.sgstAmount || 0).toNumber(),
        igst: new Decimal(gstAgg._sum.igstAmount || 0).toNumber(),
        totalTax,
        totalTaxable: new Decimal(gstAgg._sum.taxableAmount || 0).toNumber(),
      },
      metal: itemAgg.map((g) => ({
        metalType: g.metalType,
        count: g._count.id,
        totalValue: new Decimal(g._sum.taxableAmount || 0).toNumber(),
        totalNetWeight: new Decimal(g._sum.netWeight || 0).toNumber(),
        totalGrossWeight: new Decimal(g._sum.grossWeight || 0).toNumber(),
        totalMakingCharges: new Decimal(g._sum.makingChargesAmount || 0).toNumber(),
        totalStoneCharges: new Decimal(g._sum.stoneCharges || 0).toNumber(),
        totalHallmarkingCharges: new Decimal(g._sum.hallmarkingCharge || 0).toNumber(),
      })),
      payments: paymentAgg.map((p) => ({
        mode: p.mode,
        count: p._count.id,
        total: new Decimal(p._sum.amount || 0).toNumber(),
      })),
      alerts: qualitySummary,
    };
  }

  // ─── Sales Trend ─────────────────────────────────────────────────────

  async getSalesTrend(organizationId: string, filters: AnalyticsFiltersDto) {
    const where = this.buildInvoiceWhere(organizationId, filters);
    const granularity = filters.granularity || Granularity.DAY;

    const invoices = await this.prisma.invoice.findMany({
      where,
      select: {
        invoiceDate: true,
        totalAmount: true,
        paidAmount: true,
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const buckets: Record<string, { sales: number; count: number; paid: number }> = {};

    for (const inv of invoices) {
      const key = this.dateKey(inv.invoiceDate, granularity);
      if (!buckets[key]) buckets[key] = { sales: 0, count: 0, paid: 0 };
      buckets[key].sales += new Decimal(inv.totalAmount).toNumber();
      buckets[key].count += 1;
      buckets[key].paid += new Decimal(inv.paidAmount).toNumber();
    }

    const trend = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        sales: Math.round(data.sales * 100) / 100,
        count: data.count,
        paid: Math.round(data.paid * 100) / 100,
        avgBillValue: data.count > 0 ? Math.round((data.sales / data.count) * 100) / 100 : 0,
      }));

    // Running cumulative
    let cumulative = 0;
    for (const point of trend) {
      cumulative += point.sales;
      (point as any).cumulative = Math.round(cumulative * 100) / 100;
    }

    return { granularity, trend };
  }

  // ─── Metal Analytics ─────────────────────────────────────────────────

  async getMetalAnalytics(organizationId: string, filters: AnalyticsFiltersDto) {
    const itemWhere = this.buildItemWhere(organizationId, filters);

    const [metalGroups, purityGroups] = await Promise.all([
      this.prisma.invoiceItem.groupBy({
        by: ['metalType'],
        where: itemWhere,
        _sum: {
          taxableAmount: true,
          netWeight: true,
          grossWeight: true,
          stoneWeight: true,
          makingChargesAmount: true,
          stoneCharges: true,
          hallmarkingCharge: true,
        },
        _count: { id: true },
      }),
      this.prisma.invoiceItem.groupBy({
        by: ['metalType', 'purityLabel'],
        where: itemWhere,
        _sum: {
          taxableAmount: true,
          netWeight: true,
        },
        _count: { id: true },
      }),
    ]);

    return {
      byMetal: metalGroups.map((g) => ({
        metalType: g.metalType,
        count: g._count.id,
        totalValue: new Decimal(g._sum.taxableAmount || 0).toNumber(),
        totalNetWeight: new Decimal(g._sum.netWeight || 0).toNumber(),
        totalGrossWeight: new Decimal(g._sum.grossWeight || 0).toNumber(),
        totalStoneWeight: new Decimal(g._sum.stoneWeight || 0).toNumber(),
        totalMakingCharges: new Decimal(g._sum.makingChargesAmount || 0).toNumber(),
        totalStoneCharges: new Decimal(g._sum.stoneCharges || 0).toNumber(),
        totalHallmarkingCharges: new Decimal(g._sum.hallmarkingCharge || 0).toNumber(),
      })),
      byPurity: purityGroups.map((g) => ({
        metalType: g.metalType,
        purity: g.purityLabel || 'UNKNOWN',
        count: g._count.id,
        totalValue: new Decimal(g._sum.taxableAmount || 0).toNumber(),
        totalNetWeight: new Decimal(g._sum.netWeight || 0).toNumber(),
      })),
    };
  }

  // ─── Payment Analytics ───────────────────────────────────────────────

  async getPaymentAnalytics(organizationId: string, filters: AnalyticsFiltersDto) {
    const paymentWhere = this.buildPaymentWhere(organizationId, filters);
    const granularity = filters.granularity || Granularity.DAY;

    const payments = await this.prisma.invoicePayment.findMany({
      where: paymentWhere,
      select: {
        mode: true,
        amount: true,
        paidAt: true,
      },
      orderBy: { paidAt: 'asc' },
    });

    // Group by mode
    const byMode: Record<string, { total: number; count: number }> = {};
    // Group by date
    const byDate: Record<string, Record<string, number>> = {};
    let grandTotal = 0;

    for (const p of payments) {
      const mode = p.mode || 'OTHER';
      const amt = new Decimal(p.amount).toNumber();
      grandTotal += amt;

      if (!byMode[mode]) byMode[mode] = { total: 0, count: 0 };
      byMode[mode].total += amt;
      byMode[mode].count += 1;

      const dk = this.dateKey(p.paidAt, granularity);
      if (!byDate[dk]) byDate[dk] = {};
      byDate[dk][mode] = (byDate[dk][mode] || 0) + amt;
    }

    // Cash vs Bank split
    const cashTotal = byMode['CASH']?.total || 0;
    const bankTotal = grandTotal - cashTotal;

    return {
      grandTotal: Math.round(grandTotal * 100) / 100,
      cashTotal: Math.round(cashTotal * 100) / 100,
      bankTotal: Math.round(bankTotal * 100) / 100,
      byMode: Object.entries(byMode).map(([mode, data]) => ({
        mode,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
        percentage: grandTotal > 0 ? Math.round((data.total / grandTotal) * 10000) / 100 : 0,
      })),
      trend: Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, modes]) => ({ date, ...modes })),
    };
  }

  // ─── GST / HSN Analytics ─────────────────────────────────────────────

  async getGstHsnAnalytics(organizationId: string, filters: AnalyticsFiltersDto) {
    const invoiceWhere = this.buildInvoiceWhere(organizationId, filters);

    // HSN-wise item totals
    const hsnGroups = await this.prisma.invoiceItem.groupBy({
      by: ['hsnSac'],
      where: this.buildItemWhere(organizationId, filters),
      _sum: { taxableAmount: true },
      _count: { id: true },
    });

    // Invoice-level GST summary
    const gstAgg = await this.prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: {
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        taxableAmount: true,
        totalAmount: true,
      },
      _count: { id: true },
    });

    // Invoice register (compact)
    const invoices = await this.prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        invoiceNumber: true,
        invoiceDate: true,
        taxType: true,
        taxableAmount: true,
        cgstRate: true,
        cgstAmount: true,
        sgstRate: true,
        sgstAmount: true,
        igstRate: true,
        igstAmount: true,
        totalAmount: true,
        customer: { select: { fullName: true, gstin: true } },
      },
      orderBy: { invoiceDate: 'asc' },
      take: 500, // cap for performance
    });

    return {
      summary: {
        totalTaxable: new Decimal(gstAgg._sum.taxableAmount || 0).toNumber(),
        totalCgst: new Decimal(gstAgg._sum.cgstAmount || 0).toNumber(),
        totalSgst: new Decimal(gstAgg._sum.sgstAmount || 0).toNumber(),
        totalIgst: new Decimal(gstAgg._sum.igstAmount || 0).toNumber(),
        totalTax: new Decimal(gstAgg._sum.cgstAmount || 0)
          .plus(gstAgg._sum.sgstAmount || 0)
          .plus(gstAgg._sum.igstAmount || 0)
          .toNumber(),
        totalAmount: new Decimal(gstAgg._sum.totalAmount || 0).toNumber(),
        invoiceCount: gstAgg._count.id,
      },
      hsnBreakdown: hsnGroups.map((h) => ({
        hsnSac: h.hsnSac,
        count: h._count.id,
        taxableValue: new Decimal(h._sum.taxableAmount || 0).toNumber(),
      })),
      invoiceRegister: invoices.map((inv) => ({
        invoiceNo: inv.invoiceNumber,
        date: inv.invoiceDate,
        customerName: inv.customer?.fullName || '',
        gstin: inv.customer?.gstin || '',
        taxType: inv.taxType,
        taxable: new Decimal(inv.taxableAmount || 0).toNumber(),
        cgstRate: new Decimal(inv.cgstRate).toNumber(),
        cgst: new Decimal(inv.cgstAmount).toNumber(),
        sgstRate: new Decimal(inv.sgstRate).toNumber(),
        sgst: new Decimal(inv.sgstAmount).toNumber(),
        igstRate: new Decimal(inv.igstRate || 0).toNumber(),
        igst: new Decimal(inv.igstAmount || 0).toNumber(),
        total: new Decimal(inv.totalAmount).toNumber(),
      })),
    };
  }

  // ─── Top Customers ───────────────────────────────────────────────────

  async getTopCustomers(organizationId: string, filters: AnalyticsFiltersDto) {
    const invoiceWhere = this.buildInvoiceWhere(organizationId, filters);

    const groups = await this.prisma.invoice.groupBy({
      by: ['customerId'],
      where: invoiceWhere,
      _sum: { totalAmount: true, paidAmount: true },
      _count: { id: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 50,
    });

    // Fetch customer details
    const customerIds = groups.map((g) => g.customerId);
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds }, organizationId },
      select: {
        id: true,
        fullName: true,
        contactDetails: { where: { deletedAt: null }, select: { primaryPhone: true }, take: 1 },
        locations: { where: { deletedAt: null }, select: { village: true, district: true }, take: 1 },
      },
    });

    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return groups.map((g) => {
      const c = customerMap.get(g.customerId);
      return {
        customerId: g.customerId,
        name: c?.fullName || '',
        phone: c?.contactDetails?.[0]?.primaryPhone || '',
        location: c?.locations?.[0]
          ? `${c.locations[0].village || ''} ${c.locations[0].district || ''}`.trim()
          : '',
        invoiceCount: g._count.id,
        totalPurchase: new Decimal(g._sum.totalAmount || 0).toNumber(),
        totalPaid: new Decimal(g._sum.paidAmount || 0).toNumber(),
        outstanding: new Decimal(g._sum.totalAmount || 0)
          .minus(g._sum.paidAmount || 0)
          .toNumber(),
      };
    });
  }

  // ─── Top Items ───────────────────────────────────────────────────────

  async getTopItems(organizationId: string, filters: AnalyticsFiltersDto) {
    const itemWhere = this.buildItemWhere(organizationId, filters);

    // Group by description (normalized)
    const items = await this.prisma.invoiceItem.findMany({
      where: itemWhere,
      select: {
        description: true,
        metalType: true,
        hsnSac: true,
        purityLabel: true,
        taxableAmount: true,
        netWeight: true,
        makingChargesAmount: true,
        stoneCharges: true,
        hallmarkingCharge: true,
        quantity: true,
      },
    });

    const grouped: Record<
      string,
      {
        description: string;
        metalType: string;
        count: number;
        totalQty: number;
        totalValue: number;
        totalWeight: number;
        totalMaking: number;
        totalStone: number;
        totalHmc: number;
      }
    > = {};

    for (const item of items) {
      // Normalize description: trim, uppercase first word
      const desc = (item.description || '').split('\n')[0].trim() || 'Unknown';
      const key = `${desc}__${item.metalType}`;

      if (!grouped[key]) {
        grouped[key] = {
          description: desc,
          metalType: item.metalType,
          count: 0,
          totalQty: 0,
          totalValue: 0,
          totalWeight: 0,
          totalMaking: 0,
          totalStone: 0,
          totalHmc: 0,
        };
      }

      grouped[key].count += 1;
      grouped[key].totalQty += new Decimal(item.quantity).toNumber();
      grouped[key].totalValue += new Decimal(item.taxableAmount || 0).toNumber();
      grouped[key].totalWeight += new Decimal(item.netWeight || 0).toNumber();
      grouped[key].totalMaking += new Decimal(item.makingChargesAmount || 0).toNumber();
      grouped[key].totalStone += new Decimal(item.stoneCharges || 0).toNumber();
      grouped[key].totalHmc += new Decimal(item.hallmarkingCharge || 0).toNumber();
    }

    return Object.values(grouped)
      .map((g) => ({
        ...g,
        totalValue: Math.round(g.totalValue * 100) / 100,
        totalWeight: Math.round(g.totalWeight * 1000) / 1000,
        totalMaking: Math.round(g.totalMaking * 100) / 100,
        totalStone: Math.round(g.totalStone * 100) / 100,
        totalHmc: Math.round(g.totalHmc * 100) / 100,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 50);
  }

  // ─── Location Analytics ─────────────────────────────────────────────

  async getLocationAnalytics(organizationId: string, filters: AnalyticsFiltersDto) {
    const invoices = await this.prisma.invoice.findMany({
      where: this.buildInvoiceWhere(organizationId, filters),
      select: {
        id: true,
        totalAmount: true,
        customerId: true,
        customer: {
          select: {
            locations: {
              where: { deletedAt: null },
              select: { village: true, tehsil: true, district: true, state: true, pincode: true },
              take: 1,
            },
          },
        },
        items: {
          select: {
            metalType: true,
            taxableAmount: true,
            netWeight: true,
          },
        },
      },
    });

    const grouped: Record<
      string,
      {
        location: string;
        invoiceCount: number;
        customerIds: Set<string>;
        totalSales: number;
        metalDemand: Record<string, { value: number; weight: number }>;
      }
    > = {};

    for (const invoice of invoices) {
      const loc = invoice.customer?.locations?.[0];
      const label =
        [loc?.village, loc?.tehsil, loc?.district, loc?.state].filter(Boolean).join(', ') || 'Unknown';

      if (!grouped[label]) {
        grouped[label] = {
          location: label,
          invoiceCount: 0,
          customerIds: new Set(),
          totalSales: 0,
          metalDemand: {},
        };
      }

      grouped[label].invoiceCount += 1;
      grouped[label].customerIds.add(invoice.customerId);
      grouped[label].totalSales += this.toNumber(invoice.totalAmount);

      for (const item of invoice.items) {
        const metal = item.metalType || 'UNKNOWN';
        if (!grouped[label].metalDemand[metal]) grouped[label].metalDemand[metal] = { value: 0, weight: 0 };
        grouped[label].metalDemand[metal].value += this.toNumber(item.taxableAmount);
        grouped[label].metalDemand[metal].weight += this.toNumber(item.netWeight);
      }
    }

    return Object.values(grouped)
      .map((row) => ({
        location: row.location,
        invoiceCount: row.invoiceCount,
        customerCount: row.customerIds.size,
        totalSales: this.roundMoney(row.totalSales),
        avgBillValue: row.invoiceCount > 0 ? this.roundMoney(row.totalSales / row.invoiceCount) : 0,
        metalDemand: Object.entries(row.metalDemand).map(([metalType, totals]) => ({
          metalType,
          totalValue: this.roundMoney(totals.value),
          totalNetWeight: this.roundWeight(totals.weight),
        })),
      }))
      .sort((a, b) => b.totalSales - a.totalSales)
      .slice(0, 100);
  }

  // ─── Labour / Making Charge Analytics ───────────────────────────────

  async getLabourAnalytics(organizationId: string, filters: AnalyticsFiltersDto) {
    const items = await this.prisma.invoiceItem.findMany({
      where: this.buildItemWhere(organizationId, filters),
      select: {
        description: true,
        metalType: true,
        purityLabel: true,
        makingChargesAmount: true,
        makingCharges: true,
        taxableAmount: true,
        netWeight: true,
      },
    });

    const byMetal: Record<string, { labour: number; taxable: number; weight: number; count: number }> = {};
    const byItem: Record<string, { description: string; metalType: string; labour: number; taxable: number; weight: number; count: number }> =
      {};
    let totalLabour = 0;
    let totalTaxable = 0;
    let totalWeight = 0;

    for (const item of items) {
      const labour = this.toNumber(item.makingChargesAmount);
      const taxable = this.toNumber(item.taxableAmount);
      const weight = this.toNumber(item.netWeight);
      const metal = item.metalType || 'UNKNOWN';
      const desc = (item.description || '').split('\n')[0].trim() || 'Unknown';
      const key = `${desc}__${metal}`;

      totalLabour += labour;
      totalTaxable += taxable;
      totalWeight += weight;

      if (!byMetal[metal]) byMetal[metal] = { labour: 0, taxable: 0, weight: 0, count: 0 };
      byMetal[metal].labour += labour;
      byMetal[metal].taxable += taxable;
      byMetal[metal].weight += weight;
      byMetal[metal].count += 1;

      if (!byItem[key]) byItem[key] = { description: desc, metalType: metal, labour: 0, taxable: 0, weight: 0, count: 0 };
      byItem[key].labour += labour;
      byItem[key].taxable += taxable;
      byItem[key].weight += weight;
      byItem[key].count += 1;
    }

    return {
      summary: {
        totalLabour: this.roundMoney(totalLabour),
        totalTaxable: this.roundMoney(totalTaxable),
        labourPercentage: totalTaxable > 0 ? this.roundMoney((totalLabour / totalTaxable) * 100) : 0,
        avgLabourPerGram: totalWeight > 0 ? this.roundMoney(totalLabour / totalWeight) : 0,
        itemCount: items.length,
      },
      byMetal: Object.entries(byMetal).map(([metalType, row]) => ({
        metalType,
        count: row.count,
        totalLabour: this.roundMoney(row.labour),
        totalTaxable: this.roundMoney(row.taxable),
        labourPercentage: row.taxable > 0 ? this.roundMoney((row.labour / row.taxable) * 100) : 0,
        avgLabourPerGram: row.weight > 0 ? this.roundMoney(row.labour / row.weight) : 0,
      })),
      byItem: Object.values(byItem)
        .map((row) => ({
          description: row.description,
          metalType: row.metalType,
          count: row.count,
          totalLabour: this.roundMoney(row.labour),
          totalTaxable: this.roundMoney(row.taxable),
          totalWeight: this.roundWeight(row.weight),
          labourPercentage: row.taxable > 0 ? this.roundMoney((row.labour / row.taxable) * 100) : 0,
        }))
        .sort((a, b) => b.totalLabour - a.totalLabour)
        .slice(0, 100),
    };
  }

  // ─── Rate Analytics ─────────────────────────────────────────────────

  async getRateAnalytics(organizationId: string, filters: AnalyticsFiltersDto) {
    const granularity = filters.granularity || Granularity.DAY;
    const items = await this.prisma.invoiceItem.findMany({
      where: this.buildItemWhere(organizationId, filters),
      select: {
        description: true,
        metalType: true,
        purityLabel: true,
        metalRate: true,
        effectiveRate: true,
        invoice: { select: { invoiceDate: true, invoiceNumber: true } },
      },
      orderBy: { invoice: { invoiceDate: 'asc' } },
    });

    const buckets: Record<string, { date: string; metalType: string; rates: number[]; effectiveRates: number[]; count: number }> = {};
    const unusualRates: Array<{ invoiceNumber: string | null; date: Date; item: string; metalType: string; rate: number; effectiveRate: number }> =
      [];

    for (const item of items) {
      const rate = this.toNumber(item.metalRate);
      const effectiveRate = this.toNumber(item.effectiveRate);
      if (rate <= 0 && effectiveRate <= 0) continue;

      const date = this.dateKey(item.invoice.invoiceDate, granularity);
      const metal = item.metalType || 'UNKNOWN';
      const key = `${date}__${metal}`;
      if (!buckets[key]) buckets[key] = { date, metalType: metal, rates: [], effectiveRates: [], count: 0 };
      if (rate > 0) buckets[key].rates.push(rate);
      if (effectiveRate > 0) buckets[key].effectiveRates.push(effectiveRate);
      buckets[key].count += 1;

      if (rate > 0 && effectiveRate > 0 && Math.abs(effectiveRate - rate) / rate > 0.1) {
        unusualRates.push({
          invoiceNumber: item.invoice.invoiceNumber,
          date: item.invoice.invoiceDate,
          item: (item.description || '').split('\n')[0].trim() || 'Unknown',
          metalType: metal,
          rate: this.roundMoney(rate),
          effectiveRate: this.roundMoney(effectiveRate),
        });
      }
    }

    const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

    return {
      granularity,
      trend: Object.values(buckets)
        .map((bucket) => ({
          date: bucket.date,
          metalType: bucket.metalType,
          count: bucket.count,
          avgMetalRate: this.roundMoney(avg(bucket.rates)),
          minMetalRate: bucket.rates.length ? this.roundMoney(Math.min(...bucket.rates)) : 0,
          maxMetalRate: bucket.rates.length ? this.roundMoney(Math.max(...bucket.rates)) : 0,
          avgEffectiveRate: this.roundMoney(avg(bucket.effectiveRates)),
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.metalType.localeCompare(b.metalType)),
      unusualRates: unusualRates.slice(0, 100),
    };
  }

  // ─── Inventory-Like Movement ────────────────────────────────────────

  async getInventoryMovement(organizationId: string, filters: AnalyticsFiltersDto) {
    const granularity = filters.granularity || Granularity.DAY;
    const items = await this.prisma.invoiceItem.findMany({
      where: this.buildItemWhere(organizationId, filters),
      select: {
        description: true,
        metalType: true,
        quantity: true,
        netWeight: true,
        grossWeight: true,
        taxableAmount: true,
        invoice: { select: { invoiceDate: true } },
      },
      orderBy: { invoice: { invoiceDate: 'asc' } },
    });

    const trend: Record<string, { date: string; metalType: string; quantity: number; netWeight: number; grossWeight: number; value: number; count: number }> =
      {};
    const byItem: Record<string, { description: string; metalType: string; quantity: number; netWeight: number; value: number; count: number }> = {};

    for (const item of items) {
      const date = this.dateKey(item.invoice.invoiceDate, granularity);
      const metal = item.metalType || 'UNKNOWN';
      const trendKey = `${date}__${metal}`;
      const desc = (item.description || '').split('\n')[0].trim() || 'Unknown';
      const itemKey = `${desc}__${metal}`;

      if (!trend[trendKey]) {
        trend[trendKey] = { date, metalType: metal, quantity: 0, netWeight: 0, grossWeight: 0, value: 0, count: 0 };
      }
      trend[trendKey].quantity += this.toNumber(item.quantity);
      trend[trendKey].netWeight += this.toNumber(item.netWeight);
      trend[trendKey].grossWeight += this.toNumber(item.grossWeight);
      trend[trendKey].value += this.toNumber(item.taxableAmount);
      trend[trendKey].count += 1;

      if (!byItem[itemKey]) byItem[itemKey] = { description: desc, metalType: metal, quantity: 0, netWeight: 0, value: 0, count: 0 };
      byItem[itemKey].quantity += this.toNumber(item.quantity);
      byItem[itemKey].netWeight += this.toNumber(item.netWeight);
      byItem[itemKey].value += this.toNumber(item.taxableAmount);
      byItem[itemKey].count += 1;
    }

    return {
      granularity,
      trend: Object.values(trend)
        .map((row) => ({
          ...row,
          quantity: this.roundWeight(row.quantity),
          netWeight: this.roundWeight(row.netWeight),
          grossWeight: this.roundWeight(row.grossWeight),
          value: this.roundMoney(row.value),
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.metalType.localeCompare(b.metalType)),
      byItem: Object.values(byItem)
        .map((row) => ({
          ...row,
          quantity: this.roundWeight(row.quantity),
          netWeight: this.roundWeight(row.netWeight),
          value: this.roundMoney(row.value),
        }))
        .sort((a, b) => b.netWeight - a.netWeight)
        .slice(0, 100),
    };
  }

  // ─── Data Quality / Audit Readiness ─────────────────────────────────

  private async getDataQualitySummary(organizationId: string, filters: AnalyticsFiltersDto) {
    const quality = await this.getDataQuality(organizationId, filters);
    return quality.summary;
  }

  async getDataQuality(organizationId: string, filters: AnalyticsFiltersDto) {
    const invoices = await this.prisma.invoice.findMany({
      where: this.buildInvoiceWhere(organizationId, filters),
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        paidAmount: true,
        taxableAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        roundOff: true,
        customer: {
          select: {
            id: true,
            fullName: true,
            gstin: true,
            contactDetails: { where: { deletedAt: null }, select: { primaryPhone: true }, take: 1 },
            locations: { where: { deletedAt: null }, select: { village: true, district: true, state: true }, take: 1 },
          },
        },
        payments: { select: { mode: true, amount: true } },
        items: {
          select: {
            description: true,
            hsnSac: true,
            metalType: true,
            metalRate: true,
            purityLabel: true,
            taxableAmount: true,
            totalAmount: true,
          },
        },
      },
      orderBy: { invoiceDate: 'desc' },
      take: 1000,
    });

    const invoiceNumberCounts: Record<string, number> = {};
    for (const invoice of invoices) {
      if (invoice.invoiceNumber) invoiceNumberCounts[invoice.invoiceNumber] = (invoiceNumberCounts[invoice.invoiceNumber] || 0) + 1;
    }

    const duplicateInvoices = Object.entries(invoiceNumberCounts)
      .filter(([, count]) => count > 1)
      .map(([invoiceNumber, count]) => ({ invoiceNumber, count }));

    const paymentMismatches: Array<any> = [];
    const missingCustomerDetails: Array<any> = [];
    const invalidItems: Array<any> = [];
    const totalMismatches: Array<any> = [];
    const tolerance = 0.5;

    for (const invoice of invoices) {
      const paymentTotal = invoice.payments.reduce((sum, payment) => sum + this.toNumber(payment.amount), 0);
      const paidAmount = this.toNumber(invoice.paidAmount);
      const totalAmount = this.toNumber(invoice.totalAmount);

      if (Math.abs(paymentTotal - paidAmount) > tolerance || paidAmount - totalAmount > tolerance) {
        paymentMismatches.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          customerName: invoice.customer?.fullName || '',
          totalAmount,
          paidAmount,
          paymentTotal: this.roundMoney(paymentTotal),
          variance: this.roundMoney(paidAmount - paymentTotal),
        });
      }

      const phone = invoice.customer?.contactDetails?.[0]?.primaryPhone;
      const location = invoice.customer?.locations?.[0];
      if (!phone || !invoice.customer?.gstin || !location) {
        missingCustomerDetails.push({
          customerId: invoice.customer?.id,
          customerName: invoice.customer?.fullName || '',
          invoiceNumber: invoice.invoiceNumber,
          missingPhone: !phone,
          missingGstin: !invoice.customer?.gstin,
          missingLocation: !location,
        });
      }

      const taxTotal = this.toNumber(invoice.cgstAmount) + this.toNumber(invoice.sgstAmount) + this.toNumber(invoice.igstAmount);
      const expectedTotal = this.toNumber(invoice.taxableAmount) + taxTotal + this.toNumber(invoice.roundOff);
      if (Math.abs(expectedTotal - totalAmount) > tolerance) {
        totalMismatches.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          totalAmount,
          expectedTotal: this.roundMoney(expectedTotal),
          variance: this.roundMoney(totalAmount - expectedTotal),
        });
      }

      for (const item of invoice.items) {
        const hsn = (item.hsnSac || '').trim();
        const hasInvalidHsn = !/^\d{4,8}$/.test(hsn);
        const hasMissingRate = this.toNumber(item.metalRate) <= 0;
        const hasMissingPurity = !item.purityLabel;
        const hasMissingName = !item.description?.trim();

        if (hasInvalidHsn || hasMissingRate || hasMissingPurity || hasMissingName) {
          invalidItems.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            item: item.description || '',
            metalType: item.metalType,
            hsnSac: item.hsnSac,
            missingItemName: hasMissingName,
            invalidHsn: hasInvalidHsn,
            missingRate: hasMissingRate,
            missingPurity: hasMissingPurity,
          });
        }
      }
    }

    return {
      summary: {
        duplicateInvoiceCount: duplicateInvoices.length,
        paymentMismatchCount: paymentMismatches.length,
        missingCustomerDetailCount: missingCustomerDetails.length,
        invalidItemCount: invalidItems.length,
        totalMismatchCount: totalMismatches.length,
      },
      duplicateInvoices,
      paymentMismatches: paymentMismatches.slice(0, 100),
      missingCustomerDetails: missingCustomerDetails.slice(0, 100),
      invalidItems: invalidItems.slice(0, 100),
      totalMismatches: totalMismatches.slice(0, 100),
    };
  }

  // ─── User / Salesperson Analytics ───────────────────────────────────

  async getUserAnalytics(organizationId: string, filters: AnalyticsFiltersDto) {
    const groups = await this.prisma.invoice.groupBy({
      by: ['createdById'],
      where: this.buildInvoiceWhere(organizationId, filters),
      _sum: { totalAmount: true, paidAmount: true },
      _count: { id: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
    });

    const userIds = groups.map((group) => group.createdById).filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, email: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));

    return groups.map((group) => {
      const user = group.createdById ? userMap.get(group.createdById) : null;
      const totalSales = this.toNumber(group._sum.totalAmount);
      const invoiceCount = group._count.id;
      return {
        userId: group.createdById,
        name: user?.fullName || user?.email || 'Unassigned',
        email: user?.email || '',
        invoiceCount,
        totalSales: this.roundMoney(totalSales),
        totalPaid: this.roundMoney(this.toNumber(group._sum.paidAmount)),
        avgBillValue: invoiceCount > 0 ? this.roundMoney(totalSales / invoiceCount) : 0,
      };
    });
  }
}
