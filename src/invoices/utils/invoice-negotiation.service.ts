import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from 'decimal.js';
import { InvoiceStatus, MetalType, TaxType } from '@prisma/client';

export enum NegotiationMode {
  MAKING_CHARGES = 'MAKING_CHARGES',
  METAL_RATE = 'METAL_RATE',
}

export interface AdjustmentPreviewItem {
  id: string;
  description: string;
  // Making Charges
  originalMakingChargesAmt: Decimal;
  newMakingChargesAmt: Decimal;
  newMakingChargesRate: Decimal;
  // Metal Rates (new)
  originalMetalRate: Decimal;
  newMetalRate: Decimal;
  originalEffectiveRate: Decimal;
  newEffectiveRate: Decimal;
  // Totals
  newItemAmount: Decimal;
}

export interface AdjustmentPreview {
  targetAmount: Decimal;
  requiredTaxableAmount: Decimal;
  totalMakingReduction: Decimal;
  totalMetalReduction: Decimal; // Added
  newGrandTotal: Decimal;
  roundOff: Decimal;
  feasible: boolean;
  reason?: string;
  minimumAchievableTotal?: Decimal;
  items: AdjustmentPreviewItem[];
  mode: NegotiationMode; // Added
  metalType?: MetalType; // Added
}

@Injectable()
export class InvoiceNegotiationService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(
    invoiceId: string,
    organizationId: string,
    targetAmount: number,
    mode: NegotiationMode = NegotiationMode.MAKING_CHARGES,
    metalType?: MetalType,
  ): Promise<AdjustmentPreview> {
    const target = new Decimal(targetAmount);

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId, deletedAt: null },
      include: { items: true },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be negotiated');
    }

    const gstRate =
      invoice.taxType === TaxType.IGST
        ? new Decimal(invoice.igstRate)
        : new Decimal(invoice.cgstRate).plus(new Decimal(invoice.sgstRate));

    const gstMultiplier = new Decimal(1).plus(gstRate.div(100));

    // Calculate current taxable from items to be robust against header mismatches
    const currentTaxable = invoice.items.reduce(
      (sum, item) => sum.plus(new Decimal(item.taxableAmount)),
      new Decimal(0)
    );

    const currentGrand = currentTaxable.mul(gstMultiplier).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

    if (target.gte(currentGrand)) {
      throw new BadRequestException(
        `Target ₹${target.toFixed(2)} must be less than current ₹${currentGrand.toFixed(2)}`,
      );
    }

    const requiredTaxableRaw = target.div(gstMultiplier);
    const totalReduction = currentTaxable.minus(requiredTaxableRaw).toDecimalPlaces(4);

    let adjustableItems = invoice.items;
    let totalCurrentPool = new Decimal(0);

    if (mode === NegotiationMode.MAKING_CHARGES) {
      adjustableItems = invoice.items.filter(
        (i) => i.makingChargesAmount && new Decimal(i.makingChargesAmount).gt(0),
      );
      totalCurrentPool = adjustableItems.reduce(
        (s, i) => s.plus(new Decimal(i.makingChargesAmount!)),
        new Decimal(0),
      );
    } else {
      // METAL_RATE mode
      adjustableItems = invoice.items.filter((i) => {
        const hasValue = i.metalRate && new Decimal(i.metalRate).gt(0);
        const matchesType = !metalType || i.metalType === metalType;
        return hasValue && matchesType;
      });
      totalCurrentPool = adjustableItems.reduce(
        (s, i) =>
          s.plus(
            new Decimal(i.effectiveRate ?? i.metalRate ?? 0).mul(
              new Decimal(i.netWeight ?? i.grossWeight ?? 0),
            ),
          ),
        new Decimal(0),
      );
    }

    // Floor check: can the reduction be absorbed entirely by the chosen pool?
    if (totalReduction.gt(totalCurrentPool)) {
      const minTaxable = currentTaxable.minus(totalCurrentPool);
      const minRaw = minTaxable.mul(gstMultiplier);
      const minTotal = minRaw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

      const poolLabel = mode === NegotiationMode.MAKING_CHARGES ? 'making charges' : 'metal value';

      return {
        targetAmount: target,
        requiredTaxableAmount: minTaxable.toDecimalPlaces(2),
        totalMakingReduction:
          mode === NegotiationMode.MAKING_CHARGES ? totalReduction : new Decimal(0),
        totalMetalReduction: mode === NegotiationMode.METAL_RATE ? totalReduction : new Decimal(0),
        newGrandTotal: currentGrand,
        roundOff: new Decimal(invoice.roundOff),
        feasible: false,
        items: [],
        minimumAchievableTotal: minTotal,
        mode,
        metalType,
        reason:
          `Discount requires reducing ${poolLabel} by ₹${totalReduction.toFixed(2)} ` +
          `but total ${poolLabel} available is only ₹${totalCurrentPool.toFixed(2)}. ` +
          `Minimum achievable total is ₹${minTotal}.`,
      };
    }

    // Distribute reduction proportionally
    const adjustedItems: AdjustmentPreviewItem[] = adjustableItems.map((item) => {
      const netWeight = new Decimal(item.netWeight ?? item.grossWeight ?? 1);
      const currentMakingAmt = new Decimal(item.makingChargesAmount || 0);
      const currentMetalValue = new Decimal(item.effectiveRate ?? item.metalRate ?? 0).mul(
        netWeight,
      );

      let reduction = new Decimal(0);
      let newMakingAmt = currentMakingAmt;
      let newMakingRate = new Decimal(item.makingCharges || 0);
      let newMetalRate = new Decimal(item.metalRate || 0);
      let newEffectiveRate = new Decimal(item.effectiveRate || item.metalRate || 0);

      if (mode === NegotiationMode.MAKING_CHARGES) {
        const share = totalCurrentPool.isZero() ? new Decimal(0) : currentMakingAmt.div(totalCurrentPool);
        reduction = totalReduction.mul(share).toDecimalPlaces(4);
        newMakingAmt = currentMakingAmt.minus(reduction).toDecimalPlaces(4);
        newMakingRate =
          item.makingChargesType === 'PER_GRAM'
            ? (netWeight.isZero() ? new Decimal(0) : newMakingAmt.div(netWeight).toDecimalPlaces(4))
            : new Decimal(item.makingCharges ?? 0);
      } else {
        const share = totalCurrentPool.isZero() ? new Decimal(0) : currentMetalValue.div(totalCurrentPool);
        reduction = totalReduction.mul(share).toDecimalPlaces(4);
        const newMetalValue = currentMetalValue.minus(reduction).toDecimalPlaces(4);

        // Rate reduction: NewRate = OldRate * (NewValue / OldValue)
        const factor = currentMetalValue.isZero() ? new Decimal(1) : newMetalValue.div(currentMetalValue);
        newMetalRate = new Decimal(item.metalRate || 0).mul(factor).toDecimalPlaces(4);
        newEffectiveRate = new Decimal(item.effectiveRate || item.metalRate || 0)
          .mul(factor)
          .toDecimalPlaces(4);
      }

      const nonAdjustedPart = new Decimal(item.taxableAmount).minus(
        mode === NegotiationMode.MAKING_CHARGES ? currentMakingAmt : currentMetalValue,
      );

      const newItemAmt = nonAdjustedPart
        .plus(
          mode === NegotiationMode.MAKING_CHARGES
            ? newMakingAmt
            : currentMetalValue.minus(reduction),
        )
        .toDecimalPlaces(4);

      return {
        id: item.id,
        description: item.description,
        originalMakingChargesAmt: currentMakingAmt,
        newMakingChargesAmt: newMakingAmt,
        newMakingChargesRate: newMakingRate,
        originalMetalRate: new Decimal(item.metalRate || 0),
        newMetalRate: newMetalRate,
        originalEffectiveRate: new Decimal(item.effectiveRate || item.metalRate || 0),
        newEffectiveRate: newEffectiveRate,
        newItemAmount: newItemAmt,
      };
    });

    // Recompute invoice totals
    const adjustedIdSet = new Set(adjustedItems.map((i) => i.id));
    const adjustedSubtotal = adjustedItems.reduce(
      (s, i) => s.plus(i.newItemAmount),
      new Decimal(0),
    );
    const unchangedSubtotal = invoice.items
      .filter((i) => !adjustedIdSet.has(i.id))
      .reduce((s, i) => s.plus(new Decimal(i.taxableAmount)), new Decimal(0));

    const newTaxable = adjustedSubtotal.plus(unchangedSubtotal).toDecimalPlaces(2);
    let newCgst = new Decimal(0);
    let newSgst = new Decimal(0);
    let newIgst = new Decimal(0);

    if (invoice.taxType === TaxType.IGST) {
      newIgst = newTaxable.mul(new Decimal(invoice.igstRate)).div(100).toDecimalPlaces(2);
    } else {
      newCgst = newTaxable.mul(new Decimal(invoice.cgstRate)).div(100).toDecimalPlaces(2);
      newSgst = newTaxable.mul(new Decimal(invoice.sgstRate)).div(100).toDecimalPlaces(2);
    }

    const rawGrand = newTaxable.plus(newCgst).plus(newSgst).plus(newIgst);
    const newGrand = rawGrand.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const newRoundOff = newGrand.minus(rawGrand).toDecimalPlaces(2);

    return {
      targetAmount: target,
      requiredTaxableAmount: newTaxable,
      totalMakingReduction:
        mode === NegotiationMode.MAKING_CHARGES
          ? totalReduction.toDecimalPlaces(2)
          : new Decimal(0),
      totalMetalReduction:
        mode === NegotiationMode.METAL_RATE ? totalReduction.toDecimalPlaces(2) : new Decimal(0),
      newGrandTotal: newGrand,
      roundOff: newRoundOff,
      feasible: true,
      items: adjustedItems,
      mode,
      metalType,
    };
  }

  async commit(
    invoiceId: string,
    organizationId: string,
    targetAmount: number,
    approvedById: string,
    mode: NegotiationMode = NegotiationMode.MAKING_CHARGES,
    metalType?: MetalType,
    note?: string,
  ): Promise<void> {
    const preview = await this.preview(invoiceId, organizationId, targetAmount, mode, metalType);

    if (!preview.feasible) {
      throw new BadRequestException(preview.reason);
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId, deletedAt: null },
      include: { items: true },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Snapshot original totals on first negotiation only
      if (!invoice.isNegotiated) {
        await tx.invoice.update({
          where: { id: invoiceId, organizationId },
          data: {
            isNegotiated: true,
            negotiatedBy: approvedById,
            negotiationNote: note,
            originalSubtotal: invoice.subtotal,
            originalTaxableAmount: invoice.taxableAmount ?? invoice.subtotal,
            originalCgstAmount: invoice.cgstAmount,
            originalSgstAmount: invoice.sgstAmount,
            originalIgstAmount: invoice.igstAmount,
            originalGrandTotal: invoice.totalAmount,
          },
        });
      } else {
        await tx.invoice.update({
          where: { id: invoiceId, organizationId },
          data: {
            negotiatedBy: approvedById,
            negotiationNote: note,
          },
        });
      }

      // Update each adjusted item
      for (const adj of preview.items) {
        const original = invoice.items.find((i) => i.id === adj.id)!;
        await tx.invoiceItem.update({
          where: { id: adj.id, organizationId },
          data: {
            // Snapshot originals (only first negotiation — don't overwrite)
            originalMakingCharges: original.originalMakingCharges ?? original.makingCharges,
            originalMakingChargesAmount:
              original.originalMakingChargesAmount ?? original.makingChargesAmount,
            originalMetalRate: original.originalMetalRate ?? original.metalRate,
            originalEffectiveRate: original.originalEffectiveRate ?? original.effectiveRate,
            originalItemAmount: original.originalItemAmount ?? original.taxableAmount,

            // Apply adjusted values
            makingCharges: adj.newMakingChargesRate,
            makingChargesAmount: adj.newMakingChargesAmt,
            metalRate: adj.newMetalRate,
            effectiveRate: adj.newEffectiveRate,
            taxableAmount: adj.newItemAmount,
            totalAmount: adj.newItemAmount,
          },
        });
      }

      // Recompute and update invoice totals
      const newTaxable = preview.requiredTaxableAmount;
      let newCgst = new Decimal(0);
      let newSgst = new Decimal(0);
      let newIgst = new Decimal(0);

      if (invoice.taxType === TaxType.IGST) {
        newIgst = newTaxable.mul(new Decimal(invoice.igstRate)).div(100).toDecimalPlaces(2);
      } else {
        newCgst = newTaxable.mul(new Decimal(invoice.cgstRate)).div(100).toDecimalPlaces(2);
        newSgst = newTaxable.mul(new Decimal(invoice.sgstRate)).div(100).toDecimalPlaces(2);
      }

      await tx.invoice.update({
        where: { id: invoiceId, organizationId },
        data: {
          subtotal: preview.requiredTaxableAmount,
          taxableAmount: preview.requiredTaxableAmount,
          cgstAmount: newCgst,
          sgstAmount: newSgst,
          igstAmount: newIgst,
          roundOff: preview.roundOff,
          totalAmount: preview.newGrandTotal,
          discountAmount: new Decimal(
            invoice.isNegotiated ? invoice.originalGrandTotal! : invoice.totalAmount,
          )
            .minus(preview.newGrandTotal)
            .toDecimalPlaces(2),
        },
      });
    });
  }
}
