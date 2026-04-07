import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from 'decimal.js';
import { InvoiceStatus } from '@prisma/client';

export interface AdjustmentPreviewItem {
  id: string;
  description: string;
  originalMakingChargesAmt: Decimal;
  newMakingChargesAmt: Decimal;
  newMakingChargesRate: Decimal;
  newItemAmount: Decimal;
}

export interface AdjustmentPreview {
  targetAmount: Decimal;
  requiredTaxableAmount: Decimal;
  totalMakingReduction: Decimal;
  newGrandTotal: Decimal;
  roundOff: Decimal;
  feasible: boolean;
  reason?: string;
  minimumAchievableTotal?: Decimal;
  items: AdjustmentPreviewItem[];
}

@Injectable()
export class InvoiceNegotiationService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(invoiceId: string, organizationId: string, targetAmount: number): Promise<AdjustmentPreview> {
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

    const currentGrand = new Decimal(invoice.totalAmount);

    if (target.gte(currentGrand)) {
      throw new BadRequestException(
        `Target ₹${target.toFixed(2)} must be less than current ₹${currentGrand.toFixed(2)}`,
      );
    }

    // Back-solve: targetAmount = taxableAmount × (1 + gstRate/100)
    const gstMultiplier = new Decimal(1).plus(
      new Decimal(invoice.cgstRate)
        .plus(new Decimal(invoice.sgstRate))
        .plus(new Decimal(invoice.igstRate))
        .div(100),
    );

    const requiredTaxableRaw = target.div(gstMultiplier);
    const currentTaxable = new Decimal(invoice.taxableAmount ?? invoice.subtotal);
    const totalReduction = currentTaxable.minus(requiredTaxableRaw).toDecimalPlaces(4);

    // Only adjustable items are those with makingChargesAmount > 0
    const adjustable = invoice.items.filter(
      (i) => i.makingChargesAmount && new Decimal(i.makingChargesAmount).gt(0),
    );

    const totalCurrentMaking = adjustable.reduce(
      (s, i) => s.plus(new Decimal(i.makingChargesAmount!)),
      new Decimal(0),
    );

    // Floor check: can the reduction be absorbed entirely by making charges?
    if (totalReduction.gt(totalCurrentMaking)) {
      // Compute minimum achievable total (all making charges zeroed out)
      const nonMakingSubtotal = invoice.items.reduce(
        (s, i) =>
          s.plus(new Decimal(i.taxableAmount).minus(new Decimal(i.makingChargesAmount ?? 0))),
        new Decimal(0),
      );
      const minTaxable = nonMakingSubtotal.toDecimalPlaces(2);
      const minRaw = minTaxable.mul(gstMultiplier);
      const minTotal = minRaw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

      return {
        targetAmount: target,
        requiredTaxableAmount: requiredTaxableRaw.toDecimalPlaces(2),
        totalMakingReduction: totalReduction,
        newGrandTotal: currentGrand,
        roundOff: new Decimal(invoice.roundOff),
        feasible: false,
        items: [],
        minimumAchievableTotal: minTotal,
        reason:
          `Discount requires reducing making charges by ₹${totalReduction.toFixed(2)} ` +
          `but total making charges are only ₹${totalCurrentMaking.toFixed(2)}. ` +
          `Minimum achievable total is ₹${minTotal}.`,
      };
    }

    // Distribute reduction proportionally across items by makingChargesAmount
    const adjustedItems: AdjustmentPreviewItem[] = adjustable.map((item) => {
      const currentAmt = new Decimal(item.makingChargesAmount!);
      const share = currentAmt.div(totalCurrentMaking);
      const reduction = totalReduction.mul(share).toDecimalPlaces(4);
      const newAmt = currentAmt.minus(reduction).toDecimalPlaces(4);

      const netWeight = new Decimal(item.netWeight ?? item.grossWeight ?? 1);
      const newRate =
        item.makingChargesType === 'PER_GRAM'
          ? newAmt.div(netWeight).toDecimalPlaces(4)
          : new Decimal(item.makingCharges ?? 0);

      const nonMaking = new Decimal(item.taxableAmount).minus(currentAmt);
      const newItemAmt = nonMaking.plus(newAmt).toDecimalPlaces(4);

      return {
        id: item.id,
        description: item.description,
        originalMakingChargesAmt: currentAmt,
        newMakingChargesAmt: newAmt,
        newMakingChargesRate: newRate,
        newItemAmount: newItemAmt,
      };
    });

    // Recompute invoice totals with adjusted items
    const adjustedSubtotal = adjustedItems.reduce(
      (s, i) => s.plus(i.newItemAmount),
      new Decimal(0),
    );
    const unchangedSubtotal = invoice.items
      .filter((i) => !i.makingChargesAmount || new Decimal(i.makingChargesAmount).eq(0))
      .reduce((s, i) => s.plus(new Decimal(i.taxableAmount)), new Decimal(0));

    const newTaxable = adjustedSubtotal.plus(unchangedSubtotal).toDecimalPlaces(2);
    const newCgst = newTaxable.mul(new Decimal(invoice.cgstRate)).div(100).toDecimalPlaces(2);
    const newSgst = newTaxable.mul(new Decimal(invoice.sgstRate)).div(100).toDecimalPlaces(2);
    const newIgst = newTaxable.mul(new Decimal(invoice.igstRate)).div(100).toDecimalPlaces(2);
    const rawGrand = newTaxable.plus(newCgst).plus(newSgst).plus(newIgst);
    const newGrand = rawGrand.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const newRoundOff = newGrand.minus(rawGrand).toDecimalPlaces(2);

    return {
      targetAmount: target,
      requiredTaxableAmount: newTaxable,
      totalMakingReduction: totalReduction.toDecimalPlaces(2),
      newGrandTotal: newGrand,
      roundOff: newRoundOff,
      feasible: true,
      items: adjustedItems,
    };
  }

  async commit(
    invoiceId: string,
    organizationId: string,
    targetAmount: number,
    approvedById: string,
    note?: string,
  ): Promise<void> {
    const preview = await this.preview(invoiceId, organizationId, targetAmount);

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
        // Subsequent negotiations: just update the note
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
            originalItemAmount: original.originalItemAmount ?? original.taxableAmount,
            // Apply adjusted values
            makingCharges: adj.newMakingChargesRate,
            makingChargesAmount: adj.newMakingChargesAmt,
            taxableAmount: adj.newItemAmount,
            totalAmount: adj.newItemAmount,
          },
        });
      }

      // Recompute and update invoice totals
      const newCgst = preview.requiredTaxableAmount
        .mul(new Decimal(invoice.cgstRate))
        .div(100)
        .toDecimalPlaces(2);
      const newSgst = preview.requiredTaxableAmount
        .mul(new Decimal(invoice.sgstRate))
        .div(100)
        .toDecimalPlaces(2);
      const newIgst = preview.requiredTaxableAmount
        .mul(new Decimal(invoice.igstRate))
        .div(100)
        .toDecimalPlaces(2);

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
          discountAmount: new Decimal(invoice.isNegotiated ? invoice.originalGrandTotal! : invoice.totalAmount)
            .minus(preview.newGrandTotal)
            .toDecimalPlaces(2),
        },
      });
    });
  }
}
