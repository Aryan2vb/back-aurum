import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockTransactionType, MetalType, Prisma } from '@prisma/client';

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

    const db = params.prismaTx || this.prisma;

    // We can use a unique constraint upsert to get or create the balance.
    let currentBalance = await db.stockBalance.findUnique({
      where: {
        organizationId_metalType_purity: {
          organizationId,
          metalType,
          purity,
        },
      },
    });

    if (!currentBalance) {
      currentBalance = await db.stockBalance.create({
        data: {
          organizationId,
          metalType,
          purity,
          quantity: 0,
        },
      });
    }

    const newQuantity = Number(currentBalance.quantity) + quantityIn - quantityOut;

    if (newQuantity < 0) {
      console.warn(`[StockService] Negative stock warning for ${purity} ${metalType}. New balance: ${newQuantity}`);
    }

    // Update Balance
    await db.stockBalance.update({
      where: { id: currentBalance.id },
      data: { quantity: newQuantity },
    });

    const totalValue = rate ? rate * (quantityIn || quantityOut) : null;

    // Create Ledger Entry
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

    return { balance: newQuantity, ledgerEntry };
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
      orderBy: { createdAt: 'desc' },
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

    // Check if an opening balance already exists
    const existingOB = await this.prisma.stockLedger.findFirst({
      where: {
        organizationId,
        metalType,
        purity: normalizedPurity,
        transactionType: StockTransactionType.OPENING_BALANCE,
      },
    });

    if (existingOB) {
      const totalValue = rate ? rate * quantity : null;
      const parsedDate = date ? new Date(date) : existingOB.date;

      return this.prisma.$transaction(async (tx) => {
        const updatedOB = await tx.stockLedger.update({
          where: { id: existingOB.id },
          data: {
            quantityIn: quantity,
            rate,
            totalValue,
            date: parsedDate,
          },
        });

        await this.recalcRunningBalances(
          organizationId,
          metalType,
          normalizedPurity,
          tx,
        );

        return updatedOB;
      });
    }

    return this.recordStockTransaction({
      organizationId,
      metalType,
      purity: normalizedPurity,
      transactionType: StockTransactionType.OPENING_BALANCE,
      quantityIn: quantity,
      rate,
      date: date ? new Date(date) : undefined,
      notes: 'Initial Opening Balance',
    });
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
    const periodMap = new Map<string, {
      metalType: MetalType;
      purity: string;
      opQty: number;
      opVal: number;
      inQty: number;
      inVal: number;
      outQty: number;
      outVal: number;
      outSaleVal: number;
    }>();

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
      const closingRate = denominator > 0 ? (pRecord.opVal + pRecord.inVal) / denominator : (pRecord.opQty > 0 ? pRecord.opVal / pRecord.opQty : 0);
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
   * Zero out all stock movements for a reference (invoice id) by posting
   * ADJUSTMENT rows for the remaining net out/(in). Safe to call repeatedly.
   */
  async reverseTransactionsByReference(
    organizationId: string,
    referenceId: string,
    prismaTx?: Prisma.TransactionClient,
    notesPrefix = 'Reversal:',
  ) {
    const db = prismaTx || this.prisma;

    const entries = await db.stockLedger.findMany({
      where: { organizationId, referenceId },
    });

    const nets = new Map<
      string,
      { metalType: MetalType; purity: string; netOut: number; rate?: number }
    >();

    for (const entry of entries) {
      const key = `${entry.metalType}|${entry.purity}`;
      const cur = nets.get(key) || {
        metalType: entry.metalType,
        purity: entry.purity,
        netOut: 0,
        rate: undefined as number | undefined,
      };
      cur.netOut += Number(entry.quantityOut || 0) - Number(entry.quantityIn || 0);
      if (entry.rate != null) cur.rate = Number(entry.rate);
      nets.set(key, cur);
    }

    for (const row of nets.values()) {
      if (Math.abs(row.netOut) < 1e-9) continue;

      if (row.netOut > 0) {
        await this.recordStockTransaction({
          organizationId,
          metalType: row.metalType,
          purity: row.purity,
          transactionType: StockTransactionType.ADJUSTMENT,
          quantityIn: row.netOut,
          rate: row.rate,
          referenceId,
          notes: `${notesPrefix} ${referenceId}`,
          prismaTx,
        });
      } else {
        await this.recordStockTransaction({
          organizationId,
          metalType: row.metalType,
          purity: row.purity,
          transactionType: StockTransactionType.ADJUSTMENT,
          quantityOut: -row.netOut,
          rate: row.rate,
          referenceId,
          notes: `${notesPrefix} ${referenceId}`,
          prismaTx,
        });
      }
    }
  }

  /**
   * Replace SALE stock for an invoice: clear any prior net for this invoice, then
   * post SALE rows from the current line items. Use on finalize and on edit.
   */
  async syncSaleStockForInvoice(params: {
    organizationId: string;
    invoiceId: string;
    invoiceNumber: string;
    items: any[];
    prismaTx?: Prisma.TransactionClient;
  }) {
    const { organizationId, invoiceId, invoiceNumber, items, prismaTx } = params;

    await this.reverseTransactionsByReference(
      organizationId,
      invoiceId,
      prismaTx,
      'Reversal:',
    );

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

    await this.reverseTransactionsByReference(
      organizationId,
      purchaseId,
      prismaTx,
      'Reversal:',
    );

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

      if (entry.transactionType === StockTransactionType.OPENING_BALANCE) {
        currentRunning = qtyIn;
      } else {
        currentRunning = currentRunning + qtyIn - qtyOut;
      }

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

  normalizePurity(purity: string, metalType: string): string {
    const raw = String(purity || '').toUpperCase().trim();
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
      if (p === '22' || p === '22K' || p === '916' || p.includes('916') || p.includes('22K') || /^22(\.0+)?$/.test(raw))
        return '22K';
      if (p === '20' || p === '20K' || p === '833' || p.includes('833') || p.includes('20K') || /^20(\.0+)?$/.test(raw))
        return '20K';
      if (p === '18' || p === '18K' || p === '750' || p.includes('750') || p.includes('18K') || /^18(\.0+)?$/.test(raw))
        return '18K';
    } else if (metalType === 'SILVER') {
      if (p === 'FINE' || p === 'F' || p === '999' || p === '99' || p.includes('FINE')) return 'F';
      if (p === '925' || p === 'STERLING' || p === '92.5' || p.includes('925')) return '925';
    }
    return p || raw || purity;
  }
}
