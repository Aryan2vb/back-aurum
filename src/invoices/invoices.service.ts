import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateOrgInvoiceSettingsDto } from './dto/create-org-invoice-settings.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { CurrentUserData } from '../auth/current-user.decorator';
import { CreditStatus, InvoiceStatus, Prisma, TaxType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { calculateInvoiceData, getFinancialYear, numberToIndianWords } from './utils/invoice-calculations';
import { generateInvoiceHtml } from './utils/generate-invoice-html';
import { generateJewelleryInvoiceHtml } from './utils/generate-jewellery-html';
import { generateModernInvoiceHtml } from './utils/generate-modern-html';
import { PdfService } from './utils/pdf.service';
import { CompanyDetails, BuyerDetails, HsnSummary, InvoiceData, TaxDetails } from './utils/invoice-types';

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
                defaultCgstRate: dto.defaultCgstRate !== undefined ? new Decimal(dto.defaultCgstRate) : undefined,
                defaultSgstRate: dto.defaultSgstRate !== undefined ? new Decimal(dto.defaultSgstRate) : undefined,
                defaultIgstRate: dto.defaultIgstRate !== undefined ? new Decimal(dto.defaultIgstRate) : undefined,
                defaultTemplate: dto.defaultTemplate,
                declaration: dto.declaration,
                termsOfDelivery: dto.termsOfDelivery,
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
                defaultCgstRate: dto.defaultCgstRate !== undefined ? new Decimal(dto.defaultCgstRate) : undefined,
                defaultSgstRate: dto.defaultSgstRate !== undefined ? new Decimal(dto.defaultSgstRate) : undefined,
                defaultIgstRate: dto.defaultIgstRate !== undefined ? new Decimal(dto.defaultIgstRate) : undefined,
                defaultTemplate: dto.defaultTemplate,
                declaration: dto.declaration,
                termsOfDelivery: dto.termsOfDelivery,
            },
        });
    }

    async getSettings(organizationId: string) {
        const settings = await this.prisma.orgInvoiceSettings.findUnique({
            where: { organizationId },
        });
        if (!settings) {
            throw new NotFoundException('Invoice settings not configured. Please POST /invoices/settings first.');
        }
        return settings;
    }

    // ===========================
    // INVOICE CREATION
    // ===========================

    /** Finalise path: assigns invoice number, status logic, creates Credit if needed. */
    async create(dto: CreateInvoiceDto, user: CurrentUserData) {
        return this._persistInvoice(dto, user, /* isDraft */ false);
    }

    /** Draft path: no invoice number, no Credit created, status = DRAFT. */
    async createDraft(dto: CreateInvoiceDto, user: CurrentUserData) {
        return this._persistInvoice(dto, user, /* isDraft */ true);
    }

    private async _persistInvoice(dto: CreateInvoiceDto, user: CurrentUserData, isDraft: boolean) {
        const { organizationId, userId } = user;

        // ── 1. Customer ──────────────────────────────────────────────────────────
        const customer = await this.prisma.customer.findFirst({
            where: { id: dto.customerId, organizationId, deletedAt: null },
            include: {
                contactDetails: { where: { deletedAt: null }, take: 1 },
                locations: { where: { deletedAt: null }, take: 1 },
            },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        // ── 2. Org invoice settings ──────────────────────────────────────────────
        const settings = await this.prisma.orgInvoiceSettings.findUnique({
            where: { organizationId },
        });
        if (!settings) {
            throw new BadRequestException(
                'Invoice settings not configured. Please set up via POST /invoices/settings first.',
            );
        }

        // ── 3. Resolve tax rates ──────────────────────────────────────────────────
        const taxType = dto.taxType ?? settings.defaultTaxType;
        const isIgst = taxType === TaxType.IGST;
        const isNone = taxType === TaxType.NONE;

        const cgstRate = isIgst || isNone ? 0 : (dto.cgstRate ?? Number(settings.defaultCgstRate));
        const sgstRate = isIgst || isNone ? 0 : (dto.sgstRate ?? Number(settings.defaultSgstRate));
        const igstRate = isIgst ? (dto.igstRate ?? Number(settings.defaultIgstRate)) : 0;

        // ── 4. Calculate financials ──────────────────────────────────────────────
        const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
        const financialYear = getFinancialYear(invoiceDate);

        const companySnapshot: CompanyDetails = {
            name: settings.companyName,
            address: settings.address,
            gstin: settings.gstin,
            state: settings.state,
            stateCode: settings.stateCode,
            phone: settings.phone ?? undefined,
            email: settings.email ?? undefined,
            pan: settings.pan ?? undefined,
            mantra: settings.mantra ?? undefined,
            logo: settings.logoUrl ?? undefined,
            bisLogo: settings.bisLogoUrl ?? undefined,
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

        if (!dto.items || dto.items.length === 0) {
            throw new BadRequestException('Invoice must have at least one item');
        }

        // Build items and compute subtotal / taxes
        const lineItems = dto.items.map((item, idx) => {
            const making = item.makingCharges ?? 0;
            const taxableAmount = Math.round((item.quantity * (item.unitPrice + making)) * 100) / 100;
            return {
                slNo: idx + 1,
                description: item.description,
                hsnSac: item.hsnSac,
                quantity: item.quantity,
                unit: item.unit ?? 'PCS',
                unitPrice: item.unitPrice,
                makingCharges: item.makingCharges,
                taxableAmount,
                totalAmount: taxableAmount,
                grossWeight: item.grossWeight,
                netWeight: item.netWeight,
                purity: item.purity,
                huid: item.huid,
            };
        });

        const subtotal = lineItems.reduce((sum, i) => sum + i.taxableAmount, 0);
        const roundedSubtotal = Math.round(subtotal * 100) / 100;

        const cgstAmount = Math.round(roundedSubtotal * cgstRate / 100 * 100) / 100;
        const sgstAmount = Math.round(roundedSubtotal * sgstRate / 100 * 100) / 100;
        const igstAmount = Math.round(roundedSubtotal * igstRate / 100 * 100) / 100;

        const totalBeforeRound = roundedSubtotal + cgstAmount + sgstAmount + igstAmount;
        const totalAmount = Math.round(totalBeforeRound);

        if (totalAmount <= 0) {
            throw new BadRequestException('Invoice total amount must be greater than zero');
        }

        if (dto.paidAmount !== undefined && dto.paidAmount > totalAmount) {
            throw new BadRequestException(`Paid amount cannot exceed total amount of ${totalAmount}`);
        }

        const roundOff = Math.round((totalAmount - totalBeforeRound) * 100) / 100;

        const paidAmount = dto.paidAmount ?? 0;

        // ── 5. Determine status ───────────────────────────────────────────────────
        let status: InvoiceStatus;
        if (isDraft) {
            status = InvoiceStatus.DRAFT;
        } else if (paidAmount >= totalAmount) {
            status = InvoiceStatus.PAID;
        } else if (paidAmount > 0) {
            status = InvoiceStatus.PARTIAL;
        } else {
            status = InvoiceStatus.UNPAID;
        }

        const needsCredit = !isDraft && paidAmount < totalAmount;
        const creditAmount = totalAmount - paidAmount;
        const templateType = dto.templateType ?? settings.defaultTemplate;
        
        const loc = customer.locations && customer.locations.length > 0 ? (customer as any).locations[0] : null;
        const buyerAddress = dto.buyerAddress
            ? dto.buyerAddress
            : (loc ? `${loc.village ?? ''} ${loc.district ?? ''}`.trim() : '');

        const buyerPhone = (customer as any).contactDetails && (customer as any).contactDetails.length > 0 
            ? (customer as any).contactDetails[0].primaryPhone 
            : '';

        // ── 6. Persist in a single transaction ────────────────────────────────────
        return this.prisma.$transaction(async (tx) => {
            // 6a. Assign sequential invoice number if finalising
            let invoiceNumber: string | null = null;
            let sequenceVal: number | null = null;
            if (!isDraft) {
                let seqRec = await tx.invoiceSequence.findUnique({
                    where: { organizationId_financialYear: { organizationId, financialYear } }
                });
                
                if (!seqRec) {
                    seqRec = await tx.invoiceSequence.create({
                        data: { organizationId, financialYear, nextSequence: 2 }
                    });
                    sequenceVal = 1;
                } else {
                    sequenceVal = seqRec.nextSequence;
                    await tx.invoiceSequence.update({
                        where: { id: seqRec.id },
                        data: { nextSequence: sequenceVal + 1 }
                    });
                }
                
                invoiceNumber = `IS/${sequenceVal}/${financialYear}`;
                this.logger.log(`Assigned invoice number: ${invoiceNumber}`);
            }

            // 6b. Create invoice
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

            // 6c. Create invoice items
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
                    makingCharges: item.makingCharges !== undefined ? new Decimal(item.makingCharges) : undefined,
                    taxableAmount: new Decimal(item.taxableAmount),
                    totalAmount: new Decimal(item.totalAmount),
                    grossWeight: item.grossWeight !== undefined ? new Decimal(item.grossWeight) : undefined,
                    netWeight: item.netWeight !== undefined ? new Decimal(item.netWeight) : undefined,
                    purity: item.purity,
                    huid: item.huid,
                })),
            });

            // 6d. Create Credit for unpaid balance
            if (needsCredit) {
                const itemSummary = dto.items
                    .slice(0, 3)
                    .map((i) => i.description)
                    .join(', ');

                const credit = await tx.credit.create({
                    data: {
                        organizationId,
                        customerId: dto.customerId,
                        totalAmount: new Decimal(creditAmount),
                        paidAmount: new Decimal(0),
                        status: CreditStatus.ACTIVE,
                        saleReference: invoiceNumber,
                        itemSummary,
                        createdById: userId,
                    },
                    select: { id: true },
                });

                // 6e. Link credit back to invoice
                await tx.invoice.update({
                    where: { id: invoice.id },
                    data: { creditId: credit.id },
                });

                this.logger.log(
                    `Credit created: ${credit.id} for invoice ${invoiceNumber}, amount: ${creditAmount}`,
                );
            }

            return tx.invoice.findUnique({
                where: { id: invoice.id },
                include: {
                    items: { orderBy: { slNo: 'asc' } },
                    customer: { select: { id: true, fullName: true, customerCode: true } },
                    credit: { select: { id: true, status: true, totalAmount: true, paidAmount: true } },
                },
            });
        });
    }

    // ===========================
    // QUERIES
    // ===========================

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
                credit: {
                    include: {
                        transactions: { orderBy: { transactionDate: 'desc' } },
                    },
                },
                createdBy: { select: { id: true, fullName: true, email: true } },
            },
        });

        if (!invoice) throw new NotFoundException('Invoice not found');

        return {
            ...invoice,
            remainingBalance: Number(invoice.totalAmount) - Number(invoice.paidAmount),
        };
    }

    // ===========================
    // PAYMENT
    // ===========================

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

        // System invariant: An Invoice may be linked to a single Credit if there is an unpaid balance.
        // When payment is recorded on the Invoice, the corresponding Credit should be treated as the source of truth for payment tracking
        // over time, but both balances must be updated synchronously.
        return this.prisma.$transaction(async (tx) => {
            // Update invoice
            const updatedInvoice = await tx.invoice.update({
                where: { id, organizationId: user.organizationId },
                data: {
                    paidAmount: newPaidAmount,
                    status: newInvoiceStatus,
                },
            });

            // If linked to a Credit: create CreditTransaction + update Credit
            if (invoice.creditId) {
                const credit = await tx.credit.findUnique({ where: { id: invoice.creditId } });

                if (credit && credit.status !== CreditStatus.CANCELLED) {
                    const newCreditPaid = (credit.paidAmount as Decimal).add(paymentAmount);
                    const cappedPaid = newCreditPaid.greaterThan(credit.totalAmount)
                        ? credit.totalAmount
                        : newCreditPaid;
                    const newCreditStatus = cappedPaid.greaterThanOrEqualTo(credit.totalAmount)
                        ? CreditStatus.PAID
                        : CreditStatus.ACTIVE;

                    await tx.creditTransaction.create({
                        data: {
                            creditId: invoice.creditId,
                            organizationId: user.organizationId,
                            amount: paymentAmount,
                            transactionDate: dto.transactionDate ? new Date(dto.transactionDate) : new Date(),
                            paymentMethod: dto.paymentMethod,
                            referenceNumber: dto.referenceNumber,
                            collectedBy: dto.collectedBy,
                            notes: dto.notes ?? `Payment via invoice ${invoice.invoiceNumber}`,
                            createdById: user.userId,
                        },
                    });

                    await tx.credit.update({
                        where: { id: invoice.creditId, organizationId: user.organizationId },
                        data: {
                            paidAmount: cappedPaid,
                            lastPaymentDate: new Date(),
                            status: newCreditStatus,
                            nextReminderDate: newCreditStatus === CreditStatus.PAID ? null : undefined,
                        },
                    });

                    this.logger.log(
                        `Credit ${invoice.creditId} updated to ${newCreditStatus}, paid: ${cappedPaid}`,
                    );
                }
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

    // ===========================
    // PDF GENERATION
    // ===========================

    async generatePdf(id: string, organizationId: string): Promise<Buffer> {
        const invoice = await this.findOne(id, organizationId);
        const html = this._buildInvoiceHtml(invoice);
        return this.pdfService.generatePdf(html);
    }

    async generateHtml(id: string, organizationId: string): Promise<string> {
        const invoice = await this.findOne(id, organizationId);
        return this._buildInvoiceHtml(invoice);
    }

    private _buildInvoiceHtml(invoice: any): string {
        const snapshot = invoice.companySnapshot as any;
        const company = snapshot?.version === 1 ? snapshot.data : snapshot;
        const customer = invoice.customer;

        const buyerPhone = customer.contactDetails?.[0]?.primaryPhone ?? '';
        const loc = customer.locations?.[0];
        const buyerAddress = loc
            ? [loc.village, loc.tehsil, loc.district, loc.state, loc.pincode]
                  .filter(Boolean)
                  .join(', ')
            : '';

        const buyer: BuyerDetails = {
            name: customer.fullName,
            address: buyerAddress,
            phone: buyerPhone,
            state: loc?.state ?? company.state,
            stateCode: company.stateCode,
        };

        const dateFmt = new Intl.DateTimeFormat('en-IN', {
            day: '2-digit', month: '2-digit', year: 'numeric',
        }).format(new Date(invoice.invoiceDate));

        const metadata = {
            invoiceNo: invoice.invoiceNumber ?? 'DRAFT',
            date: dateFmt,
            deliveryNote: invoice.deliveryNote ?? '',
            modeOfPayment: invoice.modeOfPayment ?? '',
            dispatchDocNo: invoice.dispatchDocNo ?? '',
            destination: invoice.destination ?? '',
            termsOfDelivery: invoice.termsOfDelivery ?? '',
        };

        const items = (invoice.items as any[]).map((item) => ({
            slNo: item.slNo,
            description: item.description,
            hsnSac: item.hsnSac,
            quantity: Number(item.quantity),
            unit: item.unit,
            rate: Number(item.unitPrice),
            makingCharges: item.makingCharges !== null ? Number(item.makingCharges) : undefined,
            grossWeight: item.grossWeight !== null ? Number(item.grossWeight) : undefined,
            netWeight: item.netWeight !== null ? Number(item.netWeight) : undefined,
            purity: item.purity ?? undefined,
            huid: item.huid ?? undefined,
            amount: Number(item.taxableAmount),
        }));

        const cgstRate = Number(invoice.cgstRate);
        const sgstRate = Number(invoice.sgstRate);
        const igstRate = Number(invoice.igstRate);

        const taxes: TaxDetails = {
            cgstRate,
            cgstAmount: Number(invoice.cgstAmount),
            sgstRate,
            sgstAmount: Number(invoice.sgstAmount),
            igstRate: igstRate > 0 ? igstRate : undefined,
            igstAmount: igstRate > 0 ? Number(invoice.igstAmount) : undefined,
        };

        // HSN summary
        const hsnMap = new Map<string, { taxableValue: number }>();
        items.forEach((item) => {
            const e = hsnMap.get(item.hsnSac) ?? { taxableValue: 0 };
            e.taxableValue += item.amount;
            hsnMap.set(item.hsnSac, e);
        });
        const hsnSummary: HsnSummary[] = Array.from(hsnMap.entries()).map(([hsnSac, d]) => {
            const hsnCgst = Math.round(d.taxableValue * cgstRate / 100 * 100) / 100;
            const hsnSgst = Math.round(d.taxableValue * sgstRate / 100 * 100) / 100;
            return {
                hsnSac,
                taxableValue: Math.round(d.taxableValue * 100) / 100,
                cgstRate,
                cgstAmount: hsnCgst,
                sgstRate,
                sgstAmount: hsnSgst,
                totalTaxAmount: Math.round((hsnCgst + hsnSgst) * 100) / 100,
            };
        });

        const totalAmount = Number(invoice.totalAmount);
        const paidAmount = Number(invoice.paidAmount);
        const taxAmount =
            Number(invoice.cgstAmount) + Number(invoice.sgstAmount) + Number(invoice.igstAmount);

        const invoiceData: InvoiceData = {
            company,
            buyer,
            metadata,
            items,
            taxes,
            hsnSummary,
            roundOff: Number(invoice.roundOff),
            totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
            totalAmount,
            amountInWords: numberToIndianWords(totalAmount),
            taxAmountInWords: numberToIndianWords(taxAmount),
            // Jewellery extras
            cashReceived: paidAmount,
            amtBalance: totalAmount - paidAmount,
        };

        if (invoice.templateType === 'jewellery') {
            return generateJewelleryInvoiceHtml(invoiceData);
        } else if (invoice.templateType === 'modern') {
            return generateModernInvoiceHtml(invoiceData);
        } else {
            return generateInvoiceHtml(invoiceData);
        }
    }

    // ===========================
    // SEND (PLACEHOLDER)
    // ===========================

    async send(id: string, dto: SendInvoiceDto, user: CurrentUserData) {
        const invoice = await this.prisma.invoice.findFirst({
            where: { id, organizationId: user.organizationId, deletedAt: null },
        });
        if (!invoice) throw new NotFoundException('Invoice not found');

        if (!invoice.invoiceNumber) {
            throw new BadRequestException('Cannot send an invoice without an invoice number (Drafts cannot be sent)');
        }

        if (invoice.status === InvoiceStatus.PARTIAL) {
            throw new BadRequestException('Cannot send an invoice in PARTIAL payment state through this action');
        }

        // Placeholder — real WhatsApp/Email integration is out of MVP scope
        this.logger.log(
            `[PLACEHOLDER] Sending invoice ${invoice.invoiceNumber} via ${dto.channel} to ${dto.phoneNumber ?? dto.email}`,
        );

        // Mark as SENT if it was DRAFT or UNPAID
        if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.UNPAID) {
            await this.prisma.invoice.update({
                where: { id, organizationId: user.organizationId },
                data: { status: InvoiceStatus.SENT },
            });
        }

        return {
            sent: true,
            channel: dto.channel,
            invoiceNumber: invoice.invoiceNumber,
            message: 'Dispatch placeholder — real integration coming in a future release.',
        };
    }

    // ===========================
    // CANCEL (SOFT DELETE)
    // ===========================

    async cancel(id: string, user: CurrentUserData) {
        const invoice = await this.prisma.invoice.findFirst({
            where: { id, organizationId: user.organizationId, deletedAt: null },
        });
        if (!invoice) throw new NotFoundException('Invoice not found');

        if (invoice.status === InvoiceStatus.PAID) {
            throw new BadRequestException('Cannot cancel a fully paid invoice');
        }

        return this.prisma.$transaction(async (tx) => {
            await tx.invoice.update({
                where: { id, organizationId: user.organizationId },
                data: { status: InvoiceStatus.CANCELLED, deletedAt: new Date() },
            });

            // Cancel linked credit if present
            if (invoice.creditId) {
                await tx.credit.update({
                    where: { id: invoice.creditId, organizationId: user.organizationId },
                    data: { status: CreditStatus.CANCELLED },
                });
            }

            return { cancelled: true, invoiceId: id };
        });
    }
}
