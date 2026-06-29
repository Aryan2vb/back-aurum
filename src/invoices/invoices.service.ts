import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateOrgInvoiceSettingsDto } from './dto/create-org-invoice-settings.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { CurrentUserData } from '../auth/current-user.decorator';
import {
  CreditStatus,
  InvoiceStatus,
  LedgerType,
  Prisma,
  TaxType,
  MakingChargesType,
  PaymentMethod,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { getFinancialYear } from './utils/invoice-calculations';
import { FinalizeInvoiceDto } from './dto/finalize-invoice.dto';
import { generateInvoiceHtml } from './utils/generate-invoice-html';
import { generateJewelleryInvoiceHtml } from './utils/generate-jewellery-html';
import { generateModernInvoiceHtml } from './utils/generate-modern-html';
import { PdfService } from './utils/pdf.service';
import { InvoiceData } from './utils/invoice-types';
import { InvoiceCalculationService } from './utils/invoice-calculation.service';
import { CreateBillBookDto } from './dto/create-bill-book.dto';
import { buildBillBookHtml, getBillBookTitle } from './utils/bill-book-html';

const BILL_BOOK_QUERY_BATCH_SIZE = 100;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly pdfService: PdfService,
    private readonly calcService: InvoiceCalculationService,
  ) {}

  private _parsePaymentPaidAt(value: string | undefined, invoiceDate: Date): Date {
    const normalizedInvoiceDate = new Date(invoiceDate);
    normalizedInvoiceDate.setUTCHours(0, 0, 0, 0);

    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Payment date must use YYYY-MM-DD format');
    }

    const paidAt = value ? new Date(`${value}T00:00:00.000Z`) : normalizedInvoiceDate;
    if (value && (Number.isNaN(paidAt.getTime()) || paidAt.toISOString().slice(0, 10) !== value)) {
      throw new BadRequestException('Payment date is invalid');
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (paidAt > today) {
      throw new BadRequestException('Payment date cannot be in the future');
    }

    if (paidAt > normalizedInvoiceDate) {
      throw new BadRequestException('Payment date cannot be after the invoice date');
    }

    return paidAt;
  }

  private _consumeMatchingExistingPayment(payment: any, existingPayments: any[]): boolean {
    if (!payment.paidAt) return false;

    const requestedPaidAt = new Date(`${payment.paidAt}T00:00:00.000Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (Number.isNaN(requestedPaidAt.getTime()) || requestedPaidAt > today) return false;

    const matchIndex = existingPayments.findIndex(
      (existing) =>
        existing.mode === payment.mode &&
        new Decimal(existing.amount).equals(new Decimal(payment.amount)) &&
        (existing.reference || '') === (payment.reference || '') &&
        existing.paidAt.toISOString().slice(0, 10) === payment.paidAt,
    );
    if (matchIndex === -1) return false;

    existingPayments.splice(matchIndex, 1);
    return true;
  }

  // ===========================
  // ORG INVOICE SETTINGS
  // ===========================

  async upsertSettings(dto: CreateOrgInvoiceSettingsDto, user: CurrentUserData) {
    this.logger.log(`Upserting invoice settings for org ${user.organizationId}`);
    return this.prisma.orgInvoiceSettings.upsert({
      where: { organizationId: user.organizationId },
      create: {
        organizationId: user.organizationId,
        companyName: dto.companyName,
        address: dto.address,
        gstin: dto.gstin,
        state: dto.state,
        stateCode: dto.stateCode,
        phone: dto.phone,
        email: dto.email,
        pan: dto.pan,
        mantra: dto.mantra,
        logoUrl: dto.logoUrl,
        bisLogoUrl: dto.bisLogoUrl,
        signatureUrl: dto.signatureUrl,
        qrCodeUrl: dto.qrCodeUrl,
        footerImageUrl: dto.footerImageUrl,
        whatsappGroupQrUrl: dto.whatsappGroupQrUrl,
        bankName: dto.bankName,
        bankBranch: dto.bankBranch,
        bankAccountName: dto.bankAccountName,
        bankAccountNumber: dto.bankAccountNumber,
        bankIfsc: dto.bankIfsc,
        defaultTaxType: dto.defaultTaxType,
        defaultCgstRate:
          dto.defaultCgstRate !== undefined ? new Decimal(dto.defaultCgstRate) : undefined,
        defaultSgstRate:
          dto.defaultSgstRate !== undefined ? new Decimal(dto.defaultSgstRate) : undefined,
        defaultIgstRate:
          dto.defaultIgstRate !== undefined ? new Decimal(dto.defaultIgstRate) : undefined,
        defaultTemplate: dto.defaultTemplate,
        declaration: dto.declaration,
        termsOfDelivery: dto.termsOfDelivery,
        invoiceNumberPrefix: dto.invoiceNumberPrefix,
        startingSequence: dto.startingSequence,
      },
      update: {
        companyName: dto.companyName,
        address: dto.address,
        gstin: dto.gstin,
        state: dto.state,
        stateCode: dto.stateCode,
        phone: dto.phone,
        email: dto.email,
        pan: dto.pan,
        mantra: dto.mantra,
        logoUrl: dto.logoUrl,
        bisLogoUrl: dto.bisLogoUrl,
        signatureUrl: dto.signatureUrl,
        qrCodeUrl: dto.qrCodeUrl,
        footerImageUrl: dto.footerImageUrl,
        whatsappGroupQrUrl: dto.whatsappGroupQrUrl,
        bankName: dto.bankName,
        bankBranch: dto.bankBranch,
        bankAccountName: dto.bankAccountName,
        bankAccountNumber: dto.bankAccountNumber,
        bankIfsc: dto.bankIfsc,
        defaultTaxType: dto.defaultTaxType,
        defaultCgstRate:
          dto.defaultCgstRate !== undefined ? new Decimal(dto.defaultCgstRate) : undefined,
        defaultSgstRate:
          dto.defaultSgstRate !== undefined ? new Decimal(dto.defaultSgstRate) : undefined,
        defaultIgstRate:
          dto.defaultIgstRate !== undefined ? new Decimal(dto.defaultIgstRate) : undefined,
        defaultTemplate: dto.defaultTemplate,
        declaration: dto.declaration,
        termsOfDelivery: dto.termsOfDelivery,
        invoiceNumberPrefix: dto.invoiceNumberPrefix,
        startingSequence: dto.startingSequence,
        updatedAt: new Date(), // Force a refresh so cache-busting timestamps advance
      },
    });
  }

  async getSettings(organizationId: string) {
    const settings = await this.prisma.orgInvoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!settings) {
      throw new NotFoundException(
        'Invoice settings not configured. Please POST /invoices/settings first.',
      );
    }
    return settings;
  }

  // ===========================
  // INVOICE CREATION
  // ===========================

  async getNextSequence(organizationId: string, dateStr?: string) {
    const settings = await this.prisma.orgInvoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!settings) throw new BadRequestException('Invoice settings not found');

    const invoiceDate = dateStr ? new Date(dateStr) : new Date();
    const financialYear = getFinancialYear(invoiceDate);

    const seq = await this.prisma.invoiceSequence.findUnique({
      where: { organizationId_financialYear: { organizationId, financialYear } },
    });

    const nextSequence = seq ? seq.nextSequence : (settings.startingSequence ?? 1);
    const prefix = settings.invoiceNumberPrefix ?? 'INV';

    return {
      nextSequence,
      prefix,
      financialYear,
      preview: `${prefix}/${nextSequence}/${financialYear}`,
    };
  }

  async getMissingSequences(organizationId: string, dateStr?: string) {
    const settings = await this.prisma.orgInvoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!settings) throw new BadRequestException('Invoice settings not found');

    const invoiceDate = dateStr ? new Date(dateStr) : new Date();
    const financialYear = getFinancialYear(invoiceDate);
    const prefix = settings.invoiceNumberPrefix ?? 'INV';
    const startingSequence = settings.startingSequence ?? 1;

    const seq = await this.prisma.invoiceSequence.findUnique({
      where: { organizationId_financialYear: { organizationId, financialYear } },
    });
    const nextSequence = seq ? seq.nextSequence : startingSequence;

    if (nextSequence <= startingSequence) {
      return {
        prefix,
        financialYear,
        nextSequence,
        missingSequences: [],
        missingInvoiceNumbers: [],
      };
    }

    const existing = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        financialYear,
        sequence: { gte: startingSequence, lt: nextSequence },
      },
      select: { sequence: true, invoiceDate: true },
      orderBy: { sequence: 'asc' },
    });

    const usedMap = new Map<number, Date>();
    for (const inv of existing) {
      if (inv.sequence != null) usedMap.set(inv.sequence, inv.invoiceDate);
    }

    const missingSequences: number[] = [];
    const missingDetails = [];

    for (let sequence = startingSequence; sequence < nextSequence; sequence += 1) {
      if (!usedMap.has(sequence)) {
        missingSequences.push(sequence);

        let minDate = null;
        for (let i = sequence - 1; i >= startingSequence; i--) {
          if (usedMap.has(i)) {
            minDate = usedMap.get(i);
            break;
          }
        }

        let maxDate = null;
        for (let i = sequence + 1; i < nextSequence; i++) {
          if (usedMap.has(i)) {
            maxDate = usedMap.get(i);
            break;
          }
        }

        missingDetails.push({
          sequence,
          invoiceNumber: `${prefix}/${sequence}/${financialYear}`,
          minDate,
          maxDate,
        });
      }
    }

    return {
      prefix,
      financialYear,
      nextSequence,
      missingSequences,
      missingInvoiceNumbers: missingDetails.map((d) => d.invoiceNumber),
      missingDetails,
    };
  }

  async getSequenceAvailability(
    organizationId: string,
    sequence: number,
    dateStr?: string,
    excludeInvoiceId?: string,
  ) {
    const settings = await this.prisma.orgInvoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!settings) throw new BadRequestException('Invoice settings not found');

    const invoiceDate = dateStr ? new Date(dateStr) : new Date();
    const financialYear = getFinancialYear(invoiceDate);
    const prefix = settings.invoiceNumberPrefix ?? 'INV';
    const invoiceNumber = `${prefix}/${sequence}/${financialYear}`;
    const duplicateWhere: any = {
      organizationId,
      OR: [{ invoiceNumber }, { financialYear, sequence }],
    };
    if (excludeInvoiceId) duplicateWhere.NOT = { id: excludeInvoiceId };

    const existing = await this.prisma.invoice.findFirst({ where: duplicateWhere });

    return {
      sequence,
      invoiceNumber,
      financialYear,
      available: !existing,
    };
  }

  private async _allocateInvoiceNumber(
    tx: any,
    {
      organizationId,
      financialYear,
      settings,
      manualSequence,
      manualInvoiceNumber,
      excludeInvoiceId,
    }: {
      organizationId: string;
      financialYear: string;
      settings: { invoiceNumberPrefix?: string | null; startingSequence?: number | null };
      manualSequence?: number | null;
      manualInvoiceNumber?: string | null;
      excludeInvoiceId?: string;
    },
  ): Promise<{ invoiceNumber: string; sequenceVal: number | null }> {
    const prefix = settings.invoiceNumberPrefix ?? 'INV';

    if (manualSequence !== undefined && manualSequence !== null) {
      const invoiceNumber = `${prefix}/${manualSequence}/${financialYear}`;
      const duplicateWhere: any = {
        organizationId,
        OR: [{ invoiceNumber }, { financialYear, sequence: manualSequence }],
      };
      if (excludeInvoiceId) duplicateWhere.NOT = { id: excludeInvoiceId };

      const existing = await tx.invoice.findFirst({ where: duplicateWhere });
      if (existing) {
        throw new BadRequestException(`Invoice number ${invoiceNumber} already exists`);
      }

      const currentSeq = await tx.invoiceSequence.findUnique({
        where: { organizationId_financialYear: { organizationId, financialYear } },
      });
      const currentNext = currentSeq ? currentSeq.nextSequence : (settings.startingSequence ?? 1);
      if (manualSequence >= currentNext) {
        await tx.invoiceSequence.upsert({
          where: { organizationId_financialYear: { organizationId, financialYear } },
          create: { organizationId, financialYear, nextSequence: manualSequence + 1 },
          update: { nextSequence: manualSequence + 1 },
        });
      }

      return { invoiceNumber, sequenceVal: manualSequence };
    }

    if (manualInvoiceNumber) {
      const existing = await tx.invoice.findFirst({
        where: { organizationId, invoiceNumber: manualInvoiceNumber },
      });
      if (existing) {
        throw new BadRequestException(`Invoice number ${manualInvoiceNumber} already exists`);
      }

      return { invoiceNumber: manualInvoiceNumber, sequenceVal: null };
    }

    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      try {
        const seqRec = await tx.invoiceSequence.upsert({
          where: { organizationId_financialYear: { organizationId, financialYear } },
          create: {
            organizationId,
            financialYear,
            nextSequence: (settings.startingSequence ?? 1) + 1,
          },
          update: { nextSequence: { increment: 1 } },
        });

        const sequenceVal = seqRec.nextSequence - 1;
        return {
          invoiceNumber: `${prefix}/${sequenceVal}/${financialYear}`,
          sequenceVal,
        };
      } catch (error: any) {
        attempts++;
        if (attempts >= maxAttempts || !error.code || error.code !== 'P2002') {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
      }
    }

    throw new BadRequestException('Unable to allocate invoice number');
  }

  private async _reserveDraftSequence(
    tx: any,
    {
      organizationId,
      financialYear,
      settings,
      manualSequence,
      excludeInvoiceId,
    }: {
      organizationId: string;
      financialYear: string;
      settings: { invoiceNumberPrefix?: string | null; startingSequence?: number | null };
      manualSequence?: number | null;
      excludeInvoiceId?: string;
    },
  ): Promise<number | null> {
    if (manualSequence === undefined || manualSequence === null) return null;

    const prefix = settings.invoiceNumberPrefix ?? 'INV';
    const invoiceNumber = `${prefix}/${manualSequence}/${financialYear}`;
    const duplicateWhere: any = {
      organizationId,
      OR: [{ invoiceNumber }, { financialYear, sequence: manualSequence }],
    };
    if (excludeInvoiceId) duplicateWhere.NOT = { id: excludeInvoiceId };

    const existing = await tx.invoice.findFirst({ where: duplicateWhere });
    if (existing) {
      throw new BadRequestException(`Invoice number ${invoiceNumber} already exists`);
    }

    const currentSeq = await tx.invoiceSequence.findUnique({
      where: { organizationId_financialYear: { organizationId, financialYear } },
    });
    const currentNext = currentSeq ? currentSeq.nextSequence : (settings.startingSequence ?? 1);
    if (manualSequence >= currentNext) {
      await tx.invoiceSequence.upsert({
        where: { organizationId_financialYear: { organizationId, financialYear } },
        create: { organizationId, financialYear, nextSequence: manualSequence + 1 },
        update: { nextSequence: manualSequence + 1 },
      });
    }

    return manualSequence;
  }

  async create(dto: CreateInvoiceDto, user: CurrentUserData) {
    return this._persistInvoice(dto, user, false);
  }

  async createDraft(dto: CreateInvoiceDto, user: CurrentUserData) {
    return this._persistInvoice(dto, user, true);
  }

  async finalize(id: string, user: CurrentUserData, dto: FinalizeInvoiceDto) {
    const { organizationId, userId } = user;
    this.logger.log(`Finalizing invoice ${id} for org ${organizationId}`);

    const draft = await this.prisma.invoice.findFirst({
      where: { id, organizationId, status: InvoiceStatus.DRAFT },
      include: { items: true },
    });
    if (!draft) throw new NotFoundException('Draft invoice not found');

    const settings = await this.prisma.orgInvoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!settings) throw new BadRequestException('Invoice settings not found');

    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const financialYear = getFinancialYear(invoiceDate);
    const paidAmount = new Decimal(dto.paidAmount ?? draft.paidAmount);
    const totalAmount = new Decimal(draft.totalAmount);
    const balance = totalAmount.minus(paidAmount);

    let status: InvoiceStatus = InvoiceStatus.PAID;
    if (balance.gt(0)) {
      status = paidAmount.gt(0) ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID;
    }

    return this.prisma.$transaction(async (tx) => {
      const { invoiceNumber, sequenceVal } = await this._allocateInvoiceNumber(tx, {
        organizationId,
        financialYear,
        settings,
        manualSequence: dto.manualSequence ?? draft.sequence,
        manualInvoiceNumber: dto.manualInvoiceNumber,
        excludeInvoiceId: draft.id,
      });

      const updatedInvoice = await tx.invoice.update({
        where: { id, organizationId },
        data: {
          invoiceNumber,
          sequence: sequenceVal,
          status,
          paidAmount: new Decimal(paidAmount),
          invoiceDate,
          financialYear,
          companySnapshot: {
            version: 1,
            data: {
              name: settings.companyName,
              address: settings.address,
              gstin: settings.gstin,
              state: settings.state,
              stateCode: settings.stateCode,
              phone: settings.phone ?? '',
              email: settings.email ?? '',
              pan: settings.pan ?? '',
              mantra: settings.mantra ?? '',
              logo: settings.logoUrl ? `${settings.logoUrl}?v=${settings.updatedAt.getTime()}` : '',
              bisLogo: settings.bisLogoUrl
                ? `${settings.bisLogoUrl}?v=${settings.updatedAt.getTime()}`
                : '',
              signature: settings.signatureUrl
                ? `${settings.signatureUrl}?v=${settings.updatedAt.getTime()}`
                : '',
              qrCode: settings.qrCodeUrl
                ? `${settings.qrCodeUrl}?v=${settings.updatedAt.getTime()}`
                : '',
              footerImage: settings.footerImageUrl
                ? `${settings.footerImageUrl}?v=${settings.updatedAt.getTime()}`
                : '',
              whatsappGroupQr: settings.whatsappGroupQrUrl
                ? `${settings.whatsappGroupQrUrl}?v=${settings.updatedAt.getTime()}`
                : '',
              bankDetails: settings.bankName
                ? {
                    bankName: settings.bankName,
                    branch: settings.bankBranch ?? '',
                    accountName: settings.bankAccountName ?? '',
                    accountNumber: settings.bankAccountNumber ?? '',
                    ifsc: settings.bankIfsc ?? '',
                  }
                : undefined,
            },
          } as any,
          buyerSnapshot: (draft.buyerSnapshot as any)?.version
            ? (draft.buyerSnapshot as any)
            : {
                version: 1,
                data: draft.buyerSnapshot,
              },
        },
      });

      const shouldCreateUdhar = dto.autoCreateUdhar !== false;
      if (balance.gt(0) && shouldCreateUdhar) {
        await this._createInvoiceBalanceRecord(tx, {
          organizationId,
          customerId: draft.customerId,
          invoiceId: updatedInvoice.id,
          invoiceNumber: updatedInvoice.invoiceNumber!,
          balance: balance.toNumber(),
          items: draft.items as any,
          userId,
          notes: updatedInvoice.notes || undefined,
        });
      }

      return updatedInvoice;
    });
  }

  private async _persistInvoice(dto: CreateInvoiceDto, user: CurrentUserData, isDraft: boolean) {
    const { organizationId, userId } = user;
    const financials = await this._calculateInvoiceFinancials(dto, user, isDraft);
    const {
      status,
      grandTotal: totalAmount,
      paidAmount,
      taxType,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      subtotal,
      taxableAmount,
      roundOff,
      companySnapshot,
      buyerSnapshot,
      financialYear,
      invoiceDate,
      lineItems,
      needsCredit,
      placeOfSupply,
      metalRateSource,
      metalRateDate,
      totalHallmarkingCharges,
    } = financials;

    // Get settings for invoice number generation
    const settings = await this.prisma.orgInvoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!settings) throw new BadRequestException('Invoice settings not found');

    return this.prisma.$transaction(async (tx) => {
      let invoiceNumber: string | null = null;
      let sequenceVal: number | null = null;

      if (!isDraft) {
        const allocation = await this._allocateInvoiceNumber(tx, {
          organizationId,
          financialYear,
          settings,
          manualSequence: dto.manualSequence,
        });
        invoiceNumber = allocation.invoiceNumber;
        sequenceVal = allocation.sequenceVal;
      } else {
        sequenceVal = await this._reserveDraftSequence(tx, {
          organizationId,
          financialYear,
          settings,
          manualSequence: dto.manualSequence,
        });
      }

      // 1. Create Invoice
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          customerId: dto.customerId,
          status,
          taxType,
          placeOfSupply,
          subtotal,
          taxableAmount,
          cgstRate,
          sgstRate,
          igstRate,
          cgstAmount,
          sgstAmount,
          igstAmount,
          totalHallmarkingCharges,
          roundOff,
          totalAmount,
          paidAmount,
          metalRateSource,
          metalRateDate,
          companySnapshot: companySnapshot as any,
          buyerSnapshot: buyerSnapshot as any,
          modeOfPayment: dto.modeOfPayment || (dto.payments?.[0]?.mode as string),
          deliveryNote: dto.deliveryNote,
          dispatchDocNo: dto.dispatchDocNo,
          destination: dto.destination,
          termsOfDelivery: dto.termsOfDelivery,
          templateType: dto.templateType ?? 'jewellery',
          invoiceDate,
          financialYear,
          notes: financials.notes,
          createdById: userId,
          invoiceNumber,
          sequence: sequenceVal,
          payments: dto.payments?.length
            ? {
                create: dto.payments.map((p) => ({
                  organizationId,
                  mode: p.mode,
                  amount: new Decimal(p.amount),
                  reference: p.reference,
                  notes: p.notes,
                  paidAt: this._parsePaymentPaidAt(p.paidAt, invoiceDate),
                })),
              }
            : undefined,
          items: {
            create: lineItems.map((item) => ({
              organizationId,
              slNo: item.slNo,
              description: item.description,
              hsnSac: item.hsnSac,
              quantity: item.quantity,
              unit: item.unit,
              metalType: item.metalType,
              metalRate: item.metalRate,
              purityLabel: item.purityLabel,
              purityValue: item.purityValue,
              purityBasis: item.purityBasis,
              effectiveRate: item.effectiveRate,
              grossWeight: item.grossWeight,
              stoneWeight: item.stoneWeight,
              netWeight: item.netWeight,
              makingCharges: item.makingCharges,
              makingChargesType: item.makingChargesType,
              makingChargesAmount: item.makingChargesAmount,
              stoneCharges: item.stoneCharges,
              isHallmarked: item.isHallmarked,
              hallmarkingCharge: item.hallmarkingCharge,
              huid: item.huid,
              taxableAmount: item.itemAmount,
              totalAmount: item.itemAmount, // for backward compat
              unitPrice: item.effectiveRate, // for backward compat
            })),
          },
        },
        include: { items: true },
      });

      // 2. Automated credit management
      if (needsCredit && dto.autoCreateUdhar !== false) {
        await this._createInvoiceBalanceRecord(tx, {
          organizationId,
          customerId: dto.customerId,
          invoiceId: invoice.id,
          invoiceNumber: invoiceNumber || 'DRAFT',
          balance: totalAmount.minus(paidAmount).toNumber(),
          items: lineItems as any,
          userId,
          notes: financials.notes,
        });
      }

      return invoice;
    });
  }

  async findAll(query: QueryInvoicesDto, organizationId: string) {
    const {
      customerId,
      status,
      dateFrom,
      dateTo,
      search,
      page = 1,
      limit = 20,
      sortBy = 'invoiceDate',
      sortOrder = 'desc',
      includeItems = false,
    } = query;

    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      deletedAt: null,
    };

    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    if (dateFrom || dateTo) {
      where.invoiceDate = {};
      if (dateFrom) (where.invoiceDate as any).gte = new Date(dateFrom);
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setUTCHours(23, 59, 59, 999);
        (where.invoiceDate as any).lte = toDate;
      }
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const validSortFields = ['invoiceDate', 'invoiceNumber', 'totalAmount', 'status', 'createdAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'invoiceDate';

    const skip = (page - 1) * limit;

    const orderBy: any[] = [{ [sortField]: sortOrder }];
    if (sortField !== 'sequence') {
      orderBy.push({ sequence: sortOrder });
    }

    const findOptions: any = {
      where,
      orderBy,
      skip,
      take: limit,
      ...(includeItems
        ? {
            include: {
              customer: { select: { id: true, fullName: true, customerCode: true } },
              _count: { select: { items: true } },
              items: { orderBy: { slNo: 'asc' } },
              payments: true,
            },
          }
        : {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              invoiceDate: true,
              subtotal: true,
              taxableAmount: true,
              cgstAmount: true,
              sgstAmount: true,
              igstAmount: true,
              totalAmount: true,
              paidAmount: true,
              customerId: true,
              customer: { select: { id: true, fullName: true, customerCode: true } },
              _count: { select: { items: true } },
              payments: { select: { amount: true, mode: true } },
            },
          }),
    };

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany(findOptions),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices.map((inv) => ({
        ...inv,
        remainingBalance: new Decimal(inv.totalAmount)
          .minus(new Decimal(inv.paidAmount))
          .toNumber(),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, organizationId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        items: { orderBy: { slNo: 'asc' } },
        customer: {
          select: {
            id: true,
            fullName: true,
            customerCode: true,
            contactDetails: { where: { deletedAt: null }, select: { primaryPhone: true }, take: 1 },
            locations: { where: { deletedAt: null }, take: 1 },
            documents: { where: { deletedAt: null } },
          },
        },
        udharEntries: { where: { deletedAt: null } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    // Sum all advance amounts applied directly to this invoice
    const advanceApplications = await this.prisma.ledgerEntry.aggregate({
      where: {
        organizationId,
        invoiceId: id,
        type: LedgerType.ADVANCE_APPLIED,
        deletedAt: null,
      },
      _sum: { amount: true },
    });
    const advanceAdjustedAmount = new Decimal(advanceApplications._sum.amount ?? 0);
    const remainingPayable = new Decimal(invoice.totalAmount)
      .minus(new Decimal(invoice.paidAmount))
      .toDecimalPlaces(2);

    return {
      ...invoice,
      remainingBalance: remainingPayable.toNumber(),
      advanceAdjustedAmount: advanceAdjustedAmount.toNumber(),
      remainingPayable: remainingPayable.toNumber(),
    };
  }

  async recordPayment(id: string, dto: RecordPaymentDto, user: CurrentUserData) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot record payment on a cancelled invoice');
    }
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException('Cannot record payment on a draft invoice');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    const paymentAmount = new Decimal(dto.amount);
    const newPaidAmount = (invoice.paidAmount as Decimal).add(paymentAmount);

    if (newPaidAmount.greaterThan(invoice.totalAmount)) {
      throw new BadRequestException(
        `Payment of ${dto.amount} would exceed remaining balance of ${new Decimal(invoice.totalAmount).minus(new Decimal(invoice.paidAmount)).toNumber()}`,
      );
    }

    const isFullyPaid = newPaidAmount.greaterThanOrEqualTo(invoice.totalAmount);
    const newInvoiceStatus = isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

    return this.prisma.$transaction(async (tx) => {
      const updatedInvoice = await tx.invoice.update({
        where: { id, organizationId: user.organizationId },
        data: {
          paidAmount: newPaidAmount,
          status: newInvoiceStatus,
        },
      });

      await tx.invoicePayment.create({
        data: {
          invoiceId: id,
          organizationId: user.organizationId,
          mode: dto.paymentMethod ?? PaymentMethod.CASH,
          amount: paymentAmount,
          reference: dto.reference,
          notes: dto.notes,
          // paidAt defaults to now() in schema — override only if caller provides a date
        },
      });

      const udhar = await tx.udharEntry.findFirst({
        where: {
          invoiceId: id,
          organizationId: user.organizationId,
          // Sync payment to both ACTIVE and OVERDUE udhar entries
          status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
          deletedAt: null,
        },
      });

      if (udhar) {
        // Add only the incoming payment delta — udhar may have already had prior payments
        const newUdharPaid = (udhar.paidAmount as Decimal).add(paymentAmount);
        const newUdharBalance = new Decimal(udhar.amount).minus(newUdharPaid);
        const newUdharStatus = newUdharBalance.lte(0)
          ? CreditStatus.PAID
          : udhar.status === CreditStatus.OVERDUE
            ? CreditStatus.OVERDUE // preserve OVERDUE unless fully paid
            : CreditStatus.ACTIVE;

        await tx.udharEntry.update({
          where: { id: udhar.id, organizationId: user.organizationId },
          data: {
            paidAmount: newUdharPaid,
            status: newUdharStatus,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            organizationId: user.organizationId,
            customerId: udhar.customerId,
            amount: paymentAmount,
            type: LedgerType.PAYMENT,
            description: dto.notes ?? `Payment for Invoice ${invoice.invoiceNumber}`,
            entityId: udhar.id,
            createdById: user.userId,
          },
        });

        this.logger.log(`Udhar ${udhar.id} updated via invoice payment, new paid: ${newUdharPaid}`);
      }

      this.logger.log(
        `Invoice ${invoice.invoiceNumber} payment: ${dto.amount}, new status: ${newInvoiceStatus}`,
      );

      return {
        ...updatedInvoice,
        paidAmount: newPaidAmount,
        remainingBalance: new Decimal(invoice.totalAmount).minus(newPaidAmount).toNumber(),
      };
    });
  }

  async generatePdf(id: string, organizationId: string): Promise<Buffer> {
    const html = await this.generateHtml(id, organizationId);
    return this.pdfService.generatePdf(html);
  }

  async generateBillBook(dto: CreateBillBookDto, organizationId: string): Promise<string> {
    const startedAt = Date.now();
    const selectedIds = Array.from(new Set(dto.invoiceIds || []));
    const invoices: any[] = [];

    if (selectedIds.length > 0) {
      for (let offset = 0; offset < selectedIds.length; offset += BILL_BOOK_QUERY_BATCH_SIZE) {
        invoices.push(
          ...(await this.prisma.invoice.findMany({
            where: {
              id: { in: selectedIds.slice(offset, offset + BILL_BOOK_QUERY_BATCH_SIZE) },
              organizationId,
              deletedAt: null,
              status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
            },
            include: this._invoiceRenderInclude(),
            orderBy: [{ invoiceDate: 'asc' }, { sequence: 'asc' }],
          })),
        );
      }
      invoices.sort(
        (a, b) =>
          a.invoiceDate.getTime() - b.invoiceDate.getTime() ||
          (a.sequence ?? 0) - (b.sequence ?? 0),
      );
    } else {
      if (dto.status === InvoiceStatus.DRAFT || dto.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(
          'Draft and cancelled invoices cannot be added to a Bill Book',
        );
      }

      const where: Prisma.InvoiceWhereInput = {
        organizationId,
        deletedAt: null,
        status: dto.status || { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
      };

      if (dto.dateFrom || dto.dateTo) {
        where.invoiceDate = {};
        if (dto.dateFrom) (where.invoiceDate as Prisma.DateTimeFilter).gte = new Date(dto.dateFrom);
        if (dto.dateTo) {
          const toDate = new Date(dto.dateTo);
          toDate.setUTCHours(23, 59, 59, 999);
          (where.invoiceDate as Prisma.DateTimeFilter).lte = toDate;
        }
      }
      if (dto.search) {
        where.OR = [
          { invoiceNumber: { contains: dto.search, mode: 'insensitive' } },
          { customer: { fullName: { contains: dto.search, mode: 'insensitive' } } },
          { notes: { contains: dto.search, mode: 'insensitive' } },
        ];
      }

      for (let offset = 0; ; offset += BILL_BOOK_QUERY_BATCH_SIZE) {
        const batch = await this.prisma.invoice.findMany({
          where,
          include: this._invoiceRenderInclude(),
          orderBy: [{ invoiceDate: 'asc' }, { sequence: 'asc' }],
          skip: offset,
          take: BILL_BOOK_QUERY_BATCH_SIZE,
        });
        invoices.push(...batch);
        if (batch.length < BILL_BOOK_QUERY_BATCH_SIZE) break;
      }
    }

    if (invoices.length === 0) {
      throw new BadRequestException('No finalized invoices match the Bill Book selection');
    }

    const html = buildBillBookHtml({
      title: getBillBookTitle({
        selectedCount: selectedIds.length > 0 ? invoices.length : undefined,
        dateFrom: dto.dateFrom,
        dateTo: dto.dateTo,
      }),
      invoices: invoices.map((invoice) => this._renderInvoiceHtml(invoice)),
    });
    this.logger.log(
      `Generated Bill Book with ${invoices.length} bills in ${Date.now() - startedAt}ms`,
    );
    return html;
  }

  async generateHtml(id: string, organizationId: string): Promise<string> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: this._invoiceRenderInclude(),
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    return this._renderInvoiceHtml(invoice);
  }

  private _invoiceRenderInclude() {
    return {
      items: { orderBy: { slNo: 'asc' as const } },
      customer: {
        select: {
          id: true,
          fullName: true,
          gstin: true,
          customerCode: true,
          contactDetails: {
            where: { deletedAt: null },
            select: { primaryPhone: true },
            take: 1,
          },
          locations: { where: { deletedAt: null }, take: 1 },
        },
      },
      payments: { orderBy: { paidAt: 'asc' as const } },
    };
  }

  private _renderInvoiceHtml(invoice: any): string {
    const customer = invoice.customer;
    const loc = customer.locations && customer.locations.length > 0 ? customer.locations[0] : null;
    const companySnapshotRaw =
      (invoice.companySnapshot as any)?.data || (invoice.companySnapshot as any) || {};
    const buyerSnapshotRaw =
      (invoice.buyerSnapshot as any)?.data || (invoice.buyerSnapshot as any) || {};

    // Build InvoiceData structure expected by templates
    const invoiceData: InvoiceData = {
      company: {
        name: companySnapshotRaw.name || '',
        address: companySnapshotRaw.address || '',
        gstin: companySnapshotRaw.gstin || '',
        state: companySnapshotRaw.state || '',
        stateCode: companySnapshotRaw.stateCode || '',
        phone: companySnapshotRaw.phone || '',
        email: companySnapshotRaw.email || '',
        pan: companySnapshotRaw.pan || '',
        mantra: companySnapshotRaw.mantra || '',
        logo: companySnapshotRaw.logo || '',
        bisLogo: companySnapshotRaw.bisLogo || '',
        signature: companySnapshotRaw.signature || '',
        qrCode: companySnapshotRaw.qrCode || '',
        footerImage: companySnapshotRaw.footerImage || '',
        whatsappGroupQr: companySnapshotRaw.whatsappGroupQr || '',
        bankDetails: companySnapshotRaw.bankDetails || undefined,
      },
      buyer: {
        name: buyerSnapshotRaw.name || customer.fullName || '',
        address:
          buyerSnapshotRaw.address ||
          (loc ? `${loc.village ?? ''} ${loc.district ?? ''}`.trim() : ''),
        phone: buyerSnapshotRaw.phone || customer.contactDetails?.[0]?.primaryPhone || '',
        state: buyerSnapshotRaw.state || companySnapshotRaw.state || '',
        stateCode: buyerSnapshotRaw.stateCode || companySnapshotRaw.stateCode || '',
        gstin: buyerSnapshotRaw.gstin || customer.gstin || '',
        email: buyerSnapshotRaw.email || '',
        pan: buyerSnapshotRaw.pan || '',
      },
      metadata: {
        invoiceNo: invoice.invoiceNumber || 'DRAFT',
        date:
          invoice.invoiceDate?.toLocaleDateString('en-IN') ||
          new Date().toLocaleDateString('en-IN'),
        financialYear: invoice.financialYear || '',
      },
      items: invoice.items.map((item: any) => ({
        slNo: item.slNo,
        description: item.description,
        hsnSac: item.hsnSac || '',
        quantity: new Decimal(item.quantity).toNumber(),
        unit: item.unit || 'PCS',
        rate: new Decimal(item.unitPrice).toNumber(),
        makingCharges: item.makingCharges ? new Decimal(item.makingCharges).toNumber() : undefined,
        makingChargesType: item.makingChargesType,
        purity: item.purity || item.purityLabel || undefined,
        purityLabel: item.purityLabel || undefined,
        purityValue: item.purityValue ? new Decimal(item.purityValue).toNumber() : undefined,
        purityBasis: item.purityBasis || undefined,
        netWeight: item.netWeight ? new Decimal(item.netWeight).toNumber() : undefined,
        grossWeight: item.grossWeight ? new Decimal(item.grossWeight).toNumber() : undefined,
        stoneWeight: item.stoneWeight ? new Decimal(item.stoneWeight).toNumber() : undefined,
        stoneCharges: item.stoneCharges ? new Decimal(item.stoneCharges).toNumber() : undefined,
        huid: item.huid || undefined,
        hallmarkingCharge: item.hallmarkingCharge
          ? new Decimal(item.hallmarkingCharge).toNumber()
          : undefined,
        isHallmarked: item.isHallmarked,
        amount: new Decimal(item.taxableAmount).toNumber(),
      })),
      taxType: invoice.taxType,
      taxes: {
        taxType: invoice.taxType,
        cgstRate: new Decimal(invoice.cgstRate).toNumber(),
        cgstAmount: new Decimal(invoice.cgstAmount).toNumber(),
        sgstRate: new Decimal(invoice.sgstRate).toNumber(),
        sgstAmount: new Decimal(invoice.sgstAmount).toNumber(),
        igstRate: new Decimal(invoice.igstRate || 0).toNumber(),
        igstAmount: new Decimal(invoice.igstAmount || 0).toNumber(),
      },
      hsnSummary: this._calculateHsnSummary(
        invoice.items.map((item: any) => ({
          hsnSac: item.hsnSac || '',
          amount: new Decimal(item.taxableAmount).toNumber(),
        })),
        {
          cgstRate: new Decimal(invoice.cgstRate).toNumber(),
          sgstRate: new Decimal(invoice.sgstRate).toNumber(),
          igstRate: new Decimal(invoice.igstRate || 0).toNumber(),
        },
        invoice.taxType,
      ),
      roundOff: new Decimal(invoice.roundOff).toNumber(),
      totalQuantity: invoice.items.reduce(
        (sum: number, item: any) => sum + new Decimal(item.quantity).toNumber(),
        0,
      ),
      totalAmount: new Decimal(invoice.totalAmount).toNumber(),
      amountInWords: this.numberToWords(new Decimal(invoice.totalAmount).toNumber()),
      taxAmountInWords: this.numberToWords(
        new Decimal(invoice.cgstAmount)
          .plus(new Decimal(invoice.sgstAmount))
          .plus(new Decimal(invoice.igstAmount))
          .toNumber(),
      ),
      declaration: invoice.notes || undefined,
      cashReceived: new Decimal(invoice.paidAmount).toNumber(),
      amtBalance: new Decimal(invoice.totalAmount)
        .minus(new Decimal(invoice.paidAmount))
        .toNumber(),
      hallmarkingCharge: new Decimal(invoice.totalHallmarkingCharges || 0).toNumber(),
      payments:
        invoice.payments?.map((p: any) => ({
          mode: p.mode,
          amount: new Decimal(p.amount).toNumber(),
          paidAt: p.paidAt,
        })) || [],
    };

    if (invoice.templateType === 'jewellery') {
      return generateJewelleryInvoiceHtml(invoiceData);
    } else if (invoice.templateType === 'modern') {
      return generateModernInvoiceHtml(invoiceData);
    } else {
      return generateInvoiceHtml(invoiceData);
    }
  }

  generateSignature(invoiceId: string, organizationId: string): string {
    const secret = process.env.INVOICE_SIGNING_SECRET || process.env.JWT_SECRET!;
    if (!process.env.INVOICE_SIGNING_SECRET) {
      this.logger.warn(
        'INVOICE_SIGNING_SECRET is not set, falling back to JWT_SECRET for invoice signatures',
      );
    }
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
    const payload = `${invoiceId}:${organizationId}:${expiry}`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${expiry}.${signature}`;
  }

  async verifySignature(invoiceId: string, signatureParam: string): Promise<string> {
    const [expiry, signature] = signatureParam.split('.');
    if (!expiry || !signature) throw new BadRequestException('Invalid signature format');

    if (Date.now() / 1000 > new Decimal(expiry).toNumber()) {
      throw new BadRequestException('Signature expired');
    }

    const secret = process.env.INVOICE_SIGNING_SECRET || process.env.JWT_SECRET!;
    if (!process.env.INVOICE_SIGNING_SECRET) {
      this.logger.warn(
        'INVOICE_SIGNING_SECRET is not set, falling back to JWT_SECRET for invoice signatures',
      );
    }

    const invoices = await this.prisma.$queryRaw<{ id: string; organizationId: string }[]>`
      SELECT id, "organizationId" FROM "Invoice" WHERE id = ${invoiceId} LIMIT 1
    `;

    if (!invoices || invoices.length === 0) throw new NotFoundException('Invoice not found');

    const invoice = invoices[0];

    const payload = `${invoiceId}:${invoice.organizationId}:${expiry}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new BadRequestException('Invalid signature');
    }

    return invoice.organizationId;
  }

  async send(id: string, dto: SendInvoiceDto, user: CurrentUserData): Promise<any> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (!invoice.invoiceNumber) {
      throw new BadRequestException(
        'Cannot send an invoice without an invoice number (Drafts cannot be sent)',
      );
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot send a cancelled invoice');
    }

    // Mark as SENT only if currently UNPAID (don't downgrade PARTIAL/PAID)
    if (invoice.status === InvoiceStatus.UNPAID) {
      await this.prisma.invoice.update({
        where: { id, organizationId: user.organizationId },
        data: { status: InvoiceStatus.SENT },
      });
    }

    return {
      success: true,
      message: `Invoice ${invoice.invoiceNumber} sent to ${dto.recipientEmails.join(', ')}`,
    };
  }

  async getWhatsAppShareLink(id: string, user: CurrentUserData): Promise<{ url: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      include: {
        customer: {
          include: { contactDetails: { where: { deletedAt: null } } },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    const signature = this.generateSignature(id, user.organizationId);

    // Use APP_URL if available, otherwise fallback to local/generic
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const publicUrl = `${baseUrl}/invoices/${id}/html?signature=${signature}`;

    // Use company name from the already-stored snapshot — avoids needing a separate join
    const companyName = (invoice.companySnapshot as any)?.data?.name || 'our store';
    const message = `Hello, here is your invoice from ${companyName}. You can view and download it as PDF here: ${publicUrl}`;
    const encodedMessage = encodeURIComponent(message);

    const primaryPhone = invoice.customer?.contactDetails?.[0]?.primaryPhone;
    let waUrl = `https://wa.me/?text=${encodedMessage}`;

    if (primaryPhone) {
      // Clean phone number: remove non-digits
      const cleanPhone = primaryPhone.replace(/\D/g, '');
      // If it doesn't start with a country code (assuming India 91 if 10 digits), prepend 91
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      waUrl = `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
    }

    return { url: waUrl };
  }

  async findByNumber(invoiceNumber: string, organizationId: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { invoiceNumber, organizationId, deletedAt: null },
      include: {
        items: { orderBy: { slNo: 'asc' } },
        customer: { select: { id: true, fullName: true, customerCode: true } },
        udharEntries: { where: { deletedAt: null } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return {
      ...inv,
      remainingBalance: new Decimal(inv.totalAmount).minus(new Decimal(inv.paidAmount)).toNumber(),
    };
  }

  async cancel(id: string, user: CurrentUserData) {
    const { organizationId } = user;
    const inv = await this.prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === InvoiceStatus.CANCELLED)
      throw new BadRequestException('Invoice is already cancelled');

    if (inv.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Cannot cancel a fully paid invoice. Refund items first.');
    }
    if (inv.status === InvoiceStatus.DRAFT) {
      return this.prisma.$transaction(async (tx) => {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id, organizationId } });
        await tx.invoice.delete({ where: { id, organizationId } });
        return { deleted: true, message: 'Draft invoice permanently deleted' };
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id, organizationId },
        data: { status: InvoiceStatus.CANCELLED, updatedAt: new Date() },
      });

      const udhar = await tx.udharEntry.findFirst({
        where: { invoiceId: id, organizationId, deletedAt: null },
      });

      if (udhar) {
        await tx.udharEntry.update({
          where: { id: udhar.id, organizationId },
          data: { status: CreditStatus.CANCELLED, deletedAt: new Date() },
        });
        await tx.ledgerEntry.update({
          where: { id: udhar.ledgerEntryId, organizationId },
          data: { deletedAt: new Date() },
        });
        // Soft-delete all payment ledger entries linked to this udhar
        await tx.ledgerEntry.updateMany({
          where: { entityId: udhar.id, organizationId, type: LedgerType.PAYMENT, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }

      return updated;
    });
  }

  async softDelete(id: string, organizationId: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!inv) throw new NotFoundException('Invoice not found');

    return this.prisma.invoice.update({
      where: { id, organizationId },
      data: { deletedAt: new Date() },
    });
  }

  async update(id: string, dto: UpdateInvoiceDto, user: CurrentUserData) {
    const { organizationId } = user;
    const existing = await this.prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { items: true, payments: true },
    });
    if (!existing) throw new NotFoundException('Invoice not found');

    if (existing.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cancelled invoices cannot be modified.');
    }

    // Calculate paidAmount from payments if provided, otherwise use dto.paidAmount or existing
    const paymentsSum = dto.payments?.length
      ? dto.payments.reduce((sum, p) => sum + new Decimal(p.amount).toNumber(), 0)
      : dto.paidAmount !== undefined
        ? dto.paidAmount
        : new Decimal(existing.paidAmount).toNumber();

    const dummyDto: CreateInvoiceDto = {
      customerId: dto.customerId ?? existing.customerId,
      items: dto.items ?? (existing.items as any),
      paidAmount: paymentsSum,
      templateType: dto.templateType ?? existing.templateType,
      modeOfPayment: dto.modeOfPayment ?? existing.modeOfPayment,
      deliveryNote: dto.deliveryNote ?? existing.deliveryNote,
      dispatchDocNo: dto.dispatchDocNo ?? existing.dispatchDocNo,
      destination: dto.destination ?? existing.destination,
      termsOfDelivery: dto.termsOfDelivery ?? existing.termsOfDelivery,
      invoiceDate: dto.invoiceDate ?? existing.invoiceDate?.toISOString(),
      buyerAddress: dto.buyerAddress,
      buyerState: dto.buyerState,
      buyerStateCode: dto.buyerStateCode,
      autoCreateUdhar: dto.autoCreateUdhar ?? (existing as any).autoCreateUdhar,
      manualSequence: dto.manualSequence,
    };

    const financials = await this._calculateInvoiceFinancials(dummyDto, user, true);

    // Recalculate status for non-draft invoices if totals changed, or if explicit finalization requested
    let status = existing.status;
    const isFinalizing = dto.finalize && status === InvoiceStatus.DRAFT;

    if (status !== InvoiceStatus.DRAFT || dto.finalize) {
      const balance = financials.grandTotal.minus(financials.paidAmount);
      if (balance.lte(0)) {
        status = InvoiceStatus.PAID;
      } else {
        status = financials.paidAmount.gt(0) ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const existingItems = existing.items;
      const existingItemIds = new Set(existingItems.map((i) => i.id));

      const itemsToCreate = [];
      const itemsToUpdate = [];
      const incomingItemIds = new Set();

      for (const item of financials.lineItems) {
        const originalItem = dto.items?.find((oi: any) => oi.slNo === item.slNo);

        if (
          originalItem &&
          (originalItem as any).id &&
          existingItemIds.has((originalItem as any).id)
        ) {
          itemsToUpdate.push({
            id: (originalItem as any).id,
            ...this._mapFinancialItemToDb(item, id, organizationId),
          });
          incomingItemIds.add((originalItem as any).id);
        } else {
          itemsToCreate.push(this._mapFinancialItemToDb(item, id, organizationId));
        }
      }

      // Delete items that are not in the updated list
      const itemsToDelete = existingItems.filter((i) => !incomingItemIds.has(i.id));
      if (itemsToDelete.length > 0) {
        await tx.invoiceItem.deleteMany({
          where: {
            id: { in: itemsToDelete.map((i) => i.id) },
            organizationId,
          },
        });
      }

      if (itemsToUpdate.length > 0) {
        await Promise.all(
          itemsToUpdate.map((item) =>
            tx.invoiceItem.update({
              where: { id: item.id, organizationId },
              data: item,
            }),
          ),
        );
      }

      if (itemsToCreate.length > 0) {
        await tx.invoiceItem.createMany({
          data: itemsToCreate,
        });
      }

      // Synchronize payments if provided
      if (dto.payments !== undefined) {
        const existingPaymentsToPreserve = [...existing.payments];

        // Delete all existing payments
        if (existing.payments.length > 0) {
          await tx.invoicePayment.deleteMany({
            where: {
              invoiceId: id,
              organizationId,
            },
          });
        }

        // Create new payments
        if (dto.payments.length > 0) {
          await tx.invoicePayment.createMany({
            data: dto.payments.map((p) => ({
              invoiceId: id,
              organizationId,
              mode: p.mode,
              amount: new Decimal(p.amount),
              reference: p.reference,
              notes: p.notes,
              paidAt: this._consumeMatchingExistingPayment(p, existingPaymentsToPreserve)
                ? new Date(`${p.paidAt}T00:00:00.000Z`)
                : this._parsePaymentPaidAt(p.paidAt, financials.invoiceDate),
            })),
          });
        }
      }

      const settings = await tx.orgInvoiceSettings.findUnique({
        where: { organizationId },
      });
      if (!settings) throw new BadRequestException('Invoice settings not found');

      let invoiceNumber = existing.invoiceNumber;
      let sequenceVal = existing.sequence;

      // Generate invoice number if finalizing a draft
      if (isFinalizing) {
        const financialYear = financials.financialYear;
        const allocation = await this._allocateInvoiceNumber(tx, {
          organizationId,
          financialYear,
          settings,
          manualSequence: dto.manualSequence ?? existing.sequence,
          excludeInvoiceId: id,
        });
        invoiceNumber = allocation.invoiceNumber;
        sequenceVal = allocation.sequenceVal;
      } else if (existing.status === InvoiceStatus.DRAFT && dto.manualSequence !== undefined) {
        sequenceVal = await this._reserveDraftSequence(tx, {
          organizationId,
          financialYear: financials.financialYear,
          settings,
          manualSequence: dto.manualSequence,
          excludeInvoiceId: id,
        });
      }

      const updated = await tx.invoice.update({
        where: { id, organizationId },
        data: {
          invoiceNumber,
          sequence: sequenceVal,
          customerId: dummyDto.customerId,
          taxType: financials.taxType,
          placeOfSupply: financials.placeOfSupply,
          subtotal: new Decimal(financials.subtotal),
          taxableAmount: new Decimal(financials.taxableAmount),
          cgstRate: new Decimal(financials.cgstRate),
          sgstRate: new Decimal(financials.sgstRate),
          igstRate: new Decimal(financials.igstRate),
          cgstAmount: new Decimal(financials.cgstAmount),
          sgstAmount: new Decimal(financials.sgstAmount),
          igstAmount: new Decimal(financials.igstAmount),
          totalHallmarkingCharges: new Decimal(financials.totalHallmarkingCharges),
          roundOff: new Decimal(financials.roundOff),
          totalAmount: new Decimal(financials.grandTotal),
          paidAmount: financials.paidAmount,
          status,
          metalRateSource: financials.metalRateSource,
          metalRateDate: financials.metalRateDate,
          companySnapshot: financials.companySnapshot as any,
          buyerSnapshot: financials.buyerSnapshot as any,
          modeOfPayment: dummyDto.modeOfPayment,
          deliveryNote: dummyDto.deliveryNote,
          dispatchDocNo: dummyDto.dispatchDocNo,
          destination: dummyDto.destination,
          termsOfDelivery: dummyDto.termsOfDelivery,
          invoiceDate: financials.invoiceDate,
          financialYear: financials.financialYear,
          notes: financials.notes,
          updatedAt: new Date(),
        },
        include: {
          items: { orderBy: { slNo: 'asc' } },
          payments: true,
        },
      });

      // Synchronize ledger/udhar if invoice is finalized
      if (status !== InvoiceStatus.DRAFT) {
        await this._syncInvoiceFinancialsWithLedger(tx, {
          organizationId,
          id,
          invoiceNumber: invoiceNumber!,
          oldCustomerId: existing.customerId,
          newCustomerId: dummyDto.customerId,
          grandTotal: financials.grandTotal.toNumber(),
          paidAmount: financials.paidAmount.toNumber(),
          items: financials.lineItems as any,
          userId: user.userId,
          notes: financials.notes,
        });
      }

      return updated;
    });
  }

  private _mapFinancialItemToDb(item: any, invoiceId: string, organizationId: string) {
    return {
      invoiceId,
      organizationId,
      slNo: item.slNo,
      description: item.description,
      hsnSac: item.hsnSac,
      quantity: item.quantity,
      unit: item.unit,
      metalType: item.metalType,
      metalRate: item.metalRate,
      purityLabel: item.purityLabel,
      purityValue: item.purityValue,
      purityBasis: item.purityBasis,
      effectiveRate: item.effectiveRate,
      grossWeight: item.grossWeight,
      stoneWeight: item.stoneWeight,
      netWeight: item.netWeight,
      makingCharges: item.makingCharges,
      makingChargesType: item.makingChargesType,
      makingChargesAmount: item.makingChargesAmount,
      stoneCharges: item.stoneCharges,
      isHallmarked: item.isHallmarked,
      hallmarkingCharge: item.hallmarkingCharge,
      huid: item.huid,
      taxableAmount: item.itemAmount,
      totalAmount: item.itemAmount,
      unitPrice: item.effectiveRate,
    };
  }

  private async _createInvoiceBalanceRecord(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      customerId: string;
      invoiceId: string;
      invoiceNumber: string;
      balance: number;
      items: any[];
      userId: string;
      dueDate?: Date;
      notes?: string;
    },
  ) {
    const {
      organizationId,
      customerId,
      invoiceId,
      invoiceNumber,
      balance,
      items,
      userId,
      dueDate,
      notes,
    } = data;

    const itemSummary = items
      .slice(0, 3)
      .map((i) => i.description)
      .join(', ');

    const ledger = await tx.ledgerEntry.create({
      data: {
        organizationId,
        customerId,
        amount: new Decimal(balance),
        type: LedgerType.UDHAR,
        description: `Invoice ${invoiceNumber} balance. Items: ${itemSummary}`,
        entityId: invoiceId,
        createdById: userId,
        udharEntry: {
          create: {
            organizationId,
            customerId,
            amount: new Decimal(balance),
            paidAmount: new Decimal(0),
            status: CreditStatus.ACTIVE,
            notes: notes ?? `Generated from invoice ${invoiceNumber}`,
            invoiceId: invoiceId,
            dueDate,
          },
        },
      },
    });

    this.logger.log(
      `Ledger & Udhar created: ${ledger.id} for invoice ${invoiceNumber}, amount: ${balance}`,
    );

    return ledger;
  }

  private async _calculateInvoiceFinancials(
    dto: CreateInvoiceDto,
    user: CurrentUserData,
    isDraft: boolean,
  ) {
    const { organizationId } = user;

    // 1. Fetch dependencies context
    const [settings, customer] = await Promise.all([
      this.prisma.orgInvoiceSettings.findUnique({ where: { organizationId } }),
      // findFirst enforces organizationId via the middleware check (findUnique with compound where also works but findFirst is explicit)
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId, deletedAt: null },
        include: { contactDetails: true, locations: true },
      }),
    ]);

    if (!settings) throw new BadRequestException('Invoice settings not found');
    if (!customer) throw new BadRequestException('Customer not found');

    // 2. Tax classification based on settings ONLY
    const placeOfSupply = settings.stateCode || '';
    const taxType = settings.defaultTaxType || TaxType.CGST_SGST;

    // GST rates from settings
    const cgstRate = settings.defaultCgstRate ?? new Decimal(0);
    const sgstRate = settings.defaultSgstRate ?? new Decimal(0);
    const igstRate = settings.defaultIgstRate ?? new Decimal(0);

    // 3. Process Line Items
    const lineItems = dto.items.map((item, index) => {
      const computed = this.calcService.computeItem({
        quantity: item.quantity,
        metalRate: item.metalRate,
        purityValue: item.purityValue,
        purityBasis: item.purityBasis,
        grossWeight: item.grossWeight,
        stoneWeight: item.stoneWeight ?? 0,
        makingCharges: item.makingCharges ?? 0,
        makingChargesType: item.makingChargesType ?? MakingChargesType.PER_GRAM,
        stoneCharges: item.stoneCharges ?? 0,
        isHallmarked: !!item.isHallmarked,
        hallmarkingCharge: item.hallmarkingCharge
          ? new Decimal(item.hallmarkingCharge)
          : new Decimal(0),
      });

      return {
        ...item,
        slNo: index + 1,
        ...computed,
      };
    });

    // 4. Aggregate Totals
    const totals = this.calcService.computeInvoiceTotals(lineItems, taxType, {
      cgst: cgstRate.toString(),
      sgst: sgstRate.toString(),
      igst: igstRate.toString(),
    });

    const totalHallmarkingCharges = lineItems.reduce(
      (sum, item) => sum.plus(item.hallmarkingCharge),
      new Decimal(0),
    );

    // 5. Build Snapshots
    const companySnapshot = {
      version: 1,
      data: {
        name: settings.companyName,
        address: settings.address,
        gstin: settings.gstin,
        state: settings.state,
        stateCode: settings.stateCode,
        phone: settings.phone ?? '',
        email: settings.email ?? '',
        pan: settings.pan ?? '',
        mantra: settings.mantra ?? '',
        logo: settings.logoUrl ?? '',
        bisLogo: settings.bisLogoUrl ?? '',
        signature: settings.signatureUrl ?? '',
        qrCode: settings.qrCodeUrl ?? '',
        footerImage: settings.footerImageUrl ?? '',
        whatsappGroupQr: settings.whatsappGroupQrUrl ?? '',
        bankDetails: settings.bankName
          ? {
              bankName: settings.bankName,
              branch: settings.bankBranch ?? '',
              accountName: settings.bankAccountName ?? '',
              accountNumber: settings.bankAccountNumber ?? '',
              ifsc: settings.bankIfsc ?? '',
            }
          : undefined,
      },
    };

    const loc = customer.locations?.[0] || null;
    const buyerSnapshot = {
      version: 1,
      data: {
        name: customer.fullName,
        address:
          dto.buyerAddress || (loc ? `${loc.village ?? ''} ${loc.district ?? ''}`.trim() : ''),
        phone: customer.contactDetails?.[0]?.primaryPhone ?? '',
        state: dto.buyerState || loc?.state || '',
        stateCode: dto.buyerStateCode || loc?.district || '', // district often used for local codes if state matches
        gstin: customer.gstin || '',
      },
    };

    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const financialYear = getFinancialYear(invoiceDate);
    const paidAmount = dto.payments?.length
      ? dto.payments.reduce((sum, p) => sum.plus(new Decimal(p.amount)), new Decimal(0))
      : new Decimal(dto.paidAmount || 0);

    let status: InvoiceStatus;
    if (isDraft) status = InvoiceStatus.DRAFT;
    else if (paidAmount.greaterThanOrEqualTo(totals.grandTotal)) status = InvoiceStatus.PAID;
    else if (paidAmount.greaterThan(0)) status = InvoiceStatus.PARTIAL;
    else status = InvoiceStatus.UNPAID;

    const needsCredit = !isDraft && paidAmount.lessThan(totals.grandTotal);

    return {
      ...totals,
      status,
      paidAmount,
      taxType,
      cgstRate,
      sgstRate,
      igstRate,
      financialYear,
      invoiceDate,
      lineItems,
      needsCredit,
      companySnapshot,
      buyerSnapshot,
      placeOfSupply,
      notes: settings.declaration || '',
      templateType: dto.templateType || settings.defaultTemplate || 'jewellery',
      metalRateSource: dto.metalRateSource || 'MANUAL',
      metalRateDate: dto.metalRateDate ? new Date(dto.metalRateDate) : invoiceDate,
      totalHallmarkingCharges,
    };
  }

  private _calculateHsnSummary(
    items: any[],
    taxes: { cgstRate: number; sgstRate: number; igstRate: number },
    taxType: TaxType = TaxType.CGST_SGST,
  ): any[] {
    const summaryMap = new Map<string, any>();

    for (const item of items) {
      const hsn = item.hsnSac || 'N/A';
      const taxableValue = item.amount || 0;

      if (!summaryMap.has(hsn)) {
        summaryMap.set(hsn, {
          hsnSac: hsn,
          taxableValue: 0,
          cgstRate: taxes.cgstRate,
          sgstRate: taxes.sgstRate,
          igstRate: taxes.igstRate,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          totalTaxAmount: 0,
        });
      }

      const summary = summaryMap.get(hsn)!;
      summary.taxableValue += taxableValue;
    }

    // Now calculate taxes for each HSN group
    const result: any[] = [];
    summaryMap.forEach((summary) => {
      summary.taxType = taxType;
      summary.cgstAmount =
        Math.round(((summary.taxableValue * summary.cgstRate) / 100) * 100) / 100;
      summary.sgstAmount =
        Math.round(((summary.taxableValue * summary.sgstRate) / 100) * 100) / 100;
      summary.igstAmount =
        Math.round(((summary.taxableValue * summary.igstRate) / 100) * 100) / 100;

      if (taxType === TaxType.IGST) {
        summary.totalTaxAmount = summary.igstAmount;
      } else {
        summary.totalTaxAmount = summary.cgstAmount + summary.sgstAmount;
      }
      result.push(summary);
    });

    return result;
  }

  private numberToWords(num: number): string {
    if (num === 0) return 'Zero';

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = [
      'Ten',
      'Eleven',
      'Twelve',
      'Thirteen',
      'Fourteen',
      'Fifteen',
      'Sixteen',
      'Seventeen',
      'Eighteen',
      'Nineteen',
    ];
    const tens = [
      '',
      '',
      'Twenty',
      'Thirty',
      'Forty',
      'Fifty',
      'Sixty',
      'Seventy',
      'Eighty',
      'Ninety',
    ];

    const convertLessThanThousand = (n: number): string => {
      if (n === 0) return '';
      if (n < 10) return ones[n];
      if (n < 20) return teens[n - 10];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
      return (
        ones[Math.floor(n / 100)] +
        ' Hundred' +
        (n % 100 !== 0 ? ' and ' + convertLessThanThousand(n % 100) : '')
      );
    };

    const convert = (n: number): string => {
      if (n === 0) return 'Zero';

      const crore = Math.floor(n / 10000000);
      const lakh = Math.floor((n % 10000000) / 100000);
      const thousand = Math.floor((n % 100000) / 1000);
      const remainder = n % 1000;

      let result = '';
      if (crore > 0) result += convertLessThanThousand(crore) + ' Crore ';
      if (lakh > 0) result += convertLessThanThousand(lakh) + ' Lakh ';
      if (thousand > 0) result += convertLessThanThousand(thousand) + ' Thousand ';
      if (remainder > 0) result += convertLessThanThousand(remainder);

      return result.trim();
    };

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);

    let result = convert(rupees) + ' Rupees';
    if (paise > 0) {
      result += ' and ' + convertLessThanThousand(paise) + ' Paise';
    }

    return result;
  }

  async generatePreviewHtml(organizationId: string): Promise<string> {
    const settings = await this.prisma.orgInvoiceSettings.findUnique({ where: { organizationId } });
    if (!settings)
      throw new NotFoundException('Invoice settings not found. Please configure settings first.');

    const t = settings.updatedAt.getTime();
    const companySnapshot = {
      version: 1,
      data: {
        name: settings.companyName,
        address: settings.address,
        gstin: settings.gstin,
        state: settings.state,
        stateCode: settings.stateCode,
        phone: settings.phone ?? '',
        email: settings.email ?? '',
        pan: settings.pan ?? '',
        mantra: settings.mantra ?? '',
        logo: settings.logoUrl
          ? settings.logoUrl.includes('?')
            ? `${settings.logoUrl}&v=${t}`
            : `${settings.logoUrl}?v=${t}`
          : '',
        bisLogo: settings.bisLogoUrl
          ? settings.bisLogoUrl.includes('?')
            ? `${settings.bisLogoUrl}&v=${t}`
            : `${settings.bisLogoUrl}?v=${t}`
          : '',
        signature: settings.signatureUrl
          ? settings.signatureUrl.includes('?')
            ? `${settings.signatureUrl}&v=${t}`
            : `${settings.signatureUrl}?v=${t}`
          : '',
        qrCode: settings.qrCodeUrl
          ? settings.qrCodeUrl.includes('?')
            ? `${settings.qrCodeUrl}&v=${t}`
            : `${settings.qrCodeUrl}?v=${t}`
          : '',
        footerImage: settings.footerImageUrl
          ? settings.footerImageUrl.includes('?')
            ? `${settings.footerImageUrl}&v=${t}`
            : `${settings.footerImageUrl}?v=${t}`
          : '',
        whatsappGroupQr: settings.whatsappGroupQrUrl
          ? settings.whatsappGroupQrUrl.includes('?')
            ? `${settings.whatsappGroupQrUrl}&v=${t}`
            : `${settings.whatsappGroupQrUrl}?v=${t}`
          : '',
        bankDetails: settings.bankName
          ? {
              bankName: settings.bankName,
              branch: settings.bankBranch ?? '',
              accountName: settings.bankAccountName ?? '',
              accountNumber: settings.bankAccountNumber ?? '',
              ifsc: settings.bankIfsc ?? '',
            }
          : undefined,
      },
    };

    const buyerSnapshot = {
      version: 1,
      data: {
        name: 'Sample Customer',
        address: '123 Sample Street, Sample City',
        phone: '+91 98765 43210',
        state: settings.state,
        stateCode: settings.stateCode,
      },
    };

    const sampleItems = [
      {
        slNo: 1,
        description: 'Gold Ring 22K',
        hsnSac: '7113',
        quantity: 1,
        unit: 'PCS',
        rate: 25000,
        makingCharges: 500,
        purity: '22K',
        grossWeight: 10,
        stoneWeight: 0.5,
        netWeight: 9.5,
        huid: 'A12345',
        hallmarkingCharge: 45,
        isHallmarked: true,
        stoneCharges: 200,
        amount: 25745,
      },
      {
        slNo: 2,
        description: 'Silver Chain',
        hsnSac: '7113',
        quantity: 2,
        unit: 'PCS',
        rate: 2000,
        makingCharges: 100,
        purity: '925',
        grossWeight: 50,
        stoneWeight: 2,
        netWeight: 48,
        huid: '',
        isHallmarked: false,
        stoneCharges: 0,
        amount: 4200,
      },
    ];

    const taxType = settings.defaultTaxType;
    const isIgst = taxType === TaxType.IGST;
    const isNone = taxType === TaxType.NONE;

    const cgstRate = isIgst || isNone ? 0 : new Decimal(settings.defaultCgstRate ?? 0).toNumber();
    const sgstRate = isIgst || isNone ? 0 : new Decimal(settings.defaultSgstRate ?? 0).toNumber();
    const igstRate = isIgst ? new Decimal(settings.defaultIgstRate ?? 0).toNumber() : 0;

    const subtotal = sampleItems.reduce((sum, i) => sum + i.amount, 0);
    const cgstAmount = Math.round(((subtotal * cgstRate) / 100) * 100) / 100;
    const sgstAmount = Math.round(((subtotal * sgstRate) / 100) * 100) / 100;
    const igstAmount = Math.round(((subtotal * igstRate) / 100) * 100) / 100;
    const totalBeforeRound = subtotal + cgstAmount + sgstAmount + igstAmount;
    const totalAmount = Math.round(totalBeforeRound);
    const roundOff = Math.round((totalAmount - totalBeforeRound) * 100) / 100;
    const paidAmount = 10000;

    const invoiceData: InvoiceData = {
      company: companySnapshot.data,
      buyer: buyerSnapshot.data,
      metadata: {
        invoiceNo: `${settings.invoiceNumberPrefix || 'INV'}-${settings.startingSequence || 1}`,
        date: new Date().toLocaleDateString('en-IN'),
        financialYear: getFinancialYear(new Date()),
      },
      items: sampleItems,
      taxType: taxType as any,
      taxes: {
        taxType: taxType as any,
        cgstRate,
        cgstAmount,
        sgstRate,
        sgstAmount,
        igstRate,
        igstAmount,
      },
      hsnSummary: this._calculateHsnSummary(
        sampleItems.map((i) => ({ hsnSac: i.hsnSac, amount: i.amount })),
        { cgstRate, sgstRate, igstRate },
        taxType as any,
      ),
      roundOff,
      totalQuantity: sampleItems.reduce((sum, i) => sum + i.quantity, 0),
      totalAmount,
      amountInWords: this.numberToWords(totalAmount),
      taxAmountInWords: this.numberToWords(cgstAmount + sgstAmount + igstAmount),
      declaration: settings.declaration || '',
      cashReceived: paidAmount,
      amtBalance: totalAmount - paidAmount,
      hallmarkingCharge: 45, // Sample value for preview
    };

    const templateType = settings.defaultTemplate || 'default';
    if (templateType === 'jewellery') {
      return generateJewelleryInvoiceHtml(invoiceData);
    } else if (templateType === 'modern') {
      return generateModernInvoiceHtml(invoiceData);
    } else {
      return generateInvoiceHtml(invoiceData);
    }
  }
  private async _syncInvoiceFinancialsWithLedger(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      id: string; // invoiceId
      invoiceNumber: string;
      oldCustomerId: string;
      newCustomerId: string;
      grandTotal: number;
      paidAmount: number;
      items: any[];
      userId: string;
      notes?: string;
    },
  ) {
    const {
      organizationId,
      id,
      invoiceNumber,
      oldCustomerId,
      newCustomerId,
      grandTotal,
      paidAmount,
      items,
      userId,
      notes,
    } = data;

    const balance = grandTotal - paidAmount;
    const itemSummary = items
      .slice(0, 3)
      .map((i) => i.description)
      .join(', ');

    // 1. Find existing UdharEntry linked to this invoice
    const udhar = await tx.udharEntry.findFirst({
      where: { invoiceId: id, organizationId, deletedAt: null },
    });

    if (udhar) {
      const balanceDecimal = new Decimal(balance);
      const isPaid = balanceDecimal.lte(0);
      const newStatus = isPaid
        ? CreditStatus.PAID
        : udhar.status === CreditStatus.OVERDUE
          ? CreditStatus.OVERDUE
          : CreditStatus.ACTIVE;

      // 2. Update existing UdharEntry
      await tx.udharEntry.update({
        where: { id: udhar.id, organizationId },
        data: {
          customerId: newCustomerId,
          amount: balanceDecimal,
          // We don't change paidAmount here because that's tracked via incoming payments
          // but wait, the invoice's paidAmount might have changed due to payment split edit.
          // Actually, udhar.paidAmount is explicitly for payments recorded AFTER finalization.
          // The payments made AT finalization are subtracted from grandTotal to get the initial udhar.amount.
          // So if we edit the payments AT finalization, we should update udhar.amount (which is the balance).
          status: newStatus,
          notes: notes ?? `Update from invoice ${invoiceNumber}`,
        },
      });

      // 3. Update the linked LedgerEntry
      await tx.ledgerEntry.update({
        where: { id: udhar.ledgerEntryId, organizationId },
        data: {
          customerId: newCustomerId,
          amount: balanceDecimal,
          description: `Invoice ${invoiceNumber} balance. Items: ${itemSummary}`,
          createdById: userId,
        },
      });

      // 4. Move any other linked LedgerEntries (like individual payments) if customer changed
      if (oldCustomerId !== newCustomerId) {
        await tx.ledgerEntry.updateMany({
          where: { entityId: udhar.id, organizationId },
          data: { customerId: newCustomerId },
        });
      }
    } else if (balance > 0) {
      // Create new Udhar if it didn't exist but now there is a balance
      await this._createInvoiceBalanceRecord(tx, {
        organizationId,
        customerId: newCustomerId,
        invoiceId: id,
        invoiceNumber: invoiceNumber,
        balance,
        items,
        userId,
        notes,
      });
    }
  }
}
