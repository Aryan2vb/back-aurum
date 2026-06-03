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
import { FinalizeInvoiceDto } from './dto/finalize-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { NegotiatePreviewQueryDto, NegotiateCommitDto } from './dto/negotiate-invoice.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { OrganizationRole } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { InvoiceNegotiationService } from './utils/invoice-negotiation.service';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly negotiationService: InvoiceNegotiationService,
  ) {}

  // ===========================
  // ORG INVOICE SETTINGS
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

  @Get('settings/preview')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async previewSettings(@CurrentUser() user: CurrentUserData, @Res() res: Response) {
    this.logger.log(`GET /invoices/settings/preview for org ${user.organizationId}`);
    const html = await this.invoicesService.generatePreviewHtml(user.organizationId);
    res.set({ 'Content-Type': 'text/html' });
    res.send(html);
  }

  // ===========================
  // DRAFT
  // ===========================

  @Post('draft')
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  createDraft(@Body() dto: CreateInvoiceDto, @CurrentUser() user: CurrentUserData) {
    this.logger.log(`POST /invoices/draft for customer ${dto.customerId}`);
    return this.invoicesService.createDraft(dto, user);
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  finalize(
    @Param('id') id: string,
    @Body() dto: FinalizeInvoiceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    this.logger.log(`POST /invoices/${id}/finalize`);
    return this.invoicesService.finalize(id, user, dto);
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

  @Get('next-sequence')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  getNextSequence(
    @Query('date') date: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.invoicesService.getNextSequence(user.organizationId, date);
  }

  @Get('missing-sequences')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  getMissingSequences(
    @Query('date') date: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.invoicesService.getMissingSequences(user.organizationId, date);
  }

  @Get('sequence-availability')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  getSequenceAvailability(
    @Query('sequence') sequence: string,
    @Query('date') date: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.invoicesService.getSequenceAvailability(
      user.organizationId,
      Number(sequence),
      date,
    );
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

  @Patch(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    this.logger.log(`PATCH /invoices/${id}`);
    return this.invoicesService.update(id, dto, user);
  }

  // ===========================
  // NEGOTIATION
  // ===========================

  @Get(':id/negotiate/preview')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  negotiatePreview(
    @Param('id') id: string,
    @Query() query: NegotiatePreviewQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    this.logger.log(
      `GET /invoices/${id}/negotiate/preview — target: ${query.targetAmount}, mode: ${query.mode}`,
    );
    return this.negotiationService.preview(
      id,
      user.organizationId,
      query.targetAmount,
      query.mode,
      query.metalType,
    );
  }

  @Post(':id/negotiate/commit')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  negotiateCommit(
    @Param('id') id: string,
    @Body() dto: NegotiateCommitDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    this.logger.log(
      `POST /invoices/${id}/negotiate/commit — target: ${dto.targetAmount}, mode: ${dto.mode}`,
    );
    return this.negotiationService.commit(
      id,
      user.organizationId,
      dto.targetAmount,
      user.userId,
      dto.mode,
      dto.metalType,
      dto.negotiationNote,
    );
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
    res.set({ 'Content-Type': 'text/html' });
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

  @Get(':id/share/whatsapp')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  getWhatsAppShare(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.invoicesService.getWhatsAppShareLink(id, user);
  }

  // ===========================
  // SEND
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
