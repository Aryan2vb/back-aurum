import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { UploadService } from '../uploads/upload.service';
import {
  MetalType,
  PaymentMethod,
  PurchaseStatus,
  TaxType,
  FinancialTransactionType,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { FinanceService } from '../finance/finance.service';
import { isTreasuryPayment } from '../finance/ledger-rules';
import { CreatePurchaseBillBookDto } from './dto/create-purchase-bill-book.dto';
import {
  buildPurchaseBillBookHtml,
  getPurchaseBillBookTitle,
  PurchaseBillBookPage,
} from './utils/purchase-bill-book-html';

const BILL_BOOK_QUERY_BATCH_SIZE = 100;
const BILL_BOOK_UNFILTERED_MAX = 200;

type PurchaseItemInput = {
  itemName?: string;
  metalType: MetalType;
  purity: string;
  grossWeight?: number;
  netWeight?: number;
  rate?: number;
  hallmarkingCharge?: number;
  otherCharges?: number;
};

type PurchasePaymentInput = {
  mode: PaymentMethod;
  amount: number;
  paidAt?: string;
  reference?: string;
  notes?: string;
  accountId?: string;
};

type PurchaseBillInput = {
  organizationId: string;
  vendorId?: string;
  vendorName?: string;
  invoiceNumber?: string;
  billSeries?: string;
  purchaseDate?: string;
  dueDate?: string;
  metalType?: MetalType;
  purity?: string;
  totalWeight?: number;
  rate?: number;
  totalAmount?: number;
  addGst?: boolean;
  gstInclusive?: boolean;
  taxType?: TaxType;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  adjustment?: number;
  notes?: string;
  attachmentUrl?: string | null;
  attachmentKey?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  items?: PurchaseItemInput[];
  payments?: PurchasePaymentInput[];
};

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private prisma: PrismaService,
    private stockService: StockService,
    private uploadService: UploadService,
    private financeService: FinanceService,
  ) {}

  async createPurchase(data: PurchaseBillInput) {
    return this.prisma.$transaction(async (tx) => {
      const purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : new Date();
      const itemInputs = this.normalizeItems(data);
      const computed = this.computeTotals(itemInputs, data);
      const { finalVendorId, vendorData } = await this.resolveVendor(tx, data);
      const payments = this.normalizePayments(data.payments, purchaseDate);
      for (const payment of payments) {
        const account = await this.financeService.resolvePaymentAccount(
          tx,
          data.organizationId,
          payment.mode,
          payment.accountId,
        );
        payment.accountId = account?.id ?? undefined;
      }
      await this.assertSufficientTreasuryFunds(tx, data.organizationId, payments);
      const paidAmount = this.sumPayments(payments);
      this.assertPaidNotOver(paidAmount, computed.grandTotal);
      const status = this.deriveStatus(paidAmount, computed.grandTotal);

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
          paidAmount,
          status,
          addGst: !!data.addGst,
          gstInclusive: !!data.gstInclusive,
          totalGoldWeight: computed.totalGoldWeight,
          totalSilverWeight: computed.totalSilverWeight,
          totalMetalAmount: computed.totalMetalAmount,
          totalHallmarkingCharges: computed.totalHallmarkingCharges,
          totalOtherCharges: computed.totalOtherCharges,
          adjustment: computed.adjustment,
          notes: data.notes,
          attachmentUrl: data.attachmentUrl ?? undefined,
          attachmentKey: data.attachmentKey ?? undefined,
          attachmentName: data.attachmentName ?? undefined,
          attachmentMime: data.attachmentMime ?? undefined,
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
              hallmarkingCharge: item.hallmarkingCharge,
              otherCharges: item.otherCharges,
              totalAmount: item.totalAmount,
            })),
          },
          payments: payments.length
            ? {
                create: payments.map((p) => ({
                  organizationId: data.organizationId,
                  mode: p.mode,
                  amount: p.amount,
                  reference: p.reference,
                  notes: p.notes,
                  paidAt: p.paidAt,
                  accountId: p.accountId,
                })),
              }
            : undefined,
        },
        include: { items: true, vendor: true, payments: true },
      });

      await this.stockService.syncPurchaseStockForInvoice({
        organizationId: data.organizationId,
        purchaseId: purchase.id,
        invoiceNumber: purchase.invoiceNumber,
        purchaseDate,
        items: computed.items,
        prismaTx: tx as any,
      });
      await this.syncPurchaseTreasury(tx, purchase.id, data.organizationId);

      return purchase;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateAttachment(
    id: string,
    organizationId: string,
    data: {
      attachmentUrl?: string | null;
      attachmentKey?: string | null;
      attachmentName?: string | null;
      attachmentMime?: string | null;
    },
  ) {
    return this.updateAttachmentOnly(id, { ...data, organizationId });
  }

  async updatePurchase(id: string, data: PurchaseBillInput) {
    const hasMeaningfulItems = Array.isArray(data.items) && data.items.length > 0;
    const hasHeaderBill = data.metalType != null || data.purity != null || data.totalWeight != null;
    const isFullBillUpdate = hasMeaningfulItems || hasHeaderBill;
    const hasAttachmentPatch =
      data.attachmentUrl !== undefined ||
      data.attachmentKey !== undefined ||
      data.attachmentName !== undefined ||
      data.attachmentMime !== undefined;

    // Attachment-only payloads must never fall through into item validation
    if (hasAttachmentPatch && !isFullBillUpdate) {
      return this.updateAttachmentOnly(id, data);
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseInvoice.findFirst({
        where: { id, organizationId: data.organizationId },
        include: { payments: true },
      });
      if (!existing) throw new NotFoundException('Purchase not found');
      if (existing.status === PurchaseStatus.CANCELLED) {
        throw new BadRequestException('Cannot edit a cancelled purchase');
      }

      const purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : existing.purchaseDate;
      const itemInputs = this.normalizeItems(
        data as {
          metalType: MetalType;
          purity: string;
          totalWeight: number;
          rate?: number;
          items?: PurchaseItemInput[];
        },
      );
      const computed = this.computeTotals(itemInputs, {
        ...data,
        addGst: data.addGst ?? existing.addGst,
        gstInclusive: data.gstInclusive ?? existing.gstInclusive,
      });
      const { finalVendorId, vendorData } = await this.resolveVendor(tx, data);

      const replacePayments = Array.isArray(data.payments);
      const payments = replacePayments
        ? this.normalizePayments(data.payments, purchaseDate)
        : existing.payments.map((p) => ({
            mode: p.mode,
            amount: Number(p.amount),
            paidAt: p.paidAt,
            reference: p.reference || undefined,
            notes: p.notes || undefined,
            accountId: p.accountId || undefined,
          }));
      const paidAmount = this.sumPayments(payments);
      this.assertPaidNotOver(paidAmount, computed.grandTotal);
      const status = this.deriveStatus(paidAmount, computed.grandTotal);
      if (replacePayments) {
        for (const payment of payments) {
          const account = await this.financeService.resolvePaymentAccount(
            tx,
            data.organizationId,
            payment.mode,
            payment.accountId,
          );
          payment.accountId = account?.id ?? undefined;
        }
        await this.assertSufficientTreasuryFunds(tx, data.organizationId, payments, id);
      }

      if (replacePayments) {
        await tx.purchasePayment.deleteMany({ where: { purchaseInvoiceId: id } });
      }

      await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: id } });

      const attachmentData = hasAttachmentPatch ? this.buildAttachmentUpdate(data) : {};

      const purchase = await tx.purchaseInvoice.update({
        where: { id },
        data: {
          vendorId: finalVendorId,
          vendorName: vendorData?.name,
          vendorGstin: vendorData?.gstin,
          vendorStateCode: vendorData?.stateCode,
          vendorStateName: vendorData?.stateName,
          invoiceNumber: data.invoiceNumber,
          billSeries: data.billSeries,
          purchaseDate,
          dueDate: data.dueDate ? new Date(data.dueDate) : existing.dueDate,
          metalType: computed.primaryMetalType,
          purity: computed.primaryPurity,
          totalWeight: computed.totalWeight,
          rate: computed.primaryRate,
          totalAmount: computed.grandTotal,
          taxableAmount: computed.taxableAmount,
          taxType: data.taxType || existing.taxType,
          cgstRate: computed.cgstRate,
          sgstRate: computed.sgstRate,
          igstRate: computed.igstRate,
          cgstAmount: computed.cgstAmount,
          sgstAmount: computed.sgstAmount,
          igstAmount: computed.igstAmount,
          grandTotal: computed.grandTotal,
          paidAmount,
          status,
          addGst: data.addGst ?? existing.addGst,
          gstInclusive: data.gstInclusive ?? existing.gstInclusive,
          totalGoldWeight: computed.totalGoldWeight,
          totalSilverWeight: computed.totalSilverWeight,
          totalMetalAmount: computed.totalMetalAmount,
          totalHallmarkingCharges: computed.totalHallmarkingCharges,
          totalOtherCharges: computed.totalOtherCharges,
          adjustment: computed.adjustment,
          notes: data.notes,
          ...attachmentData,
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
              hallmarkingCharge: item.hallmarkingCharge,
              otherCharges: item.otherCharges,
              totalAmount: item.totalAmount,
            })),
          },
          ...(replacePayments && payments.length
            ? {
                payments: {
                  create: payments.map((p) => ({
                    organizationId: data.organizationId,
                    mode: p.mode,
                    amount: p.amount,
                    reference: p.reference,
                    notes: p.notes,
                    paidAt: p.paidAt,
                    accountId: p.accountId,
                  })),
                },
              }
            : {}),
        },
        include: { items: true, vendor: true, payments: { orderBy: { paidAt: 'desc' } } },
      });

      await this.stockService.syncPurchaseStockForInvoice({
        organizationId: data.organizationId,
        purchaseId: purchase.id,
        invoiceNumber: purchase.invoiceNumber,
        purchaseDate,
        items: computed.items,
        prismaTx: tx as any,
      });
      await this.syncPurchaseTreasury(tx, purchase.id, data.organizationId, !replacePayments);

      if (hasAttachmentPatch) {
        await this.maybeDeleteOldAttachment(existing.attachmentKey, purchase.attachmentKey);
      }

      return purchase;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async updateAttachmentOnly(id: string, data: PurchaseBillInput) {
    const existing = await this.prisma.purchaseInvoice.findFirst({
      where: { id, organizationId: data.organizationId },
    });
    if (!existing) throw new NotFoundException('Purchase not found');
    if (existing.status === PurchaseStatus.CANCELLED) {
      throw new BadRequestException('Cannot edit a cancelled purchase');
    }

    const purchase = await this.prisma.purchaseInvoice.update({
      where: { id },
      data: this.buildAttachmentUpdate(data),
      include: {
        items: true,
        vendor: true,
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });

    await this.maybeDeleteOldAttachment(existing.attachmentKey, purchase.attachmentKey);
    return purchase;
  }

  private buildAttachmentUpdate(data: PurchaseBillInput) {
    const clearing =
      data.attachmentUrl === null ||
      data.attachmentKey === null ||
      (data.attachmentUrl === '' && data.attachmentKey === '');

    if (clearing) {
      return {
        attachmentUrl: null,
        attachmentKey: null,
        attachmentName: null,
        attachmentMime: null,
      };
    }

    return {
      ...(data.attachmentUrl !== undefined ? { attachmentUrl: data.attachmentUrl } : {}),
      ...(data.attachmentKey !== undefined ? { attachmentKey: data.attachmentKey } : {}),
      ...(data.attachmentName !== undefined ? { attachmentName: data.attachmentName } : {}),
      ...(data.attachmentMime !== undefined ? { attachmentMime: data.attachmentMime } : {}),
    };
  }

  private async maybeDeleteOldAttachment(
    oldKey: string | null | undefined,
    newKey: string | null | undefined,
  ) {
    if (!oldKey || oldKey === newKey) return;
    try {
      await this.uploadService.deleteObject(oldKey);
    } catch (err) {
      this.logger.warn(`Failed to delete old purchase attachment key=${oldKey}: ${err}`);
    }
  }

  async getPurchases(organizationId: string) {
    return this.prisma.purchaseInvoice.findMany({
      where: { organizationId },
      include: {
        vendor: true,
        items: true,
        payments: { orderBy: { paidAt: 'desc' } },
      },
      orderBy: { purchaseDate: 'desc' },
    });
  }

  async generatePurchaseBillBook(
    dto: CreatePurchaseBillBookDto,
    organizationId: string,
  ): Promise<string> {
    const startedAt = Date.now();
    const selectedIds = Array.from(new Set(dto.purchaseIds || []));
    const purchases: Array<{
      id: string;
      invoiceNumber: string | null;
      purchaseDate: Date;
      vendorName: string | null;
      attachmentUrl: string | null;
      attachmentMime: string | null;
      attachmentName: string | null;
      vendor: { name: string } | null;
    }> = [];

    if (selectedIds.length > 0) {
      for (let offset = 0; offset < selectedIds.length; offset += BILL_BOOK_QUERY_BATCH_SIZE) {
        purchases.push(
          ...(await this.prisma.purchaseInvoice.findMany({
            where: {
              id: { in: selectedIds.slice(offset, offset + BILL_BOOK_QUERY_BATCH_SIZE) },
              organizationId,
              status: { not: PurchaseStatus.CANCELLED },
            },
            select: {
              id: true,
              invoiceNumber: true,
              purchaseDate: true,
              vendorName: true,
              attachmentUrl: true,
              attachmentMime: true,
              attachmentName: true,
              vendor: { select: { name: true } },
            },
          })),
        );
      }
      purchases.sort(
        (a, b) =>
          a.purchaseDate.getTime() - b.purchaseDate.getTime() ||
          String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || '')),
      );
    } else {
      const where: {
        organizationId: string;
        status: { not: PurchaseStatus };
        OR?: Array<Record<string, unknown>>;
      } = {
        organizationId,
        status: { not: PurchaseStatus.CANCELLED },
      };

      if (dto.search?.trim()) {
        const q = dto.search.trim();
        where.OR = [
          { invoiceNumber: { contains: q, mode: 'insensitive' } },
          { vendorName: { contains: q, mode: 'insensitive' } },
          { vendorGstin: { contains: q, mode: 'insensitive' } },
          { vendor: { name: { contains: q, mode: 'insensitive' } } },
        ];
      }

      const unfiltered = !dto.search?.trim();
      for (let offset = 0; ; offset += BILL_BOOK_QUERY_BATCH_SIZE) {
        const take = unfiltered ? BILL_BOOK_UNFILTERED_MAX + 1 : BILL_BOOK_QUERY_BATCH_SIZE;
        const batch = await this.prisma.purchaseInvoice.findMany({
          where,
          select: {
            id: true,
            invoiceNumber: true,
            purchaseDate: true,
            vendorName: true,
            attachmentUrl: true,
            attachmentMime: true,
            attachmentName: true,
            vendor: { select: { name: true } },
          },
          orderBy: [{ purchaseDate: 'asc' }, { invoiceNumber: 'asc' }],
          skip: offset,
          take,
        });
        purchases.push(...batch);
        if (purchases.length > BILL_BOOK_UNFILTERED_MAX) {
          throw new BadRequestException(
            `Too many purchase bills to print at once (max ${BILL_BOOK_UNFILTERED_MAX}). Filter by search or select specific bills.`,
          );
        }
        if (unfiltered) {
          break;
        }
        if (batch.length < BILL_BOOK_QUERY_BATCH_SIZE) break;
      }
    }

    if (purchases.length === 0) {
      throw new BadRequestException('No purchase bills match the Bill Book selection');
    }

    const pages: PurchaseBillBookPage[] = purchases.map((purchase) => ({
      billNo: purchase.invoiceNumber || purchase.id.slice(0, 8),
      vendorName: purchase.vendor?.name || purchase.vendorName || '—',
      purchaseDate: purchase.purchaseDate.toISOString(),
      attachmentUrl: purchase.attachmentUrl,
      attachmentMime: purchase.attachmentMime,
      attachmentName: purchase.attachmentName,
    }));

    const html = buildPurchaseBillBookHtml({
      title: getPurchaseBillBookTitle({
        selectedCount: selectedIds.length > 0 ? purchases.length : undefined,
        search: dto.search,
      }),
      pages,
    });

    this.logger.log(
      `Generated Purchase Bill Book with ${purchases.length} bills in ${Date.now() - startedAt}ms`,
    );
    return html;
  }

  async getPurchase(id: string, organizationId: string) {
    const purchase = await this.prisma.purchaseInvoice.findFirst({
      where: { id, organizationId },
      include: {
        vendor: true,
        items: { orderBy: { slNo: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');

    const grandTotal = new Decimal(purchase.grandTotal ?? purchase.totalAmount ?? 0);
    const paidAmount = new Decimal(purchase.paidAmount ?? 0);
    return {
      ...purchase,
      remainingBalance: grandTotal.minus(paidAmount).toDecimalPlaces(2).toNumber(),
    };
  }

  /** Hard delete — purge stock ledger for this bill, wipe bill (+ cascade), best-effort R2 clear */
  async deletePurchase(id: string, organizationId: string) {
    const existing = await this.prisma.purchaseInvoice.findFirst({
      where: { id, organizationId },
      select: { id: true, attachmentKey: true },
    });
    if (!existing) throw new NotFoundException('Purchase not found');

    await this.prisma.$transaction(async (tx) => {
      await this.stockService.purgeTransactionsByReference(organizationId, id, tx);
      await this.financeService.reverseMissingSources(tx, organizationId, 'PURCHASE', id, []);
      await tx.purchaseInvoice.delete({ where: { id } });
    });

    if (existing.attachmentKey) {
      try {
        await this.uploadService.deleteObject(existing.attachmentKey);
      } catch (err) {
        this.logger.warn(
          `Failed to delete purchase attachment key=${existing.attachmentKey}: ${err}`,
        );
      }
    }

    return { deleted: true, id };
  }

  async recordPayment(
    id: string,
    organizationId: string,
    dto: {
      amount: number;
      paymentMethod?: PaymentMethod;
      paidAt?: string;
      reference?: string;
      notes?: string;
      accountId?: string;
    },
  ) {
    const paymentAmount = new Decimal(dto.amount);
    if (paymentAmount.lte(0)) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    return this.prisma.$transaction(
      async (tx) => {
        const lockedIds = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "PurchaseInvoice"
          WHERE id = ${id} AND "organizationId" = ${organizationId}
          FOR UPDATE
        `;
        if (!lockedIds.length) throw new NotFoundException('Purchase not found');
        const purchase = await tx.purchaseInvoice.findFirst({
          where: { id, organizationId },
        });
        if (!purchase) throw new NotFoundException('Purchase not found');
        if (purchase.status === PurchaseStatus.CANCELLED) {
          throw new BadRequestException('Cannot record payment on a cancelled purchase');
        }
        if (purchase.status === PurchaseStatus.PAID) {
          throw new BadRequestException('Purchase is already fully paid');
        }

        const method = dto.paymentMethod ?? PaymentMethod.CASH;
        const account = await this.financeService.resolvePaymentAccount(
          tx,
          organizationId,
          method,
          dto.accountId,
        );
        await this.assertSufficientTreasuryFunds(tx, organizationId, [
          { amount: paymentAmount.toNumber(), accountId: account?.id },
        ]);
        await tx.purchasePayment.create({
          data: {
            purchaseInvoiceId: id,
            organizationId,
            mode: method,
            accountId: account?.id,
            amount: paymentAmount,
            reference: dto.reference,
            notes: dto.notes,
            paidAt,
          },
        });

        const paidAgg = await tx.purchasePayment.aggregate({
          where: { purchaseInvoiceId: id, organizationId },
          _sum: { amount: true },
        });
        const paidAmount = new Decimal(paidAgg._sum.amount ?? 0);
        const grandTotal = new Decimal(purchase.grandTotal ?? purchase.totalAmount ?? 0);
        if (paidAmount.greaterThan(grandTotal)) {
          throw new BadRequestException(
            `Payment of ${dto.amount} would exceed remaining balance of ${grandTotal.minus(purchase.paidAmount).toNumber()}`,
          );
        }
        const status = this.deriveStatus(paidAmount.toNumber(), grandTotal.toNumber());
        await this.syncPurchaseTreasury(tx, id, organizationId);

        return tx.purchaseInvoice.update({
          where: { id },
          data: { paidAmount, status },
          include: {
            vendor: true,
            items: true,
            payments: { orderBy: { paidAt: 'desc' } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async resolveVendor(tx: any, data: PurchaseBillInput) {
    let finalVendorId = data.vendorId;
    let vendorData = null as any;

    if (!finalVendorId && data.vendorName) {
      let vendor = await tx.vendor.findFirst({
        where: {
          organizationId: data.organizationId,
          name: { equals: data.vendorName.trim(), mode: 'insensitive' },
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
      vendorData = await tx.vendor.findFirst({
        where: { id: finalVendorId, organizationId: data.organizationId },
      });
      if (!vendorData) {
        throw new BadRequestException('Vendor not found');
      }
    }

    return { finalVendorId, vendorData };
  }

  private normalizePayments(payments: PurchasePaymentInput[] | undefined, fallbackDate: Date) {
    if (!payments?.length)
      return [] as Array<{
        mode: PaymentMethod;
        amount: number;
        paidAt: Date;
        reference?: string;
        notes?: string;
        accountId?: string;
      }>;

    return payments
      .map((p) => {
        const amount = Math.round((Number(p.amount) + Number.EPSILON) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) return null;
        if (!p.mode) {
          throw new BadRequestException('Payment mode is required');
        }
        return {
          mode: p.mode,
          amount,
          paidAt: p.paidAt ? new Date(p.paidAt) : fallbackDate,
          reference: p.reference,
          notes: p.notes,
          accountId: p.accountId,
        };
      })
      .filter(Boolean) as Array<{
      mode: PaymentMethod;
      amount: number;
      paidAt: Date;
      reference?: string;
      notes?: string;
      accountId?: string;
    }>;
  }

  private sumPayments(payments: Array<{ amount: number }>) {
    return (
      Math.round(
        (payments.reduce((sum, p) => sum + Number(p.amount || 0), 0) + Number.EPSILON) * 100,
      ) / 100
    );
  }

  private async assertSufficientTreasuryFunds(
    tx: any,
    organizationId: string,
    payments: Array<{ amount: number; accountId?: string; mode?: PaymentMethod }>,
    excludePurchaseId?: string,
  ) {
    if (!tx.financialMovement) {
      throw new BadRequestException('Treasury fund check is unavailable');
    }
    const requiredByAccount = new Map<string, Decimal>();
    for (const payment of payments) {
      if (!payment.accountId) {
        if (payment.mode && isTreasuryPayment(payment.mode)) {
          throw new BadRequestException('Treasury-backed payments require an account');
        }
        continue;
      }
      requiredByAccount.set(
        payment.accountId,
        (requiredByAccount.get(payment.accountId) ?? new Decimal(0)).add(payment.amount),
      );
    }

    for (const [accountId, required] of requiredByAccount) {
      const balance = await tx.financialMovement.aggregate({
        where: {
          organizationId,
          accountId,
          ...(excludePurchaseId
            ? {
                NOT: {
                  transaction: {
                    sourceParentType: 'PURCHASE',
                    sourceParentId: excludePurchaseId,
                  },
                },
              }
            : {}),
        },
        _sum: { amount: true },
      });
      const available = new Decimal(balance._sum.amount ?? 0);
      if (required.greaterThan(available)) {
        throw new BadRequestException(
          `Insufficient account funds: available ₹${available.toDecimalPlaces(2)}, required ₹${required.toDecimalPlaces(2)}`,
        );
      }
    }
  }

  private assertPaidNotOver(paidAmount: number, grandTotal: number) {
    if (paidAmount > grandTotal + 0.01) {
      throw new BadRequestException(
        `Paid amount ${paidAmount} cannot exceed bill total ${grandTotal}`,
      );
    }
  }

  private deriveStatus(paidAmount: number, grandTotal: number): PurchaseStatus {
    if (paidAmount <= 0) return PurchaseStatus.UNPAID;
    if (paidAmount + 0.01 >= grandTotal) return PurchaseStatus.PAID;
    return PurchaseStatus.PARTIAL;
  }

  private async syncPurchaseTreasury(
    tx: any,
    purchaseId: string,
    organizationId: string,
    allowUnassignedNonCash = false,
  ) {
    const payments = await tx.purchasePayment.findMany({
      where: { purchaseInvoiceId: purchaseId, organizationId },
    });
    for (const payment of payments) {
      await this.financeService.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'PURCHASE_PAYMENT',
          sourceId: payment.id,
          sourceParentType: 'PURCHASE',
          sourceParentId: purchaseId,
          transactionType: FinancialTransactionType.PURCHASE_PAYMENT,
          paymentMethod: payment.mode,
          accountId: payment.accountId,
          amount: payment.amount,
          occurredAt: payment.paidAt,
          description: payment.notes ?? 'Purchase payment',
        },
        allowUnassignedNonCash,
      );
    }
    await this.financeService.reverseMissingSources(
      tx,
      organizationId,
      'PURCHASE',
      purchaseId,
      payments.map((payment: { id: string }) => payment.id),
    );
  }

  private normalizeItems(data: {
    metalType?: MetalType;
    purity?: string;
    totalWeight?: number;
    rate?: number;
    items?: PurchaseItemInput[];
  }): PurchaseItemInput[] {
    const sourceItems = data.items?.length
      ? data.items
      : [
          {
            metalType: data.metalType as MetalType,
            purity: data.purity as string,
            grossWeight: data.totalWeight,
            netWeight: data.totalWeight,
            rate: data.rate,
          },
        ];

    if (!sourceItems.length) {
      throw new BadRequestException('At least one purchase item is required');
    }

    return sourceItems;
  }

  private computeTotals(
    items: PurchaseItemInput[],
    data: {
      addGst?: boolean;
      gstInclusive?: boolean;
      taxType?: TaxType;
      cgstRate?: number;
      sgstRate?: number;
      igstRate?: number;
      adjustment?: number;
    },
  ) {
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
      const hallmarkingCharge = round2(toNumber(item.hallmarkingCharge));
      const otherCharges = round2(toNumber(item.otherCharges));
      const totalAmount = round2(metalAmount + hallmarkingCharge + otherCharges);

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
        hallmarkingCharge,
        otherCharges,
        totalAmount,
      };
    });

    const subtotal = round2(normalizedItems.reduce((sum, item) => sum + item.totalAmount, 0));
    const totalMetalAmount = round2(
      normalizedItems.reduce((sum, item) => sum + item.metalAmount, 0),
    );
    const totalHallmarkingCharges = round2(
      normalizedItems.reduce((sum, item) => sum + item.hallmarkingCharge, 0),
    );
    const totalOtherCharges = round2(
      normalizedItems.reduce((sum, item) => sum + item.otherCharges, 0),
    );
    const totalGoldWeight = round3(
      normalizedItems
        .filter((item) => item.metalType === MetalType.GOLD)
        .reduce((sum, item) => sum + item.netWeight, 0),
    );
    const totalSilverWeight = round3(
      normalizedItems
        .filter((item) => item.metalType === MetalType.SILVER)
        .reduce((sum, item) => sum + item.netWeight, 0),
    );
    const taxType = data.taxType || 'CGST_SGST';
    const cgstRate = taxType === 'CGST_SGST' ? round2(toNumber(data.cgstRate, 1.5)) : 0;
    const sgstRate = taxType === 'CGST_SGST' ? round2(toNumber(data.sgstRate, 1.5)) : 0;
    const igstRate = taxType === 'IGST' ? round2(toNumber(data.igstRate, 3.0)) : 0;

    const totalTaxRate = data.addGst
      ? taxType === 'CGST_SGST'
        ? cgstRate + sgstRate
        : igstRate
      : 0;

    const taxableAmount =
      data.addGst && data.gstInclusive ? round2(subtotal / (1 + totalTaxRate / 100)) : subtotal;

    const cgstAmount =
      data.addGst && taxType === 'CGST_SGST' ? round2((taxableAmount * cgstRate) / 100) : 0;
    const sgstAmount =
      data.addGst && taxType === 'CGST_SGST' ? round2((taxableAmount * sgstRate) / 100) : 0;
    const igstAmount =
      data.addGst && taxType === 'IGST' ? round2((taxableAmount * igstRate) / 100) : 0;

    const adjustment = round2(toNumber(data.adjustment));
    const baseTotal =
      data.addGst && !data.gstInclusive
        ? round2(subtotal + cgstAmount + sgstAmount + igstAmount)
        : subtotal;
    const grandTotal = round2(baseTotal + adjustment);
    const firstItem = normalizedItems[0];

    return {
      items: normalizedItems,
      totalWeight: round3(normalizedItems.reduce((sum, item) => sum + item.netWeight, 0)),
      totalMetalAmount,
      totalHallmarkingCharges,
      totalOtherCharges,
      totalGoldWeight,
      totalSilverWeight,
      taxableAmount,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      adjustment,
      grandTotal,
      primaryMetalType: firstItem.metalType,
      primaryPurity: firstItem.purity,
      primaryRate: firstItem.rate,
    };
  }
}
