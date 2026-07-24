import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockTransactionType, MetalType, TaxType } from '@prisma/client';

type PurchaseItemInput = {
  itemName?: string;
  metalType: MetalType;
  purity: string;
  grossWeight?: number;
  netWeight?: number;
  rate?: number;
};

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
  ) {}

  async createPurchase(data: {
    organizationId: string;
    vendorId?: string;
    vendorName?: string;
    invoiceNumber?: string;
    billSeries?: string;
    purchaseDate?: string;
    dueDate?: string;
    metalType: MetalType;
    purity: string;
    totalWeight: number;
    rate?: number;
    totalAmount?: number;
    addGst?: boolean;
    gstInclusive?: boolean;
    taxType?: TaxType;
    cgstRate?: number;
    sgstRate?: number;
    igstRate?: number;
    notes?: string;
    items?: PurchaseItemInput[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      let finalVendorId = data.vendorId;
      const purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : new Date();
      const itemInputs = this.normalizeItems(data);
      const computed = this.computeTotals(itemInputs, data);

      let vendorData = null;
      if (!finalVendorId && data.vendorName) {
        // Find or create vendor by name
        let vendor = await tx.vendor.findFirst({
          where: {
            organizationId: data.organizationId,
            name: {
              equals: data.vendorName.trim(),
              mode: 'insensitive',
            },
          },
        });

        if (!vendor) {
          vendor = await tx.vendor.create({
            data: {
              organizationId: data.organizationId,
              name: data.vendorName.trim(),
            },
          });
        }
        finalVendorId = vendor.id;
        vendorData = vendor;
      } else if (finalVendorId) {
        vendorData = await tx.vendor.findUnique({ where: { id: finalVendorId } });
      }

      // 1. Create Purchase Invoice
      const purchase = await tx.purchaseInvoice.create({
        data: {
          organizationId: data.organizationId,
          vendorId: finalVendorId,
          vendorName: vendorData?.name,
          vendorGstin: vendorData?.gstin,
          vendorStateCode: vendorData?.stateCode,
          vendorStateName: vendorData?.stateName,
          invoiceNumber: data.invoiceNumber,
          billSeries: data.billSeries,
          purchaseDate,
          dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
          metalType: computed.primaryMetalType,
          purity: computed.primaryPurity,
          totalWeight: computed.totalWeight,
          rate: computed.primaryRate,
          totalAmount: computed.grandTotal,
          taxableAmount: computed.taxableAmount,
          taxType: data.taxType || 'CGST_SGST',
          cgstRate: computed.cgstRate,
          sgstRate: computed.sgstRate,
          igstRate: computed.igstRate,
          cgstAmount: computed.cgstAmount,
          sgstAmount: computed.sgstAmount,
          igstAmount: computed.igstAmount,
          grandTotal: computed.grandTotal,
          addGst: !!data.addGst,
          gstInclusive: !!data.gstInclusive,
          totalGoldWeight: computed.totalGoldWeight,
          totalSilverWeight: computed.totalSilverWeight,
          totalMetalAmount: computed.totalMetalAmount,
          notes: data.notes,
          items: {
            create: computed.items.map((item, index) => ({
              organizationId: data.organizationId,
              slNo: index + 1,
              itemName: item.itemName,
              metalType: item.metalType,
              purity: item.purity,
              grossWeight: item.grossWeight,
              netWeight: item.netWeight,
              rate: item.rate,
              totalAmount: item.totalAmount,
            })),
          },
        },
        include: { items: true, vendor: true },
      });

      // 2. Add each item to Stock Ledger and Update Balance
      for (const item of computed.items) {
        await this.stockService.recordStockTransaction({
          organizationId: data.organizationId,
          metalType: item.metalType,
          purity: item.purity,
          transactionType: StockTransactionType.PURCHASE,
          quantityIn: item.netWeight,
          rate: item.rate,
          date: purchaseDate,
          referenceId: purchase.id,
          notes: `Purchase ${item.itemName || item.purity} from Bill: ${purchase.invoiceNumber || purchase.id}`,
          prismaTx: tx as any, // pass the transaction client
        });
      }

      return purchase;
    });
  }

  async getPurchases(organizationId: string) {
    return this.prisma.purchaseInvoice.findMany({
      where: { organizationId },
      include: { vendor: true, items: true },
      orderBy: { purchaseDate: 'desc' },
    });
  }

  private normalizeItems(data: {
    metalType: MetalType;
    purity: string;
    totalWeight: number;
    rate?: number;
    items?: PurchaseItemInput[];
  }): PurchaseItemInput[] {
    const sourceItems = data.items?.length
      ? data.items
      : [{
          metalType: data.metalType,
          purity: data.purity,
          grossWeight: data.totalWeight,
          netWeight: data.totalWeight,
          rate: data.rate,
        }];

    if (!sourceItems.length) {
      throw new BadRequestException('At least one purchase item is required');
    }

    return sourceItems;
  }

  private computeTotals(items: PurchaseItemInput[], data: {
    addGst?: boolean;
    gstInclusive?: boolean;
    taxType?: TaxType;
    cgstRate?: number;
    sgstRate?: number;
    igstRate?: number;
  }) {
    const toNumber = (value: unknown, fallback = 0) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const round3 = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

    const normalizedItems = items.map((item, index) => {
      const grossWeight = round3(toNumber(item.grossWeight, toNumber(item.netWeight)));
      const netWeight = round3(toNumber(item.netWeight, grossWeight));
      const rate = round2(toNumber(item.rate));
      const metalAmount = round2(netWeight * rate);
      const totalAmount = metalAmount;

      if (!item.metalType) {
        throw new BadRequestException(`Metal type is required for item ${index + 1}`);
      }
      if (!item.purity) {
        throw new BadRequestException(`Purity is required for item ${index + 1}`);
      }
      if (netWeight <= 0) {
        throw new BadRequestException(`Net weight must be greater than 0 for item ${index + 1}`);
      }
      if (totalAmount < 0) {
        throw new BadRequestException(`Total amount cannot be negative for item ${index + 1}`);
      }

      return {
        itemName: item.itemName || undefined,
        metalType: item.metalType,
        purity: item.purity,
        grossWeight,
        netWeight,
        rate,
        metalAmount,
        totalAmount,
      };
    });

    const subtotal = round2(normalizedItems.reduce((sum, item) => sum + item.totalAmount, 0));
    const totalMetalAmount = round2(normalizedItems.reduce((sum, item) => sum + item.metalAmount, 0));
    const totalGoldWeight = round3(normalizedItems
      .filter((item) => item.metalType === MetalType.GOLD)
      .reduce((sum, item) => sum + item.netWeight, 0));
    const totalSilverWeight = round3(normalizedItems
      .filter((item) => item.metalType === MetalType.SILVER)
      .reduce((sum, item) => sum + item.netWeight, 0));
    const taxType = data.taxType || 'CGST_SGST';
    const cgstRate = taxType === 'CGST_SGST' ? round2(toNumber(data.cgstRate, 1.5)) : 0;
    const sgstRate = taxType === 'CGST_SGST' ? round2(toNumber(data.sgstRate, 1.5)) : 0;
    const igstRate = taxType === 'IGST' ? round2(toNumber(data.igstRate, 3.0)) : 0;
    
    const totalTaxRate = data.addGst ? (taxType === 'CGST_SGST' ? cgstRate + sgstRate : igstRate) : 0;
    
    const taxableAmount = data.addGst && data.gstInclusive
      ? round2(subtotal / (1 + totalTaxRate / 100))
      : subtotal;
      
    const cgstAmount = data.addGst && taxType === 'CGST_SGST' ? round2(taxableAmount * cgstRate / 100) : 0;
    const sgstAmount = data.addGst && taxType === 'CGST_SGST' ? round2(taxableAmount * sgstRate / 100) : 0;
    const igstAmount = data.addGst && taxType === 'IGST' ? round2(taxableAmount * igstRate / 100) : 0;
    
    const grandTotal = data.addGst && !data.gstInclusive
      ? round2(subtotal + cgstAmount + sgstAmount + igstAmount)
      : subtotal;
    const firstItem = normalizedItems[0];

    return {
      items: normalizedItems,
      totalWeight: round3(normalizedItems.reduce((sum, item) => sum + item.netWeight, 0)),
      totalMetalAmount,
      totalGoldWeight,
      totalSilverWeight,
      taxableAmount,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      grandTotal,
      primaryMetalType: firstItem.metalType,
      primaryPurity: firstItem.purity,
      primaryRate: firstItem.rate,
    };
  }
}
