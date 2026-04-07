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
import { CompanyDetails, BuyerDetails } from './utils/invoice-types';
import { InvoiceCalculationService } from './utils/invoice-calculation.service';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly pdfService: PdfService,
    private readonly calcService: InvoiceCalculationService,
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
    const paidAmount = new Decimal(dto.paidAmount ?? draft.paidAmount);
    const totalAmount = new Decimal(draft.totalAmount);
    const balance = totalAmount.minus(paidAmount);

    let status: InvoiceStatus = InvoiceStatus.PAID;
    if (balance.gt(0)) {
      status = paidAmount.gt(0) ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID;
    }

    return this.prisma.$transaction(async (tx) => {
      let invoiceNumber = dto.manualInvoiceNumber;
      let sequenceVal = draft.sequence;

      if (!invoiceNumber) {
        // Retry loop to handle race condition on first sequence creation
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

            sequenceVal = seqRec.nextSequence - 1;
            const prefix = settings.invoiceNumberPrefix ?? 'INV';
            invoiceNumber = `${prefix}/${sequenceVal}/${financialYear}`;
            break;
          } catch (error: any) {
            attempts++;
            if (attempts >= maxAttempts || !error.code || error.code !== 'P2002') {
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          }
        }
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
      templateType,
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

      // Generate invoice number for non-draft invoices
      if (!isDraft) {
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

            sequenceVal = seqRec.nextSequence - 1;
            const prefix = settings.invoiceNumberPrefix ?? 'INV';
            invoiceNumber = `${prefix}/${sequenceVal}/${financialYear}`;
            break;
          } catch (error: any) {
            attempts++;
            if (attempts >= maxAttempts || !error.code || error.code !== 'P2002') {
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          }
        }
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
          modeOfPayment: dto.modeOfPayment,
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
          },
        },
        udharEntries: { where: { deletedAt: null } },
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    return {
      ...invoice,
      remainingBalance: new Decimal(invoice.totalAmount)
        .minus(new Decimal(invoice.paidAmount))
        .toNumber(),
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
        paidAmount: newPaidAmount,
        remainingBalance: new Decimal(invoice.totalAmount).minus(newPaidAmount).toNumber(),
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
        address:
          buyerSnapshot.address || (loc ? `${loc.village ?? ''} ${loc.district ?? ''}`.trim() : ''),
        phone: buyerSnapshot.phone || customer.contactDetails?.[0]?.primaryPhone || '',
        state: buyerSnapshot.state || companySnapshot.state || '',
        stateCode: buyerSnapshot.stateCode || companySnapshot.stateCode || '',
        email: buyerSnapshot.email || '',
        pan: buyerSnapshot.pan || '',
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
        purity: item.purity || undefined,
        netWeight: item.netWeight ? new Decimal(item.netWeight).toNumber() : undefined,
        grossWeight: item.grossWeight ? new Decimal(item.grossWeight).toNumber() : undefined,
        huid: item.huid || undefined,
        amount: new Decimal(item.taxableAmount).toNumber(),
      })),
      taxes: {
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
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Invoice not found');

    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        'Currently, only DRAFT invoices can be modified. For finalized invoices, please cancel and recreate.',
      );
    }

    const dummyDto: CreateInvoiceDto = {
      customerId: dto.customerId ?? existing.customerId,
      items: dto.items ?? (existing.items as any),
      paidAmount:
        dto.paidAmount !== undefined ? dto.paidAmount : new Decimal(existing.paidAmount).toNumber(),
      templateType: dto.templateType ?? existing.templateType,
      modeOfPayment: dto.modeOfPayment ?? existing.modeOfPayment,
      deliveryNote: dto.deliveryNote ?? existing.deliveryNote,
      dispatchDocNo: dto.dispatchDocNo ?? existing.dispatchDocNo,
      destination: dto.destination ?? existing.destination,
      invoiceDate: dto.invoiceDate ?? existing.invoiceDate?.toISOString(),
      buyerAddress: dto.buyerAddress,
      autoCreateUdhar: dto.autoCreateUdhar ?? (existing as any).autoCreateUdhar,
    };

    const financials = await this._calculateInvoiceFinancials(dummyDto, user, true);

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

      return tx.invoice.update({
        where: { id, organizationId },
        data: {
          customerId: dummyDto.customerId,
          taxType: financials.taxType,
          placeOfSupply: financials.placeOfSupply,
          subtotal: new Decimal(financials.subtotal),
          cgstRate: new Decimal(financials.cgstRate),
          sgstRate: new Decimal(financials.sgstRate),
          igstRate: new Decimal(financials.igstRate),
          cgstAmount: new Decimal(financials.cgstAmount),
          sgstAmount: new Decimal(financials.sgstAmount),
          igstAmount: new Decimal(financials.igstAmount),
          totalHallmarkingCharges: new Decimal(financials.totalHallmarkingCharges),
          roundOff: new Decimal(financials.roundOff),
          totalAmount: new Decimal(financials.grandTotal),
          paidAmount: new Decimal(financials.paidAmount),
          metalRateSource: financials.metalRateSource,
          metalRateDate: financials.metalRateDate,
          companySnapshot: { version: 1, data: financials.companySnapshot } as any,
          buyerSnapshot: { version: 1, data: financials.buyerSnapshot } as any,
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
        },
      });
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
    const [settings, customer, configItems] = await Promise.all([
      this.prisma.orgInvoiceSettings.findUnique({ where: { organizationId } }),
      this.prisma.customer.findUnique({
        where: { id: dto.customerId, organizationId },
        include: { contactDetails: true, locations: true },
      }),
      this.prisma.systemConfig.findMany({
        where: { key: { in: ['HALLMARKING_CHARGE_PER_ITEM', 'GOLD_GST_RATE', 'SILVER_GST_RATE'] } },
      }),
    ]);

    if (!settings) throw new BadRequestException('Invoice settings not found');
    if (!customer) throw new BadRequestException('Customer not found');

    const config = Object.fromEntries(configItems.map((c) => [c.key, c.value]));
    const hallmarkingChargePerItem = new Decimal(config['HALLMARKING_CHARGE_PER_ITEM'] || '45.00');

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
        metalRate: item.metalRate,
        purityValue: item.purityValue,
        purityBasis: item.purityBasis,
        grossWeight: item.grossWeight,
        stoneWeight: item.stoneWeight ?? 0,
        makingCharges: item.makingCharges ?? 0,
        makingChargesType: item.makingChargesType ?? MakingChargesType.PER_GRAM,
        stoneCharges: item.stoneCharges ?? 0,
        isHallmarked: !!item.isHallmarked,
        hallmarkingCharge: hallmarkingChargePerItem,
      });

      return {
        ...item,
        slNo: index + 1,
        ...computed,
        hallmarkingCharge: item.isHallmarked ? hallmarkingChargePerItem : new Decimal(0),
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
    const companySnapshot: CompanyDetails = {
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
      bankDetails: settings.bankName
        ? {
            bankName: settings.bankName,
            branch: settings.bankBranch ?? '',
            accountName: settings.bankAccountName ?? '',
            accountNumber: settings.bankAccountNumber ?? '',
            ifsc: settings.bankIfsc ?? '',
          }
        : undefined,
    };

    const loc = customer.locations?.[0] || null;
    const buyerSnapshot: BuyerDetails = {
      name: customer.fullName,
      address: dto.buyerAddress || (loc ? `${loc.village ?? ''} ${loc.district ?? ''}`.trim() : ''),
      phone: customer.contactDetails?.[0]?.primaryPhone ?? '',
      state: dto.buyerState || loc?.state || '',
      stateCode: dto.buyerStateCode || loc?.district || '', // district often used for local codes if state matches
    };

    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const financialYear = getFinancialYear(invoiceDate);
    const paidAmount = new Decimal(dto.paidAmount || 0);

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
      summary.cgstAmount = Math.round(((summary.taxableValue * summary.cgstRate) / 100) * 100) / 100;
      summary.sgstAmount = Math.round(((summary.taxableValue * summary.sgstRate) / 100) * 100) / 100;
      summary.igstAmount = Math.round(((summary.taxableValue * summary.igstRate) / 100) * 100) / 100;
      summary.totalTaxAmount = summary.cgstAmount + summary.sgstAmount + summary.igstAmount;
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
      bankDetails: settings.bankName
        ? {
            bankName: settings.bankName,
            branch: settings.bankBranch ?? '',
            accountName: settings.bankAccountName ?? '',
            accountNumber: settings.bankAccountNumber ?? '',
            ifsc: settings.bankIfsc ?? '',
          }
        : undefined,
    };

    const buyerSnapshot = {
      name: 'Sample Customer',
      address: '123 Sample Street, Sample City',
      phone: '+91 98765 43210',
      state: settings.state,
      stateCode: settings.stateCode,
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
        netWeight: 9.5,
        huid: 'A12345',
        amount: 25500,
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
        netWeight: 48,
        huid: '',
        amount: 4200,
      },
    ];

    const taxType = settings.defaultTaxType;
    const isIgst = taxType === TaxType.IGST;
    const isNone = taxType === TaxType.NONE;

    const cgstRate = isIgst || isNone ? 0 : new Decimal(settings.defaultCgstRate).toNumber();
    const sgstRate = isIgst || isNone ? 0 : new Decimal(settings.defaultSgstRate).toNumber();
    const igstRate = isIgst ? new Decimal(settings.defaultIgstRate).toNumber() : 0;

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
      hsnSummary: this._calculateHsnSummary(
        sampleItems.map((i) => ({ hsnSac: i.hsnSac, amount: i.amount })),
        { cgstRate, sgstRate, igstRate },
      ),
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
