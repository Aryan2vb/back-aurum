import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateOrgInvoiceSettingsDto } from './dto/create-org-invoice-settings.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { OrganizationRole } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(private readonly invoicesService: InvoicesService) {}

  // ===========================
  // ORG INVOICE SETTINGS
  // NOTE: /settings routes declared before /:id to avoid routing conflicts
  // ===========================

  @Post('settings')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  upsertSettings(@Body() dto: CreateOrgInvoiceSettingsDto, @CurrentUser() user: CurrentUserData) {
    this.logger.log(`POST /invoices/settings for org ${user.organizationId}`);
    return this.invoicesService.upsertSettings(dto, user);
  }

  @Get('settings')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getSettings(@CurrentUser() user: CurrentUserData) {
    return this.invoicesService.getSettings(user.organizationId);
  }

  // ===========================
  // DRAFT
  // NOTE: /draft before /:id
  // ===========================

  @Post('draft')
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  createDraft(@Body() dto: CreateInvoiceDto, @CurrentUser() user: CurrentUserData) {
    this.logger.log(`POST /invoices/draft for customer ${dto.customerId}`);
    return this.invoicesService.createDraft(dto, user);
  }

  // ===========================
  // INVOICE CRUD
  // ===========================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: CurrentUserData) {
    this.logger.log(`POST /invoices for customer ${dto.customerId}`);
    return this.invoicesService.create(dto, user);
  }

  @Get()
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  findAll(@Query() query: QueryInvoicesDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.findAll(query, user.organizationId);
  }

  @Get(':id')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.findOne(id, user.organizationId);
  }

  // ===========================
  // PAYMENT
  // ===========================

  @Patch(':id/payment')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    this.logger.log(`PATCH /invoices/${id}/payment — amount: ${dto.amount}`);
    return this.invoicesService.recordPayment(id, dto, user);
  }

  // ===========================
  // PDF
  // ===========================

  @Get(':id/pdf')
  @Public()
  async getPdf(
    @Param('id') id: string,
    @Query('signature') signature: string,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    this.logger.log(`GET /invoices/${id}/pdf`);
    let orgId = user?.organizationId;

    if (!orgId) {
      if (!signature) throw new ForbiddenException('Missing authorization');
      orgId = await this.invoicesService.verifySignature(id, signature);
    }

    const buffer = await this.invoicesService.generatePdf(id, orgId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get(':id/html')
  @Public()
  async getHtml(
    @Param('id') id: string,
    @Query('signature') signature: string,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    this.logger.log(`GET /invoices/${id}/html`);
    let orgId = user?.organizationId;

    if (!orgId) {
      if (!signature) throw new ForbiddenException('Missing authorization');
      orgId = await this.invoicesService.verifySignature(id, signature);
    }

    const html = await this.invoicesService.generateHtml(id, orgId);
    res.set({
      'Content-Type': 'text/html',
    });
    res.send(html);
  }

  @Get(':id/sign')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  signUrl(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const signature = this.invoicesService.generateSignature(id, user.organizationId);
    return { signature };
  }

  // ===========================
  // SEND (PLACEHOLDER)
  // ===========================

  @Post(':id/send')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  send(@Param('id') id: string, @Body() dto: SendInvoiceDto, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.send(id, dto, user);
  }

  // ===========================
  // CANCEL
  // ===========================

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER)
  cancel(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    this.logger.log(`DELETE /invoices/${id} (cancel)`);
    return this.invoicesService.cancel(id, user);
  }
}
