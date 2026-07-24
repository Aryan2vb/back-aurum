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
      const oldQty = Number(existingOB.quantityIn);
      const deltaQty = quantity - oldQty;
      const totalValue = rate ? rate * quantity : null;
      const parsedDate = date ? new Date(date) : existingOB.date;

      return this.prisma.$transaction(async (tx) => {
        // 1. Update the opening balance record
        const updatedOB = await tx.stockLedger.update({
          where: { id: existingOB.id },
          data: {
            quantityIn: quantity,
            rate,
            totalValue,
            date: parsedDate,
          },
        });

        // 2. Recalculate running balances for all entries chronologically
        const ledgerEntries = await tx.stockLedger.findMany({
          where: {
            organizationId,
            metalType,
            purity: normalizedPurity,
          },
          orderBy: { date: 'asc' },
        });

        let currentRunning = 0;
        for (const entry of ledgerEntries) {
          const qtyIn = Number(entry.quantityIn);
          const qtyOut = Number(entry.quantityOut);
          
          if (entry.transactionType === StockTransactionType.OPENING_BALANCE) {
            currentRunning = qtyIn; // use the updated opening balance quantity
          } else {
            currentRunning = currentRunning + qtyIn - qtyOut;
          }

          await tx.stockLedger.update({
            where: { id: entry.id },
            data: { runningBalance: currentRunning },
          });
        }

        // 3. Update the StockBalance
        const balance = await tx.stockBalance.findUnique({
          where: {
            organizationId_metalType_purity: {
              organizationId,
              metalType,
              purity: normalizedPurity,
            },
          },
        });

        if (balance) {
          await tx.stockBalance.update({
            where: { id: balance.id },
            data: { quantity: Number(balance.quantity) + deltaQty },
          });
        }

        return updatedOB;
      });
    } else {
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
  }

  async getGroupSummary(organizationId: string, startDateStr?: string, endDateStr?: string) {
    const startDate = startDateStr ? new Date(startDateStr) : null;
    const endDate = endDateStr ? new Date(endDateStr) : null;

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

      if (entry.transactionType === StockTransactionType.OPENING_BALANCE || entry.transactionType === StockTransactionType.PURCHASE) {
        const newQty = state.qty + qtyIn;
        const newCostVal = state.val + (qtyIn * transactionRate);
        state.qty = newQty;
        state.val = newCostVal;
        state.avgRate = newQty > 0 ? newCostVal / newQty : 0;
      } else if (entry.transactionType === StockTransactionType.SALE) {
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
          pRecord.opVal += (qtyIn * transactionRate);
        } else if (entry.transactionType === StockTransactionType.PURCHASE) {
          pRecord.inQty += qtyIn;
          pRecord.inVal += (qtyIn * transactionRate);
        } else if (entry.transactionType === StockTransactionType.SALE) {
          pRecord.outQty += qtyOut;
          pRecord.outSaleVal += (qtyOut * transactionRate);
          pRecord.outVal += (qtyOut * state.avgRate);
        }
      }
    }

    const results = [];
    const allKeys = new Set([...stateMap.keys(), ...periodMap.keys()]);

    for (const key of allKeys) {
      const parts = key.split('_');
      const metalType = parts[0] as MetalType;
      const purity = parts[1];

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
   * Reverse SALE rows posted for a reference (invoice id). Idempotent: skips if a
   * Reversal: ledger row already exists for the same referenceId.
   */
  async reverseTransactionsByReference(
    organizationId: string,
    referenceId: string,
    prismaTx?: Prisma.TransactionClient,
  ) {
    const db = prismaTx || this.prisma;

    const alreadyReversed = await db.stockLedger.findFirst({
      where: {
        organizationId,
        referenceId,
        transactionType: StockTransactionType.ADJUSTMENT,
        notes: { startsWith: 'Reversal:' },
      },
    });
    if (alreadyReversed) return;

    const sales = await db.stockLedger.findMany({
      where: {
        organizationId,
        referenceId,
        transactionType: StockTransactionType.SALE,
      },
    });

    for (const sale of sales) {
      const qtyOut = Number(sale.quantityOut || 0);
      if (qtyOut <= 0) continue;

      await this.recordStockTransaction({
        organizationId,
        metalType: sale.metalType,
        purity: sale.purity,
        transactionType: StockTransactionType.ADJUSTMENT,
        quantityIn: qtyOut,
        rate: sale.rate != null ? Number(sale.rate) : undefined,
        referenceId,
        notes: `Reversal: ${sale.notes || referenceId}`,
        prismaTx,
      });
    }
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
