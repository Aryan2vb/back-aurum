import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CreateContactDetailDto } from './dto/create-contact-detail.dto';
import { UpdateContactDetailDto } from './dto/update-contact-detail.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CreateSocialContextDto } from './dto/create-social-context.dto';
import { UpdateSocialContextDto } from './dto/update-social-context.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateMetaTrackingDto } from './dto/create-meta-tracking.dto';
import { UpdateMetaTrackingDto } from './dto/update-meta-tracking.dto';
import { SearchCustomerDto } from './dto/search-customer.dto';
import { BulkUpdateStatusDto } from './dto/bulk-update-status.dto';
import { PaginationQueryDto } from './dto/pagination.dto';
import { BulkCreateCustomerDto } from './dto/bulk-create-customer.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
// import { RolesGuard } from '../auth/roles.guard';
// import { Roles } from '../auth/roles.decorator';
// import { OrganizationRole } from '@prisma/client';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  private readonly logger = new Logger(CustomersController.name);

  constructor(private readonly customersService: CustomersService) {
    this.logger.log('CustomersController initialized');
  }

  // ===========================
  // CUSTOMER CRUD
  // ===========================



  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  bulkCreate(
    @Body() bulkCreateCustomerDto: BulkCreateCustomerDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.bulkCreate(bulkCreateCustomerDto, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createCustomerDto: CreateCustomerDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.create(createCustomerDto, user);
  }

  @Get()
  findAll(
    @Query() paginationDto: PaginationQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.findAll(paginationDto, user.organizationId);
  }

  @Get('search')
  search(
    @Query() searchDto: SearchCustomerDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.search(searchDto, user.organizationId);
  }

  @Get('stats')
  getStats(@CurrentUser() user: CurrentUserData) {
    return this.customersService.getStats(user.organizationId);
  }

  @Get('code/:customerCode')
  findByCode(
    @Param('customerCode') customerCode: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.findByCode(customerCode, user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.update(id, updateCustomerDto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  softDelete(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.softDelete(id, user);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.restore(id, user);
  }

  @Patch('bulk/status')
  bulkUpdateStatus(
    @Body() bulkUpdateStatusDto: BulkUpdateStatusDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.bulkUpdateStatus(bulkUpdateStatusDto, user);
  }

  // ===========================
  // CONTACT DETAILS
  // ===========================

  @Get(':customerId/contact-details')
  getContactDetails(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.getContactDetails(customerId, user.organizationId);
  }

  @Post(':customerId/contact-details')
  @HttpCode(HttpStatus.CREATED)
  addContactDetail(
    @Param('customerId') customerId: string,
    @Body() createContactDetailDto: CreateContactDetailDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.addContactDetail(customerId, createContactDetailDto, user);
  }

  @Patch(':customerId/contact-details/:contactDetailId')
  updateContactDetail(
    @Param('customerId') customerId: string,
    @Param('contactDetailId') contactDetailId: string,
    @Body() updateContactDetailDto: UpdateContactDetailDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateContactDetail(
      customerId,
      contactDetailId,
      updateContactDetailDto,
      user,
    );
  }

  @Delete(':customerId/contact-details/:contactDetailId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteContactDetail(
    @Param('customerId') customerId: string,
    @Param('contactDetailId') contactDetailId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.deleteContactDetail(customerId, contactDetailId, user);
  }

  // ===========================
  // LOCATIONS
  // ===========================

  @Get(':customerId/locations')
  getLocations(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.getLocations(customerId, user.organizationId);
  }

  @Post(':customerId/locations')
  @HttpCode(HttpStatus.CREATED)
  addLocation(
    @Param('customerId') customerId: string,
    @Body() createLocationDto: CreateLocationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.addLocation(customerId, createLocationDto, user);
  }

  @Patch(':customerId/locations/:locationId')
  updateLocation(
    @Param('customerId') customerId: string,
    @Param('locationId') locationId: string,
    @Body() updateLocationDto: UpdateLocationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateLocation(
      customerId,
      locationId,
      updateLocationDto,
      user,
    );
  }

  @Delete(':customerId/locations/:locationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLocation(
    @Param('customerId') customerId: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.deleteLocation(customerId, locationId, user);
  }

  // ===========================
  // SOCIAL CONTEXTS
  // ===========================

  @Get(':customerId/social-contexts')
  getSocialContexts(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.getSocialContexts(customerId, user.organizationId);
  }

  @Post(':customerId/social-contexts')
  @HttpCode(HttpStatus.CREATED)
  addSocialContext(
    @Param('customerId') customerId: string,
    @Body() createSocialContextDto: CreateSocialContextDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.addSocialContext(customerId, createSocialContextDto, user);
  }

  @Patch(':customerId/social-contexts/:socialContextId')
  updateSocialContext(
    @Param('customerId') customerId: string,
    @Param('socialContextId') socialContextId: string,
    @Body() updateSocialContextDto: UpdateSocialContextDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateSocialContext(
      customerId,
      socialContextId,
      updateSocialContextDto,
      user,
    );
  }

  @Delete(':customerId/social-contexts/:socialContextId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSocialContext(
    @Param('customerId') customerId: string,
    @Param('socialContextId') socialContextId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.deleteSocialContext(customerId, socialContextId, user);
  }

  // ===========================
  // DOCUMENTS (KYC)
  // ===========================

  @Get(':customerId/documents')
  getDocuments(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.getDocuments(customerId, user.organizationId);
  }

  @Post(':customerId/documents')
  @HttpCode(HttpStatus.CREATED)
  addDocument(
    @Param('customerId') customerId: string,
    @Body() createDocumentDto: CreateDocumentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.addDocument(customerId, createDocumentDto, user);
  }

  @Patch(':customerId/documents/:documentId')
  updateDocument(
    @Param('customerId') customerId: string,
    @Param('documentId') documentId: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateDocument(
      customerId,
      documentId,
      updateDocumentDto,
      user,
    );
  }

  @Delete(':customerId/documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDocument(
    @Param('customerId') customerId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.deleteDocument(customerId, documentId, user);
  }

  // ===========================
  // ACCOUNTS
  // ===========================

  @Get(':customerId/accounts')
  getAccounts(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.getAccounts(customerId, user.organizationId);
  }

  @Post(':customerId/accounts')
  @HttpCode(HttpStatus.CREATED)
  addAccount(
    @Param('customerId') customerId: string,
    @Body() createAccountDto: CreateAccountDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.addAccount(customerId, createAccountDto, user);
  }

  @Patch(':customerId/accounts/:accountId')
  updateAccount(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Body() updateAccountDto: UpdateAccountDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateAccount(
      customerId,
      accountId,
      updateAccountDto,
      user,
    );
  }

  @Delete(':customerId/accounts/:accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAccount(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.deleteAccount(customerId, accountId, user);
  }

  // ===========================
  // META TRACKING
  // ===========================

  @Get(':customerId/meta-tracking')
  getMetaTrackings(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.getMetaTrackings(customerId, user.organizationId);
  }

  @Post(':customerId/meta-tracking')
  @HttpCode(HttpStatus.CREATED)
  addMetaTracking(
    @Param('customerId') customerId: string,
    @Body() createMetaTrackingDto: CreateMetaTrackingDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.addMetaTracking(customerId, createMetaTrackingDto, user);
  }

  @Patch(':customerId/meta-tracking/:metaTrackingId')
  updateMetaTracking(
    @Param('customerId') customerId: string,
    @Param('metaTrackingId') metaTrackingId: string,
    @Body() updateMetaTrackingDto: UpdateMetaTrackingDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateMetaTracking(
      customerId,
      metaTrackingId,
      updateMetaTrackingDto,
      user,
    );
  }

  @Delete(':customerId/meta-tracking/:metaTrackingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMetaTracking(
    @Param('customerId') customerId: string,
    @Param('metaTrackingId') metaTrackingId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.deleteMetaTracking(customerId, metaTrackingId, user);
  }
}
