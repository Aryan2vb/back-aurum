import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockTransactionType, MetalType, Prisma } from '@prisma/client';

const DEFAULT_PURITIES: Record<'GOLD' | 'SILVER', string[]> = {
  GOLD: ['24K', '22K', '20K', '18K'],
  SILVER: ['F', '925'],
};

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  /**
   * Core method to record any stock movement (Inward or Outward).
   * It uses an interactive transaction to guarantee balance integrity.
   */
  async recordStockTransaction(params: {
    organizationId: string;
    metalType: MetalType;
    purity: string;
    transactionType: StockTransactionType;
    quantityIn?: number;
    quantityOut?: number;
    rate?: number;
    date?: Date;
    referenceId?: string;
    notes?: string;
    prismaTx?: Prisma.TransactionClient;
  }) {
    const {
      organizationId,
      metalType,
      purity: rawPurity,
      transactionType,
      quantityIn = 0,
      quantityOut = 0,
      rate,
      date,
      referenceId,
      notes,
    } = params;

    const purity = this.normalizePurity(rawPurity, metalType);

    const apply = async (db: Prisma.TransactionClient | PrismaService) => {
      const delta = quantityIn - quantityOut;
      const currentBalance = await db.stockBalance.upsert({
        where: {
          organizationId_metalType_purity: { organizationId, metalType, purity },
        },
        create: {
          organizationId,
          metalType,
          purity,
          quantity: delta,
        },
        update: { quantity: { increment: delta } },
      });

      const newQuantity = Number(currentBalance.quantity);

      if (newQuantity < 0) {
        console.warn(
          `[StockService] Negative stock warning for ${purity} ${metalType}. New balance: ${newQuantity}`,
        );
      }

      const totalValue = rate ? rate * (quantityIn || quantityOut) : null;

      const ledgerEntry = await db.stockLedger.create({
        data: {
          organizationId,
          metalType,
          purity,
          transactionType,
          quantityIn,
          quantityOut,
          runningBalance: newQuantity,
          rate,
          totalValue,
          referenceId,
          notes,
          date: date || new Date(),
        },
      });

      const latest = await db.stockLedger.findFirst({
        where: {
          organizationId,
          metalType,
          purity,
          NOT: { id: ledgerEntry.id },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      const entryDate = date || new Date();
      if (latest && entryDate.getTime() < latest.date.getTime()) {
        await this.recalcRunningBalances(organizationId, metalType, purity, db);
      }

      return { balance: newQuantity, ledgerEntry };
    };

    if (params.prismaTx) return apply(params.prismaTx);
    return this.prisma.$transaction((tx) => apply(tx));
  }

  async getBalances(organizationId: string) {
    return this.prisma.stockBalance.findMany({
      where: { organizationId },
      orderBy: [{ metalType: 'asc' }, { purity: 'asc' }],
    });
  }

  async getLedger(organizationId: string, metalType?: MetalType, purity?: string) {
    return this.prisma.stockLedger.findMany({
      where: {
        organizationId,
        ...(metalType && { metalType }),
        ...(purity && { purity }),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async initializeOpeningBalance(
    organizationId: string,
    metalType: MetalType,
    purity: string,
    quantity: number,
    rate?: number,
    date?: string | Date,
  ) {
    const normalizedPurity = this.normalizePurity(purity, metalType);

    return this.prisma.$transaction(
      async (tx) => {
        const existingOB = await tx.stockLedger.findFirst({
          where: {
            organizationId,
            metalType,
            purity: normalizedPurity,
            transactionType: StockTransactionType.OPENING_BALANCE,
          },
        });

        const earliestOther = await tx.stockLedger.findFirst({
          where: {
            organizationId,
            metalType,
            purity: normalizedPurity,
            ...(existingOB ? { NOT: { id: existingOB.id } } : {}),
          },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        });
        const openingDate = date
          ? new Date(date)
          : (existingOB?.date ?? earliestOther?.date ?? new Date());
        if (earliestOther && openingDate.getTime() > earliestOther.date.getTime()) {
          throw new BadRequestException(
            'Opening balance must be on or before the first stock transaction for this metal and purity',
          );
        }

        if (existingOB) {
          const nextRate =
            rate !== undefined
              ? rate
              : existingOB.rate != null
                ? Number(existingOB.rate)
                : undefined;
          const totalValue = nextRate != null ? nextRate * quantity : null;
          const parsedDate = openingDate;

          const updatedOB = await tx.stockLedger.update({
            where: { id: existingOB.id },
            data: {
              quantityIn: quantity,
              rate: nextRate,
              totalValue,
              date: parsedDate,
            },
          });

          await this.recalcRunningBalances(organizationId, metalType, normalizedPurity, tx);

          return updatedOB;
        }

        const created = await this.recordStockTransaction({
          organizationId,
          metalType,
          purity: normalizedPurity,
          transactionType: StockTransactionType.OPENING_BALANCE,
          quantityIn: quantity,
          rate,
          date: openingDate,
          notes: 'Initial Opening Balance',
          prismaTx: tx,
        });
        await this.recalcRunningBalances(organizationId, metalType, normalizedPurity, tx);
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getGroupSummary(organizationId: string, startDateStr?: string, endDateStr?: string) {
    // Match reports.service: date-only strings are inclusive calendar days (UTC).
    const startDate = startDateStr ? new Date(startDateStr) : null;
    let endDate: Date | null = null;
    if (endDateStr) {
      endDate = new Date(endDateStr);
      endDate.setUTCHours(23, 59, 59, 999);
    }

    // Fetch all stock ledger records for GOLD and SILVER for the organization
    const ledger = await this.prisma.stockLedger.findMany({
      where: {
        organizationId,
        metalType: { in: [MetalType.GOLD, MetalType.SILVER] },
      },
      orderBy: { date: 'asc' },
    });

    // We will compute the chronological moving average valuation from the very beginning (t=0).
    const stateMap = new Map<string, { qty: number; avgRate: number; val: number }>();

    // Map to accumulate period data for the query interval
    const periodMap = new Map<
      string,
      {
        metalType: MetalType;
        purity: string;
        opQty: number;
        opVal: number;
        inQty: number;
        inVal: number;
        outQty: number;
        outVal: number;
        outSaleVal: number;
      }
    >();

    const getState = (key: string) => {
      if (!stateMap.has(key)) {
        stateMap.set(key, { qty: 0, avgRate: 0, val: 0 });
      }
      return stateMap.get(key)!;
    };

    const getPeriodRecord = (key: string, metalType: MetalType, purity: string) => {
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          metalType,
          purity,
          opQty: 0,
          opVal: 0,
          inQty: 0,
          inVal: 0,
          outQty: 0,
          outVal: 0,
          outSaleVal: 0,
        });
      }
      return periodMap.get(key)!;
    };

    for (const entry of ledger) {
      const key = `${entry.metalType}_${entry.purity}`;
      const state = getState(key);

      const qtyIn = Number(entry.quantityIn || 0);
      const qtyOut = Number(entry.quantityOut || 0);
      const transactionRate = Number(entry.rate || 0);
      const entryDate = new Date(entry.date);

      const isBeforePeriod = startDate ? entryDate.getTime() < startDate.getTime() : false;

      // Keep moving average state for ADJUSTMENT rows too (sale/purchase reversals).
      if (entry.transactionType === StockTransactionType.OPENING_BALANCE) {
        const newQty = state.qty + qtyIn;
        const newCostVal = state.val + qtyIn * transactionRate;
        state.qty = newQty;
        state.val = newCostVal;
        state.avgRate = newQty > 0 ? newCostVal / newQty : 0;
      } else if (qtyIn > 0) {
        const newQty = state.qty + qtyIn;
        const newCostVal = state.val + qtyIn * transactionRate;
        state.qty = newQty;
        state.val = newCostVal;
        state.avgRate = newQty > 0 ? newCostVal / newQty : 0;
      } else if (qtyOut > 0) {
        const newQty = state.qty - qtyOut;
        state.qty = newQty;
        state.val = newQty * state.avgRate;
      }

      if (isBeforePeriod) {
        const pRecord = getPeriodRecord(key, entry.metalType, entry.purity);
        pRecord.opQty = state.qty;
        pRecord.opVal = state.val;
      }

      const isInsidePeriod =
        (!startDate || entryDate.getTime() >= startDate.getTime()) &&
        (!endDate || entryDate.getTime() <= endDate.getTime());

      if (isInsidePeriod) {
        const pRecord = getPeriodRecord(key, entry.metalType, entry.purity);
        if (entry.transactionType === StockTransactionType.OPENING_BALANCE) {
          pRecord.opQty += qtyIn;
          pRecord.opVal += qtyIn * transactionRate;
        } else if (qtyIn > 0) {
          pRecord.inQty += qtyIn;
          pRecord.inVal += qtyIn * transactionRate;
        } else if (qtyOut > 0) {
          pRecord.outQty += qtyOut;
          pRecord.outSaleVal += qtyOut * transactionRate;
          pRecord.outVal += qtyOut * state.avgRate;
        }
      }
    }

    const results = [];
    const allKeys = new Set([...stateMap.keys(), ...periodMap.keys()]);

    for (const key of allKeys) {
      const parts = key.split('_');
      const metalType = parts[0] as MetalType;
      const purity = parts.slice(1).join('_'); // purity can contain underscores in theory

      const pRecord = periodMap.get(key) || {
        metalType,
        purity,
        opQty: 0,
        opVal: 0,
        inQty: 0,
        inVal: 0,
        outQty: 0,
        outVal: 0,
        outSaleVal: 0,
      };

      if (!startDate) {
        pRecord.opQty = 0;
        pRecord.opVal = 0;
      }

      const closingQty = pRecord.opQty + pRecord.inQty - pRecord.outQty;
      const denominator = pRecord.opQty + pRecord.inQty;
      const closingRate =
        denominator > 0
          ? (pRecord.opVal + pRecord.inVal) / denominator
          : pRecord.opQty > 0
            ? pRecord.opVal / pRecord.opQty
            : 0;
      const closingVal = closingQty * closingRate;

      results.push({
        metalType: pRecord.metalType,
        purity: pRecord.purity,
        opening: {
          quantity: pRecord.opQty,
          rate: pRecord.opQty > 0 ? pRecord.opVal / pRecord.opQty : 0,
          value: pRecord.opVal,
        },
        inwards: {
          quantity: pRecord.inQty,
          rate: pRecord.inQty > 0 ? pRecord.inVal / pRecord.inQty : 0,
          value: pRecord.inVal,
        },
        outwards: {
          quantity: pRecord.outQty,
          rate: pRecord.outQty > 0 ? pRecord.outSaleVal / pRecord.outQty : 0,
          value: pRecord.outSaleVal,
        },
        closing: {
          quantity: closingQty,
          rate: closingRate,
          value: closingVal,
        },
      });
    }

    return results;
  }

  /**
   * Replace SALE stock for an invoice: clear any prior net for this invoice, then
   * post SALE rows from the current line items. Use on finalize and on edit.
   */
  async syncSaleStockForInvoice(params: {
    organizationId: string;
    invoiceId: string;
    invoiceNumber: string;
    saleDate?: Date;
    items: any[];
    prismaTx?: Prisma.TransactionClient;
  }) {
    const { organizationId, invoiceId, invoiceNumber, saleDate, items, prismaTx } = params;

    await this.purgeTransactionsByReference(organizationId, invoiceId, prismaTx);

    for (const item of items || []) {
      const purity = item.purityLabel || item.purityValue || item.purity;
      const netWeight = Number(item.netWeight || 0);
      if (!item.metalType || !purity || netWeight <= 0) continue;

      await this.recordStockTransaction({
        organizationId,
        metalType: item.metalType as MetalType,
        purity: String(purity),
        transactionType: StockTransactionType.SALE,
        quantityOut: netWeight,
        rate: Number(item.effectiveRate || item.unitPrice || item.metalRate || 0),
        date: saleDate,
        referenceId: invoiceId,
        notes: `Sale from Invoice: ${invoiceNumber}`,
        prismaTx,
      });
    }
  }

  /**
   * Replace PURCHASE stock for a purchase bill: clear prior net, then post PURCHASE IN rows.
   */
  async syncPurchaseStockForInvoice(params: {
    organizationId: string;
    purchaseId: string;
    invoiceNumber?: string | null;
    purchaseDate?: Date;
    items: Array<{
      metalType: MetalType | string;
      purity: string;
      netWeight: number;
      rate?: number;
      itemName?: string | null;
    }>;
    prismaTx?: Prisma.TransactionClient;
  }) {
    const { organizationId, purchaseId, invoiceNumber, purchaseDate, items, prismaTx } = params;

    await this.purgeTransactionsByReference(organizationId, purchaseId, prismaTx);

    for (const item of items || []) {
      const purity = item.purity;
      const netWeight = Number(item.netWeight || 0);
      if (!item.metalType || !purity || netWeight <= 0) continue;

      await this.recordStockTransaction({
        organizationId,
        metalType: item.metalType as MetalType,
        purity: String(purity),
        transactionType: StockTransactionType.PURCHASE,
        quantityIn: netWeight,
        rate: item.rate != null ? Number(item.rate) : undefined,
        date: purchaseDate,
        referenceId: purchaseId,
        notes: `Purchase ${item.itemName || item.purity} from Bill: ${invoiceNumber || purchaseId}`,
        prismaTx,
      });
    }
  }

  /**
   * Hard-remove all ledger rows for a reference (e.g. deleted purchase).
   * Rebuilds running balances + StockBalance — no Adjustment ghost rows.
   */
  async purgeTransactionsByReference(
    organizationId: string,
    referenceId: string,
    prismaTx?: Prisma.TransactionClient,
  ) {
    const db = prismaTx || this.prisma;

    const entries = await db.stockLedger.findMany({
      where: { organizationId, referenceId },
      select: { metalType: true, purity: true },
    });
    if (!entries.length) return;

    const buckets = new Map<string, { metalType: MetalType; purity: string }>();
    for (const e of entries) {
      buckets.set(`${e.metalType}|${e.purity}`, {
        metalType: e.metalType,
        purity: e.purity,
      });
    }

    await db.stockLedger.deleteMany({ where: { organizationId, referenceId } });

    for (const { metalType, purity } of buckets.values()) {
      await this.recalcRunningBalances(organizationId, metalType, purity, db);
    }
  }

  private async recalcRunningBalances(
    organizationId: string,
    metalType: MetalType,
    purity: string,
    db: Prisma.TransactionClient | PrismaService,
  ) {
    const ledgerEntries = await db.stockLedger.findMany({
      where: { organizationId, metalType, purity },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    let currentRunning = 0;
    for (const entry of ledgerEntries) {
      const qtyIn = Number(entry.quantityIn);
      const qtyOut = Number(entry.quantityOut);
      currentRunning = currentRunning + qtyIn - qtyOut;

      await db.stockLedger.update({
        where: { id: entry.id },
        data: { runningBalance: currentRunning },
      });
    }

    await db.stockBalance.upsert({
      where: {
        organizationId_metalType_purity: { organizationId, metalType, purity },
      },
      create: { organizationId, metalType, purity, quantity: currentRunning },
      update: { quantity: currentRunning },
    });
  }

  async listPurities(organizationId: string, includeInactive = false) {
    await this.ensureDefaultPurities(organizationId);
    return this.prisma.orgMetalPurity.findMany({
      where: {
        organizationId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ metalType: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async createPurity(organizationId: string, metalType: MetalType, rawLabel: string) {
    if (metalType !== MetalType.GOLD && metalType !== MetalType.SILVER) {
      throw new BadRequestException('metalType must be GOLD or SILVER');
    }
    const label = String(rawLabel || '').trim();
    if (!label) throw new BadRequestException('label is required');

    await this.ensureDefaultPurities(organizationId);

    const existing = await this.prisma.orgMetalPurity.findFirst({
      where: {
        organizationId,
        metalType,
        label: { equals: label, mode: 'insensitive' },
      },
    });
    if (existing) {
      if (existing.isActive) {
        throw new BadRequestException(`Purity "${existing.label}" already exists for ${metalType}`);
      }
      return this.prisma.orgMetalPurity.update({
        where: { id: existing.id },
        data: { isActive: true, label },
      });
    }

    const maxSort = await this.prisma.orgMetalPurity.aggregate({
      where: { organizationId, metalType },
      _max: { sortOrder: true },
    });

    return this.prisma.orgMetalPurity.create({
      data: {
        organizationId,
        metalType,
        label,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async updatePurity(
    organizationId: string,
    id: string,
    data: { isActive?: boolean; sortOrder?: number },
  ) {
    const row = await this.prisma.orgMetalPurity.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundException('Purity not found');

    const patch: Prisma.OrgMetalPurityUpdateInput = {};
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.sortOrder !== undefined) {
      if (!Number.isFinite(data.sortOrder)) {
        throw new BadRequestException('sortOrder must be a number');
      }
      patch.sortOrder = Math.trunc(data.sortOrder);
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    return this.prisma.orgMetalPurity.update({
      where: { id },
      data: patch,
    });
  }

  async hidePurity(organizationId: string, id: string) {
    return this.updatePurity(organizationId, id, { isActive: false });
  }

  private async ensureDefaultPurities(organizationId: string) {
    const count = await this.prisma.orgMetalPurity.count({ where: { organizationId } });
    if (count > 0) return;

    const rows = [
      ...DEFAULT_PURITIES.GOLD.map((label, sortOrder) => ({
        organizationId,
        metalType: MetalType.GOLD,
        label,
        sortOrder,
      })),
      ...DEFAULT_PURITIES.SILVER.map((label, sortOrder) => ({
        organizationId,
        metalType: MetalType.SILVER,
        label,
        sortOrder,
      })),
    ];
    await this.prisma.orgMetalPurity.createMany({ data: rows, skipDuplicates: true });
  }

  normalizePurity(purity: string, metalType: string): string {
    const raw = String(purity || '')
      .toUpperCase()
      .trim();
    // "22.00" / "22.0" → "22"; keep labels like "22K"
    const p = raw.replace(/(\d+)\.0+$/, '$1');

    if (metalType === 'GOLD') {
      if (
        p === '24' ||
        p === '24K' ||
        p === '999' ||
        p === '24 CT' ||
        p.includes('24CT') ||
        p.includes('24K') ||
        /^24(\.0+)?$/.test(raw)
      )
        return '24K';
      if (
        p === '22' ||
        p === '22K' ||
        p === '916' ||
        p.includes('916') ||
        p.includes('22K') ||
        /^22(\.0+)?$/.test(raw)
      )
        return '22K';
      if (
        p === '20' ||
        p === '20K' ||
        p === '833' ||
        p.includes('833') ||
        p.includes('20K') ||
        /^20(\.0+)?$/.test(raw)
      )
        return '20K';
      if (
        p === '18' ||
        p === '18K' ||
        p === '750' ||
        p.includes('750') ||
        p.includes('18K') ||
        /^18(\.0+)?$/.test(raw)
      )
        return '18K';
    } else if (metalType === 'SILVER') {
      if (p === 'FINE' || p === 'F' || p === '999' || p === '99' || p.includes('FINE')) return 'F';
      if (p === '925' || p === 'STERLING' || p === '92.5' || p.includes('925')) return '925';
    }
    return p || raw || purity;
  }
}
