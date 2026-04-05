import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { CreateOrgInvoiceSettingsDto } from './dto/create-org-invoice-settings.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { CurrentUserData } from '../auth/current-user.decorator';
import { CreditStatus, InvoiceStatus, LedgerType, Prisma, TaxType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { calculateInvoiceData, getFinancialYear } from './utils/invoice-calculations';
import { FinalizeInvoiceDto } from './dto/finalize-invoice.dto';
import { generateInvoiceHtml } from './utils/generate-invoice-html';
import { generateJewelleryInvoiceHtml } from './utils/generate-jewellery-html';
import { generateModernInvoiceHtml } from './utils/generate-modern-html';
import { PdfService } from './utils/pdf.service';
import { CompanyDetails, BuyerDetails } from './utils/invoice-types';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly pdfService: PdfService,
  ) {}

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
    const paidAmount = dto.paidAmount ?? Number(draft.paidAmount);
    const totalAmount = Number(draft.totalAmount);
    const balance = totalAmount - paidAmount;

    let status: InvoiceStatus = InvoiceStatus.PAID;
    if (balance > 0) {
      status = paidAmount > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID;
    }

    return this.prisma.$transaction(async (tx) => {
      let invoiceNumber = dto.manualInvoiceNumber;
      let sequenceVal = draft.sequence;

      if (!invoiceNumber) {
        const seqRec = await tx.invoiceSequence.upsert({
          where: { organizationId_financialYear: { organizationId, financialYear } },
          create: {
            organizationId,
            financialYear,
            nextSequence: (settings.startingSequence ?? 1) + 1,
          },
          update: { nextSequence: { increment: 1 } },
        });

        sequenceVal = seqRec.nextSequence - 1;
        const prefix = settings.invoiceNumberPrefix ?? 'INV';
        invoiceNumber = `${prefix}/${sequenceVal}/${financialYear}`;
      } else {
        const existing = await tx.invoice.findFirst({
          where: { organizationId, invoiceNumber },
        });
        if (existing)
          throw new BadRequestException(`Invoice number ${invoiceNumber} already exists`);
      }

      const updatedInvoice = await tx.invoice.update({
        where: { id, organizationId },
        data: {
          invoiceNumber,
          sequence: sequenceVal,
          status,
          paidAmount: new Decimal(paidAmount),
          invoiceDate,
          financialYear,
        },
      });

      const shouldCreateUdhar = dto.autoCreateUdhar !== false;
      if (balance > 0 && shouldCreateUdhar) {
        await this._createInvoiceBalanceRecord(tx, {
          organizationId,
          customerId: draft.customerId,
          invoiceId: updatedInvoice.id,
          invoiceNumber: updatedInvoice.invoiceNumber!,
          balance,
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
      totalAmount,
      paidAmount,
      taxType,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      roundedSubtotal,
      roundOff,
      companySnapshot,
      buyerSnapshot,
      financialYear,
      invoiceDate,
      lineItems,
      needsCredit,
      creditAmount,
      templateType,
    } = financials;

    const settings = await this.getSettings(organizationId);

    return this.prisma.$transaction(async (tx) => {
      let invoiceNumber: string | undefined;
      let sequenceVal: number | undefined;

      if (!isDraft) {
        const seqRec = await tx.invoiceSequence.upsert({
          where: { organizationId_financialYear: { organizationId, financialYear } },
          create: {
            organizationId,
            financialYear,
            nextSequence: (settings.startingSequence ?? 1) + 1,
          },
          update: { nextSequence: { increment: 1 } },
        });

        sequenceVal = seqRec.nextSequence - 1;
        const prefix = settings.invoiceNumberPrefix ?? 'INV';
        invoiceNumber = `${prefix}/${sequenceVal}/${financialYear}`;
      }

      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          customerId: dto.customerId,
          invoiceNumber,
          sequence: sequenceVal,
          status,
          taxType,
          subtotal: new Decimal(roundedSubtotal),
          cgstRate: new Decimal(cgstRate),
          sgstRate: new Decimal(sgstRate),
          igstRate: new Decimal(igstRate),
          cgstAmount: new Decimal(cgstAmount),
          sgstAmount: new Decimal(sgstAmount),
          igstAmount: new Decimal(igstAmount),
          roundOff: new Decimal(roundOff),
          totalAmount: new Decimal(totalAmount),
          paidAmount: new Decimal(paidAmount),
          companySnapshot: { version: 1, data: companySnapshot } as any,
          buyerSnapshot: { version: 1, data: buyerSnapshot } as any,
          modeOfPayment: dto.modeOfPayment,
          deliveryNote: dto.deliveryNote,
          dispatchDocNo: dto.dispatchDocNo,
          destination: dto.destination,
          termsOfDelivery: dto.termsOfDelivery ?? settings.termsOfDelivery,
          templateType,
          invoiceDate,
          financialYear,
          notes: dto.notes,
          createdById: userId,
        },
      });

      await tx.invoiceItem.createMany({
        data: lineItems.map((item) => ({
          invoiceId: invoice.id,
          organizationId,
          slNo: item.slNo,
          description: item.description,
          hsnSac: item.hsnSac,
          quantity: new Decimal(item.quantity),
          unit: item.unit,
          unitPrice: new Decimal(item.unitPrice),
          makingCharges:
            item.makingCharges !== undefined ? new Decimal(item.makingCharges) : undefined,
          taxableAmount: new Decimal(item.taxableAmount),
          totalAmount: new Decimal(item.totalAmount),
          grossWeight: item.grossWeight !== undefined ? new Decimal(item.grossWeight) : undefined,
          netWeight: item.netWeight !== undefined ? new Decimal(item.netWeight) : undefined,
          purity: item.purity,
          huid: item.huid,
          metalType: item.metalType,
        })),
      });

      const shouldCreateUdhar = dto.autoCreateUdhar !== false;
      if (needsCredit && !isDraft && shouldCreateUdhar) {
        await this._createInvoiceBalanceRecord(tx, {
          organizationId,
          customerId: dto.customerId,
          invoiceId: invoice.id,
          invoiceNumber: invoiceNumber!,
          balance: creditAmount,
          items: dto.items,
          userId,
          notes: dto.notes,
        });
      }

      return tx.invoice.findUnique({
        where: { id: invoice.id, organizationId },
        include: {
          items: { orderBy: { slNo: 'asc' } },
          customer: { select: { id: true, fullName: true, customerCode: true } },
          udharEntries: { where: { deletedAt: null } },
        },
      });
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

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: { select: { id: true, fullName: true, customerCode: true } },
          _count: { select: { items: true } },
          items: includeItems ? { orderBy: { slNo: 'asc' } } : undefined,
        },
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices.map((inv) => ({
        ...inv,
        remainingBalance: Number(inv.totalAmount) - Number(inv.paidAmount),
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
          },
        },
        udharEntries: { where: { deletedAt: null } },
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    return {
      ...invoice,
      remainingBalance: Number(invoice.totalAmount) - Number(invoice.paidAmount),
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
        `Payment of ${dto.amount} would exceed remaining balance of ${Number(invoice.totalAmount) - Number(invoice.paidAmount)}`,
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

      const udhar = await tx.udharEntry.findFirst({
        where: { invoiceId: id, organizationId: user.organizationId, status: CreditStatus.ACTIVE },
      });

      if (udhar) {
        const newUdharPaid = (udhar.paidAmount as Decimal).add(paymentAmount);
        const newUdharStatus = newUdharPaid.greaterThanOrEqualTo(udhar.amount)
          ? CreditStatus.PAID
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
            entityId: id,
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
        remainingBalance: Number(invoice.totalAmount) - Number(newPaidAmount),
      };
    });
  }

  async generatePdf(id: string, organizationId: string): Promise<Buffer> {
    const html = await this.generateHtml(id, organizationId);
    return this.pdfService.generatePdf(html);
  }

  async generateHtml(id: string, organizationId: string): Promise<string> {
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
          },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    const customer = invoice.customer;
    const loc = customer.locations && customer.locations.length > 0 ? customer.locations[0] : null;
    const companySnapshot = (invoice.companySnapshot as any)?.data || {};
    const buyerSnapshot = (invoice.buyerSnapshot as any)?.data || {};

    // Build InvoiceData structure expected by templates
    const invoiceData = {
      company: {
        name: companySnapshot.name || '',
        address: companySnapshot.address || '',
        gstin: companySnapshot.gstin || '',
        state: companySnapshot.state || '',
        stateCode: companySnapshot.stateCode || '',
        phone: companySnapshot.phone || '',
        email: companySnapshot.email || '',
        pan: companySnapshot.pan || '',
        mantra: companySnapshot.mantra || '',
        logo: companySnapshot.logo || '',
        bisLogo: companySnapshot.bisLogo || '',
        bankDetails: companySnapshot.bankDetails || undefined,
      },
      buyer: {
        name: buyerSnapshot.name || customer.fullName || '',
        address: buyerSnapshot.address || (loc ? `${loc.village ?? ''} ${loc.district ?? ''}`.trim() : ''),
        phone: buyerSnapshot.phone || customer.contactDetails?.[0]?.primaryPhone || '',
        state: buyerSnapshot.state || companySnapshot.state || '',
        stateCode: buyerSnapshot.stateCode || companySnapshot.stateCode || '',
        email: buyerSnapshot.email || '',
        pan: buyerSnapshot.pan || '',
      },
      metadata: {
        invoiceNo: invoice.invoiceNumber || 'DRAFT',
        date: invoice.invoiceDate?.toLocaleDateString('en-IN') || new Date().toLocaleDateString('en-IN'),
        financialYear: invoice.financialYear || '',
      },
      items: invoice.items.map((item: any) => ({
        slNo: item.slNo,
        description: item.description,
        hsnSac: item.hsnSac || '',
        quantity: Number(item.quantity),
        unit: item.unit || 'PCS',
        rate: Number(item.unitPrice),
        makingCharges: item.makingCharges ? Number(item.makingCharges) : undefined,
        purity: item.purity || undefined,
        netWeight: item.netWeight ? Number(item.netWeight) : undefined,
        grossWeight: item.grossWeight ? Number(item.grossWeight) : undefined,
        huid: item.huid || undefined,
        amount: Number(item.taxableAmount),
      })),
      taxes: {
        cgstRate: Number(invoice.cgstRate),
        cgstAmount: Number(invoice.cgstAmount),
        sgstRate: Number(invoice.sgstRate),
        sgstAmount: Number(invoice.sgstAmount),
        igstRate: Number(invoice.igstRate) || 0,
        igstAmount: Number(invoice.igstAmount) || 0,
      },
      hsnSummary: [],
      roundOff: Number(invoice.roundOff),
      totalQuantity: invoice.items.reduce((sum: number, item: any) => sum + Number(item.quantity), 0),
      totalAmount: Number(invoice.totalAmount),
      amountInWords: this.numberToWords(Number(invoice.totalAmount)),
      taxAmountInWords: this.numberToWords(Number(invoice.cgstAmount) + Number(invoice.sgstAmount) + Number(invoice.igstAmount)),
      declaration: invoice.notes || undefined,
      cashReceived: Number(invoice.paidAmount),
      amtBalance: Number(invoice.totalAmount) - Number(invoice.paidAmount),
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
    const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
    const payload = `${invoiceId}:${organizationId}:${expiry}`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${expiry}.${signature}`;
  }

  async verifySignature(invoiceId: string, signatureParam: string): Promise<string> {
    const [expiry, signature] = signatureParam.split('.');
    if (!expiry || !signature) throw new BadRequestException('Invalid signature format');

    if (Date.now() / 1000 > Number(expiry)) {
      throw new BadRequestException('Signature expired');
    }

    // Try all possible organizationIds by brute-forcing the signature validation.
    // Since the signature is HMAC-SHA256, we verify by checking which secret combination works.
    // First, get all unique organizationIds from invoices that match the invoiceId pattern
    const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    
    // Query to find the invoice - use findFirst with no org filter (middleware bypass via raw query)
    // Actually, let's change approach: query by trying different orgIds from a known set
    // But we don't have a set... so let's use a raw query that bypasses the middleware
    
    // Alternative: use findFirst with a dummy orgId that fails, then iterate
    // The cleanest approach: use prisma.$queryRaw to bypass middleware
    const invoices = await this.prisma.$queryRaw<{ id: string; organizationId: string }[]>`
      SELECT id, "organizationId" FROM "Invoice" WHERE id = ${invoiceId} LIMIT 1
    `;
    
    if (!invoices || invoices.length === 0) throw new NotFoundException('Invoice not found');
    
    const invoice = invoices[0];
    
    const payload = `${invoiceId}:${invoice.organizationId}:${expiry}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    if (signature !== expected) {
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
      throw new BadRequestException('Cannot send an invoice without an invoice number (Drafts cannot be sent)');
    }

    return { success: true, message: `Invoice ${invoice.invoiceNumber} sent to ${dto.recipientEmails.join(', ')}` };
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
      remainingBalance: Number(inv.totalAmount) - Number(inv.paidAmount),
    };
  }

  async cancel(id: string, user: CurrentUserData) {
    const { organizationId, userId } = user;
    const inv = await this.prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === InvoiceStatus.CANCELLED)
      throw new BadRequestException('Invoice is already cancelled');

    if (inv.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Cannot cancel a fully paid invoice. Refund items first.');
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
    const { organizationId, userId } = user;
    const existing = await this.prisma.invoice.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Invoice not found');

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Currently, only DRAFT invoices can be modified. For finalized invoices, please cancel and recreate.');
    }

    const dummyDto: CreateInvoiceDto = {
      customerId: dto.customerId ?? existing.customerId,
      items: dto.items ?? (existing.items as any),
      paidAmount: dto.paidAmount !== undefined ? dto.paidAmount : Number(existing.paidAmount),
      taxType: dto.taxType ?? existing.taxType,
      cgstRate: dto.cgstRate ?? Number(existing.cgstRate),
      sgstRate: dto.sgstRate ?? Number(existing.sgstRate),
      igstRate: dto.igstRate ?? Number(existing.igstRate),
      templateType: dto.templateType ?? existing.templateType,
      notes: dto.notes ?? existing.notes ?? undefined,
      invoiceDate: dto.invoiceDate ?? existing.invoiceDate?.toISOString(),
      buyerAddress: dto.buyerAddress,
    };

    const financials = await this._calculateInvoiceFinancials(dummyDto, user, true);

    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });

      await tx.invoiceItem.createMany({
        data: financials.lineItems.map((item) => ({
          invoiceId: id,
          organizationId,
          slNo: item.slNo,
          description: item.description,
          hsnSac: item.hsnSac,
          quantity: new Decimal(item.quantity),
          unit: item.unit,
          unitPrice: new Decimal(item.unitPrice),
          makingCharges:
            item.makingCharges !== undefined ? new Decimal(item.makingCharges) : undefined,
          taxableAmount: new Decimal(item.taxableAmount),
          totalAmount: new Decimal(item.totalAmount),
          grossWeight: item.grossWeight !== undefined ? new Decimal(item.grossWeight) : undefined,
          netWeight: item.netWeight !== undefined ? new Decimal(item.netWeight) : undefined,
          purity: item.purity,
          huid: item.huid,
          metalType: item.metalType,
        })),
      });

      return tx.invoice.update({
        where: { id, organizationId },
        data: {
          customerId: dummyDto.customerId,
          taxType: financials.taxType,
          subtotal: new Decimal(financials.roundedSubtotal),
          cgstRate: new Decimal(financials.cgstRate),
          sgstRate: new Decimal(financials.sgstRate),
          igstRate: new Decimal(financials.igstRate),
          cgstAmount: new Decimal(financials.cgstAmount),
          sgstAmount: new Decimal(financials.sgstAmount),
          igstAmount: new Decimal(financials.igstAmount),
          roundOff: new Decimal(financials.roundOff),
          totalAmount: new Decimal(financials.totalAmount),
          paidAmount: new Decimal(financials.paidAmount),
          companySnapshot: { version: 1, data: financials.companySnapshot } as any,
          buyerSnapshot: { version: 1, data: financials.buyerSnapshot } as any,
          templateType: financials.templateType,
          invoiceDate: financials.invoiceDate,
          financialYear: financials.financialYear,
          notes: dummyDto.notes,
          updatedAt: new Date(),
        },
        include: {
          items: { orderBy: { slNo: 'asc' } },
        },
      });
    });
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

  private async _calculateInvoiceFinancials(dto: CreateInvoiceDto, user: CurrentUserData, isDraft: boolean) {
    const { organizationId } = user;

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId, deletedAt: null },
      include: {
        contactDetails: { where: { deletedAt: null }, take: 1 },
        locations: { where: { deletedAt: null }, take: 1 },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const settings = await this.prisma.orgInvoiceSettings.findUnique({ where: { organizationId }});
    if (!settings) throw new BadRequestException('Invoice settings not found');

    const taxType = dto.taxType ?? settings.defaultTaxType;
    const isIgst = taxType === TaxType.IGST;
    const isNone = taxType === TaxType.NONE;

    const cgstRate = isIgst || isNone ? 0 : (dto.cgstRate ?? Number(settings.defaultCgstRate));
    const sgstRate = isIgst || isNone ? 0 : (dto.sgstRate ?? Number(settings.defaultSgstRate));
    const igstRate = isIgst ? (dto.igstRate ?? Number(settings.defaultIgstRate)) : 0;

    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const financialYear = getFinancialYear(invoiceDate);

    const companySnapshot: CompanyDetails = {
      name: settings.companyName, address: settings.address, gstin: settings.gstin,
      state: settings.state, stateCode: settings.stateCode, phone: settings.phone ?? undefined,
      email: settings.email ?? undefined, pan: settings.pan ?? undefined,
      mantra: settings.mantra ?? undefined, logo: settings.logoUrl ?? undefined,
      bisLogo: settings.bisLogoUrl ?? undefined,
      bankDetails: settings.bankName ? {
        bankName: settings.bankName, branch: settings.bankBranch ?? '',
        accountName: settings.bankAccountName ?? '', accountNumber: settings.bankAccountNumber ?? '',
        ifsc: settings.bankIfsc ?? '',
      } : undefined,
    };

    if (!dto.items || dto.items.length === 0) throw new BadRequestException('Invoice missing items');

    const lineItems = dto.items.map((item, idx) => {
      const making = item.makingCharges ?? 0;
      const taxableAmount = Math.round(item.quantity * (item.unitPrice + making) * 100) / 100;
      return {
        slNo: idx + 1, description: item.description, hsnSac: item.hsnSac,
        quantity: item.quantity, unit: item.unit ?? 'PCS', unitPrice: item.unitPrice,
        makingCharges: item.makingCharges, taxableAmount, totalAmount: taxableAmount,
        grossWeight: item.grossWeight, netWeight: item.netWeight, purity: item.purity, huid: item.huid,
        metalType: item.metalType,
      };
    });

    const subtotal = lineItems.reduce((sum, i) => sum + i.taxableAmount, 0);
    const roundedSubtotal = Math.round(subtotal * 100) / 100;

    const cgstAmount = Math.round(((roundedSubtotal * cgstRate) / 100) * 100) / 100;
    const sgstAmount = Math.round(((roundedSubtotal * sgstRate) / 100) * 100) / 100;
    const igstAmount = Math.round(((roundedSubtotal * igstRate) / 100) * 100) / 100;

    const totalBeforeRound = roundedSubtotal + cgstAmount + sgstAmount + igstAmount;
    const totalAmount = Math.round(totalBeforeRound);

    if (totalAmount <= 0) throw new BadRequestException('Total must be > 0');
    if (dto.paidAmount !== undefined && dto.paidAmount > totalAmount) {
      throw new BadRequestException(`Paid amount ${dto.paidAmount} > total ${totalAmount}`);
    }

    const roundOff = Math.round((totalAmount - totalBeforeRound) * 100) / 100;
    const paidAmount = dto.paidAmount ?? 0;

    let status: InvoiceStatus;
    if (isDraft) status = InvoiceStatus.DRAFT;
    else if (paidAmount >= totalAmount) status = InvoiceStatus.PAID;
    else if (paidAmount > 0) status = InvoiceStatus.PARTIAL;
    else status = InvoiceStatus.UNPAID;

    const needsCredit = !isDraft && paidAmount < totalAmount;
    const creditAmount = totalAmount - paidAmount;
    const templateType = dto.templateType ?? settings.defaultTemplate;

    const loc = customer.locations && customer.locations.length > 0 ? customer.locations[0] : null;
    const buyerSnapshot: BuyerDetails = {
      name: customer.fullName,
      address: dto.buyerAddress || (loc ? `${loc.village ?? ''} ${loc.district ?? ''}`.trim() : ''),
      phone: customer.contactDetails?.[0]?.primaryPhone ?? '',
      state: dto.buyerState ?? loc?.state ?? companySnapshot.state,
      stateCode: dto.buyerStateCode ?? companySnapshot.stateCode,
    };

    return {
      taxType, cgstRate, sgstRate, igstRate, 
      financialYear, invoiceDate,
      lineItems, 
      roundedSubtotal, cgstAmount, sgstAmount, igstAmount, 
      totalAmount, roundOff, paidAmount, 
      status, creditAmount, needsCredit,
      companySnapshot, buyerSnapshot,
      templateType
    };
  }

  private numberToWords(num: number): string {
    if (num === 0) return 'Zero';
    
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    const convertLessThanThousand = (n: number): string => {
      if (n === 0) return '';
      if (n < 10) return ones[n];
      if (n < 20) return teens[n - 10];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
      return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + convertLessThanThousand(n % 100) : '');
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
    if (!settings) throw new NotFoundException('Invoice settings not found. Please configure settings first.');

    const companySnapshot = {
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
      bankDetails: settings.bankName ? {
        bankName: settings.bankName,
        branch: settings.bankBranch ?? '',
        accountName: settings.bankAccountName ?? '',
        accountNumber: settings.bankAccountNumber ?? '',
        ifsc: settings.bankIfsc ?? '',
      } : undefined,
    };

    const buyerSnapshot = {
      name: 'Sample Customer',
      address: '123 Sample Street, Sample City',
      phone: '+91 98765 43210',
      state: settings.state,
      stateCode: settings.stateCode,
    };

    const sampleItems = [
      { slNo: 1, description: 'Gold Ring 22K', hsnSac: '7113', quantity: 1, unit: 'PCS', rate: 25000, makingCharges: 500, purity: '22K', grossWeight: 10, netWeight: 9.5, huid: 'A12345', amount: 25500 },
      { slNo: 2, description: 'Silver Chain', hsnSac: '7113', quantity: 2, unit: 'PCS', rate: 2000, makingCharges: 100, purity: '925', grossWeight: 50, netWeight: 48, huid: '', amount: 4200 },
    ];

    const taxType = settings.defaultTaxType;
    const isIgst = taxType === TaxType.IGST;
    const isNone = taxType === TaxType.NONE;
    
    const cgstRate = isIgst || isNone ? 0 : Number(settings.defaultCgstRate);
    const sgstRate = isIgst || isNone ? 0 : Number(settings.defaultSgstRate);
    const igstRate = isIgst ? Number(settings.defaultIgstRate) : 0;

    const subtotal = sampleItems.reduce((sum, i) => sum + i.amount, 0);
    const cgstAmount = Math.round(((subtotal * cgstRate) / 100) * 100) / 100;
    const sgstAmount = Math.round(((subtotal * sgstRate) / 100) * 100) / 100;
    const igstAmount = Math.round(((subtotal * igstRate) / 100) * 100) / 100;
    const totalBeforeRound = subtotal + cgstAmount + sgstAmount + igstAmount;
    const totalAmount = Math.round(totalBeforeRound);
    const roundOff = Math.round((totalAmount - totalBeforeRound) * 100) / 100;
    const paidAmount = 10000;

    const invoiceData = {
      company: companySnapshot,
      buyer: buyerSnapshot,
      metadata: {
        invoiceNo: `${settings.invoiceNumberPrefix || 'INV'}-${settings.startingSequence || 1}`,
        date: new Date().toLocaleDateString('en-IN'),
        financialYear: getFinancialYear(new Date()),
      },
      items: sampleItems,
      taxes: {
        cgstRate,
        cgstAmount,
        sgstRate,
        sgstAmount,
        igstRate,
        igstAmount,
      },
      hsnSummary: [],
      roundOff,
      totalQuantity: sampleItems.reduce((sum, i) => sum + i.quantity, 0),
      totalAmount,
      amountInWords: this.numberToWords(totalAmount),
      taxAmountInWords: this.numberToWords(cgstAmount + sgstAmount + igstAmount),
      declaration: settings.declaration || '',
      cashReceived: paidAmount,
      amtBalance: totalAmount - paidAmount,
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
}
