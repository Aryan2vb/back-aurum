import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { MakingChargesType, TaxType } from '@prisma/client';

export interface ItemInput {
  quantity: string | number | Decimal;
  metalRate: string | number | Decimal;
  purityValue: string | number | Decimal;
  purityBasis: number;
  grossWeight: string | number | Decimal;
  stoneWeight: string | number | Decimal;
  makingCharges: string | number | Decimal;
  makingChargesType: MakingChargesType;
  stoneCharges: string | number | Decimal;
  isHallmarked: boolean;
  hallmarkingCharge: string | number | Decimal;
}

export interface ComputedItem {
  netWeight: Decimal;
  effectiveRate: Decimal;
  metalValue: Decimal;
  makingChargesAmount: Decimal;
  hallmarkingCharge: Decimal;
  itemAmount: Decimal; // Pre-tax amount (taxable amount)
}

export interface InvoiceTotals {
  subtotal: Decimal;
  taxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  totalHallmarkingCharges: Decimal;
  grandTotal: Decimal;
  roundOff: Decimal;
}

@Injectable()
export class InvoiceCalculationService {
  /**
   * Computes individual item financials
   */
  computeItem(input: ItemInput): ComputedItem {
    const quantity = new Decimal(input.quantity || 1);
    const metalRate = new Decimal(input.metalRate);
    const grossWeight = new Decimal(input.grossWeight);
    const stoneWeight = new Decimal(input.stoneWeight || 0);
    const makingCharges = new Decimal(input.makingCharges || 0);
    const stoneCharges = new Decimal(input.stoneCharges || 0);
    const hallmarkingCharge = input.isHallmarked
      ? new Decimal(input.hallmarkingCharge || 0).mul(quantity)
      : new Decimal(0);

    // 1. Calculate weights
    const netWeight = Decimal.max(0, grossWeight.minus(stoneWeight));

    // 2. Calculate effective rate
    // Per user request: Metal rate is already for the specific carat, so no conversion needed.
    const effectiveRate = metalRate;

    // 3. Calculate metal value
    const metalValue = effectiveRate.mul(netWeight).toDecimalPlaces(4);

    // 4. Calculate resolved making charges amount
    let makingChargesAmount = new Decimal(0);
    switch (input.makingChargesType) {
      case MakingChargesType.PER_GRAM:
        makingChargesAmount = makingCharges.mul(netWeight);
        break;
      case MakingChargesType.FLAT_PER_ITEM:
        makingChargesAmount = makingCharges.mul(quantity);
        break;
      case MakingChargesType.PERCENTAGE_ON_METAL:
        makingChargesAmount = metalValue.mul(makingCharges.div(100));
        break;
    }
    makingChargesAmount = makingChargesAmount.toDecimalPlaces(4);

    // 5. Total pre-tax item amount
    // per prompt: effectiveRate * netWeight + makingChargesAmount + stoneCharges + hallmarkingCharge
    const itemAmount = metalValue
      .plus(makingChargesAmount)
      .plus(stoneCharges)
      .plus(hallmarkingCharge)
      .toDecimalPlaces(4);

    return {
      netWeight,
      effectiveRate,
      metalValue,
      makingChargesAmount,
      hallmarkingCharge,
      itemAmount,
    };
  }

  /**
   * Computes invoice-level totals and taxes
   */
  computeInvoiceTotals(
    items: ComputedItem[],
    taxType: TaxType,
    gstRates: { cgst: string; sgst: string; igst: string },
  ): InvoiceTotals {
    let subtotal = new Decimal(0);
    let totalHallmarkingCharges = new Decimal(0);

    for (const item of items) {
      subtotal = subtotal.plus(item.itemAmount);
      totalHallmarkingCharges = totalHallmarkingCharges.plus(item.hallmarkingCharge);
    }

    const taxableAmount = subtotal; // Assuming all pre-tax is taxable
    let cgstAmount = new Decimal(0);
    let sgstAmount = new Decimal(0);
    let igstAmount = new Decimal(0);

    if (taxType === TaxType.CGST_SGST) {
      cgstAmount = taxableAmount.mul(new Decimal(gstRates.cgst).div(100)).toDecimalPlaces(2);
      sgstAmount = taxableAmount.mul(new Decimal(gstRates.sgst).div(100)).toDecimalPlaces(2);
    } else if (taxType === TaxType.IGST) {
      igstAmount = taxableAmount.mul(new Decimal(gstRates.igst).div(100)).toDecimalPlaces(2);
    }

    const totalBeforeRoundOff = taxableAmount.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);
    const grandTotal = totalBeforeRoundOff.toDecimalPlaces(0); // Standard round to 0
    const roundOff = grandTotal.minus(totalBeforeRoundOff).toDecimalPlaces(2);

    return {
      subtotal,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalHallmarkingCharges, // Filled later if needed or derived from items
      grandTotal,
      roundOff,
    };
  }
}
