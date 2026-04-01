import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { BulkCreateCustomerDto } from './dto/bulk-create-customer.dto';
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
import { CurrentUserData } from '../auth/current-user.decorator';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);
  private static readonly CUSTOMER_CODE_PREFIX = 'C-';
  private static readonly CUSTOMER_CODE_PAD_LENGTH = 6;

  constructor(private prisma: PrismaService) {
    this.logger.log('CustomersService initialized');
  }

  // ===========================
  // CUSTOMER CRUD
  // ===========================

  async create(createCustomerDto: CreateCustomerDto, user: CurrentUserData) {
    const { organizationId, userId } = user;

    // Check for duplicate phone number
    if (createCustomerDto.contactDetails?.primaryPhone) {
      const existingPhone = await this.prisma.contactDetail.findFirst({
        where: {
          organizationId,
          primaryPhone: createCustomerDto.contactDetails.primaryPhone,
          deletedAt: null,
        },
        include: {
          customer: {
            select: { customerCode: true, fullName: true },
          },
        },
      });
      if (existingPhone) {
        throw new ConflictException(
          `Phone number ${createCustomerDto.contactDetails.primaryPhone} already exists for customer ${existingPhone.customer.customerCode} (${existingPhone.customer.fullName})`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const sequenceNumber = await this.bumpCustomerSequence(tx, organizationId);
      const customerCode = this.generateCustomerCode(sequenceNumber);

      const locationCreates = (createCustomerDto.locations ?? [])
        .filter((loc) =>
          [loc.village, loc.tehsil, loc.district, loc.state, loc.pincode, loc.landmark].some(
            (v) => v !== undefined && v !== null && v !== '',
          ),
        )
        .map((loc) => ({
          organizationId,
          village: loc.village,
          tehsil: loc.tehsil,
          district: loc.district,
          state: loc.state,
          pincode: loc.pincode,
          landmark: loc.landmark,
        }));

      const customer = await tx.customer.create({
        data: {
          organizationId,
          customerCode,
          createdById: userId,
          fullName: createCustomerDto.fullName,
          fatherName: createCustomerDto.fatherName,
          motherName: createCustomerDto.motherName,
          spouseName: createCustomerDto.spouseName,
          gender: createCustomerDto.gender,
          dateOfBirth: createCustomerDto.dateOfBirth
            ? new Date(createCustomerDto.dateOfBirth)
            : undefined,
          isDobEstimated:
            createCustomerDto.isDobEstimated === undefined
              ? undefined
              : createCustomerDto.isDobEstimated,
          contactDetails: createCustomerDto.contactDetails
            ? {
                create: {
                  organizationId,
                  primaryPhone: createCustomerDto.contactDetails.primaryPhone,
                  secondaryPhone: createCustomerDto.contactDetails.secondaryPhone,
                  phoneOwnerType: createCustomerDto.contactDetails.phoneOwnerType,
                  preferredContactMethod: createCustomerDto.contactDetails.preferredContactMethod,
                },
              }
            : undefined,
          locations: locationCreates.length > 0 ? { create: locationCreates } : undefined,
        },
        include: {
          contactDetails: {
            where: { deletedAt: null },
          },
          locations: {
            where: { deletedAt: null },
          },
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      });

      return customer;
    });
  }

  async bulkCreate(bulkCreateCustomerDto: BulkCreateCustomerDto, user: CurrentUserData) {
    const { organizationId, userId } = user;
    const { customers } = bulkCreateCustomerDto;
    const count = customers.length;

    if (count === 0) {
      return [];
    }

    // 1. Pre-check for duplicate phone numbers within the batch
    const phoneMap = new Map<string, boolean>();
    const batchPhones: string[] = [];

    for (const dto of customers) {
      if (dto.contactDetails?.primaryPhone) {
        if (phoneMap.has(dto.contactDetails.primaryPhone)) {
          throw new BadRequestException(
            `Duplicate phone number in batch: ${dto.contactDetails.primaryPhone}`,
          );
        }
        phoneMap.set(dto.contactDetails.primaryPhone, true);
        batchPhones.push(dto.contactDetails.primaryPhone);
      }
    }

    // 2. Pre-check for duplicate phone numbers in DB (Fast single query)
    if (batchPhones.length > 0) {
      const existingPhones = await this.prisma.contactDetail.findMany({
        where: {
          organizationId,
          primaryPhone: { in: batchPhones },
          deletedAt: null,
        },
        select: { primaryPhone: true },
        take: 1,
      });

      if (existingPhones.length > 0) {
        throw new ConflictException(
          `Phone number ${existingPhones[0].primaryPhone} already exists in the system.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 3. Reserve sequence numbers (1 DB call)
      const baseSequence = await this.bumpCustomerSequence(tx, organizationId, count);

      // 4. Pre-compute all data in memory
      const customersToCreate: Prisma.CustomerCreateManyInput[] = [];
      const contactsToCreate: Prisma.ContactDetailCreateManyInput[] = [];

      customers.forEach((dto, index) => {
        // Generate pre-computed ID and Code
        const id = randomUUID();
        const customerCode = this.generateCustomerCode(baseSequence + index);

        // Prepare Customer Record
        customersToCreate.push({
          id, // Explicitly set ID
          organizationId,
          customerCode,
          createdById: userId,
          fullName: dto.fullName,
          fatherName: dto.fatherName,
          motherName: dto.motherName,
          spouseName: dto.spouseName,
          gender: dto.gender,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          isDobEstimated: dto.isDobEstimated === undefined ? undefined : dto.isDobEstimated,
          status: 'ACTIVE',
        });

        // Prepare Contact Record (if exists), linking via pre-computed ID
        if (dto.contactDetails) {
          contactsToCreate.push({
            organizationId,
            customerId: id, // Link to the specific customer we just prepared
            primaryPhone: dto.contactDetails.primaryPhone,
            secondaryPhone: dto.contactDetails.secondaryPhone,
            phoneOwnerType: dto.contactDetails.phoneOwnerType,
            preferredContactMethod: dto.contactDetails.preferredContactMethod,
          });
        }
      });

      // 5. Execute Bulk Inserts (2 DB calls)
      await tx.customer.createMany({
        data: customersToCreate,
      });

      if (contactsToCreate.length > 0) {
        await tx.contactDetail.createMany({
          data: contactsToCreate,
        });
      }

      // Return a summary (since createMany doesn't return the full objects)
      return {
        count,
        message: `Successfully created ${count} customers`,
        firstCode: customersToCreate[0]?.customerCode,
        lastCode: customersToCreate[customersToCreate.length - 1]?.customerCode,
      };
    });
  }

  async findAll(paginationDto: PaginationQueryDto, organizationId: string) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = paginationDto;

    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      deletedAt: null,
    };

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          contactDetails: {
            where: { deletedAt: null },
          },
          locations: {
            where: { deletedAt: null },
          },
          socialContexts: {
            where: { deletedAt: null },
          },
          documents: {
            where: { deletedAt: null },
          },
          accounts: {
            where: { deletedAt: null },
          },
          metaTrackings: {
            where: { deletedAt: null },
          },
          createdBy: {
            select: {
              id: true,
              email: true,
            },
          },
        },
        orderBy: {
          [sortBy]: sortOrder,
        },
        skip,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: customers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async search(searchDto: SearchCustomerDto, organizationId: string) {
    const {
      query,
      fullName,
      phone,
      address,
      village,
      tehsil,
      district,
      state,
      pincode,
      status,
      gender,
      createdFrom,
      createdTo,
      hasAccounts,
      includeDeleted,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = searchDto;

    const where: Prisma.CustomerWhereInput = {
      organizationId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    };

    // General search query (name, phone, customerCode)
    if (query) {
      where.OR = [
        { fullName: { contains: query, mode: 'insensitive' } },
        { customerCode: { contains: query, mode: 'insensitive' } },
        {
          contactDetails: {
            some: {
              deletedAt: null,
              OR: [{ primaryPhone: { contains: query } }, { secondaryPhone: { contains: query } }],
            },
          },
        },
      ];
    }

    // Specific filters
    if (fullName) {
      where.fullName = { contains: fullName, mode: 'insensitive' };
    }

    if (phone) {
      where.contactDetails = {
        some: {
          deletedAt: null,
          OR: [{ primaryPhone: { contains: phone } }, { secondaryPhone: { contains: phone } }],
        },
      };
    }

    // Combined address filter - searches across all location fields
    if (address) {
      where.locations = {
        some: {
          deletedAt: null,
          OR: [
            { village: { contains: address, mode: 'insensitive' } },
            { tehsil: { contains: address, mode: 'insensitive' } },
            { district: { contains: address, mode: 'insensitive' } },
            { state: { contains: address, mode: 'insensitive' } },
            { pincode: { contains: address } },
          ],
        },
      };
    }
    // Individual location filters (for backward compatibility)
    else if (village || tehsil || district || state || pincode) {
      where.locations = {
        some: {
          deletedAt: null,
          ...(village && { village: { contains: village, mode: 'insensitive' } }),
          ...(tehsil && { tehsil: { contains: tehsil, mode: 'insensitive' } }),
          ...(district && { district: { contains: district, mode: 'insensitive' } }),
          ...(state && { state: { contains: state, mode: 'insensitive' } }),
          ...(pincode && { pincode: { contains: pincode } }),
        },
      };
    }

    if (status) {
      where.status = status;
    }

    // Gender filter
    if (gender) {
      where.gender = gender;
    }

    // Date range filter
    if (createdFrom || createdTo) {
      where.createdAt = {
        ...(createdFrom && { gte: new Date(createdFrom) }),
        ...(createdTo && { lte: new Date(createdTo) }),
      };
    }

    // Has accounts filter
    if (hasAccounts !== undefined) {
      if (hasAccounts) {
        where.accounts = { some: { deletedAt: null } };
      } else {
        where.accounts = { none: { deletedAt: null } };
      }
    }

    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          contactDetails: {
            where: { deletedAt: null },
          },
          locations: {
            where: { deletedAt: null },
          },
          socialContexts: {
            where: { deletedAt: null },
          },
          documents: {
            where: { deletedAt: null },
          },
          accounts: {
            where: { deletedAt: null },
          },
          metaTrackings: {
            where: { deletedAt: null },
          },
          createdBy: {
            select: {
              id: true,
              email: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: customers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getStats(organizationId: string) {
    const [
      totalCustomers,
      activeCustomers,
      inactiveCustomers,
      suspendedCustomers,
      closedCustomers,
      customersThisMonth,
      totalAccounts,
    ] = await Promise.all([
      this.prisma.customer.count({
        where: { organizationId, deletedAt: null },
      }),
      this.prisma.customer.count({
        where: { organizationId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.customer.count({
        where: { organizationId, deletedAt: null, status: 'INACTIVE' },
      }),
      this.prisma.customer.count({
        where: { organizationId, deletedAt: null, status: 'SUSPENDED' },
      }),
      this.prisma.customer.count({
        where: { organizationId, deletedAt: null, status: 'CLOSED' },
      }),
      this.prisma.customer.count({
        where: {
          organizationId,
          deletedAt: null,
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      this.prisma.account.count({
        where: { organizationId, deletedAt: null },
      }),
    ]);

    return {
      totalCustomers,
      activeCustomers,
      inactiveCustomers,
      suspendedCustomers,
      closedCustomers,
      customersThisMonth,
      totalAccounts,
      statusBreakdown: {
        ACTIVE: activeCustomers,
        INACTIVE: inactiveCustomers,
        SUSPENDED: suspendedCustomers,
        CLOSED: closedCustomers,
      },
    };
  }

  async findOne(id: string, organizationId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id,
        organizationId,
        deletedAt: null,
      },
      include: {
        contactDetails: {
          where: { deletedAt: null },
        },
        locations: {
          where: { deletedAt: null },
        },
        socialContexts: {
          where: { deletedAt: null },
        },
        documents: {
          where: { deletedAt: null },
        },
        accounts: {
          where: { deletedAt: null },
        },
        metaTrackings: {
          where: { deletedAt: null },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found in this organization`);
    }

    return customer;
  }

  async findByCode(customerCode: string, organizationId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        organizationId,
        customerCode,
        deletedAt: null,
      },
      include: {
        contactDetails: {
          where: { deletedAt: null },
        },
        locations: {
          where: { deletedAt: null },
        },
        socialContexts: {
          where: { deletedAt: null },
        },
        documents: {
          where: { deletedAt: null },
        },
        accounts: {
          where: { deletedAt: null },
        },
        metaTrackings: {
          where: { deletedAt: null },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(
        `Customer with code ${customerCode} not found in this organization`,
      );
    }

    return customer;
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto, user: CurrentUserData) {
    const { organizationId } = user;
    const data: Prisma.CustomerUpdateManyMutationInput = {};

    if (updateCustomerDto.fullName !== undefined) {
      data.fullName = updateCustomerDto.fullName;
    }

    if (updateCustomerDto.fatherName !== undefined) {
      data.fatherName = updateCustomerDto.fatherName;
    }

    if (updateCustomerDto.motherName !== undefined) {
      data.motherName = updateCustomerDto.motherName;
    }

    if (updateCustomerDto.spouseName !== undefined) {
      data.spouseName = updateCustomerDto.spouseName;
    }

    if (updateCustomerDto.gender !== undefined) {
      data.gender = updateCustomerDto.gender;
    }

    if (updateCustomerDto.dateOfBirth !== undefined) {
      data.dateOfBirth = new Date(updateCustomerDto.dateOfBirth);
    }

    if (updateCustomerDto.isDobEstimated !== undefined) {
      data.isDobEstimated = updateCustomerDto.isDobEstimated;
    }

    if (updateCustomerDto.status !== undefined) {
      data.status = updateCustomerDto.status;
    }

    if (Object.keys(data).length === 0) {
      return this.findOne(id, organizationId);
    }

    const result = await this.prisma.customer.updateMany({
      where: {
        id,
        organizationId,
        deletedAt: null,
      },
      data,
    });

    if (result.count === 0) {
      throw new NotFoundException(`Customer with ID ${id} not found in this organization`);
    }

    return this.findOne(id, organizationId);
  }

  async remove(id: string, user: CurrentUserData) {
    const { organizationId } = user;

    // We use deleteMany so it doesn't fail if already gone, and to check organizationId
    const result = await this.prisma.customer.deleteMany({
      where: {
        id,
        organizationId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException(`Customer with ID ${id} not found in this organization`);
    }

    return { message: 'Customer permanently deleted and all linked data removed' };
  }

  async bulkUpdateStatus(bulkUpdateStatusDto: BulkUpdateStatusDto, user: CurrentUserData) {
    const { organizationId } = user;
    const { customerIds, status } = bulkUpdateStatusDto;

    const result = await this.prisma.customer.updateMany({
      where: {
        id: { in: customerIds },
        organizationId,
        deletedAt: null,
      },
      data: { status },
    });

    return {
      message: `${result.count} customers updated successfully`,
      updatedCount: result.count,
    };
  }

  // ===========================
  // CONTACT DETAILS
  // ===========================

  async getContactDetails(customerId: string, organizationId: string) {
    await this.ensureCustomerAccess(customerId, organizationId);

    return this.prisma.contactDetail.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
      },
    });
  }

  async addContactDetail(
    customerId: string,
    createContactDetailDto: CreateContactDetailDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    try {
      return await this.prisma.contactDetail.create({
        data: {
          organizationId,
          customerId,
          primaryPhone: createContactDetailDto.primaryPhone,
          secondaryPhone: createContactDetailDto.secondaryPhone,
          phoneOwnerType: createContactDetailDto.phoneOwnerType,
          preferredContactMethod: createContactDetailDto.preferredContactMethod,
        },
      });
    } catch (error) {
      this.handleContactDetailUniqueConstraint(error, createContactDetailDto.primaryPhone);
    }
  }

  async updateContactDetail(
    customerId: string,
    contactDetailId: string,
    updateContactDetailDto: UpdateContactDetailDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const data: Prisma.ContactDetailUpdateManyMutationInput = {};

    if (updateContactDetailDto.primaryPhone !== undefined) {
      data.primaryPhone = updateContactDetailDto.primaryPhone;
    }

    if (updateContactDetailDto.secondaryPhone !== undefined) {
      data.secondaryPhone = updateContactDetailDto.secondaryPhone;
    }

    if (updateContactDetailDto.phoneOwnerType !== undefined) {
      data.phoneOwnerType = updateContactDetailDto.phoneOwnerType;
    }

    if (updateContactDetailDto.preferredContactMethod !== undefined) {
      data.preferredContactMethod = updateContactDetailDto.preferredContactMethod;
    }

    if (Object.keys(data).length === 0) {
      return this.getEntity('contactDetail', contactDetailId, customerId, organizationId);
    }

    try {
      const result = await this.prisma.contactDetail.updateMany({
        where: {
          id: contactDetailId,
          customerId,
          organizationId,
          deletedAt: null,
        },
        data,
      });

      if (result.count === 0) {
        throw new NotFoundException(
          `Contact detail ${contactDetailId} not found for this customer/organization`,
        );
      }
    } catch (error) {
      this.handleContactDetailUniqueConstraint(error, updateContactDetailDto.primaryPhone);
    }

    return this.getEntity('contactDetail', contactDetailId, customerId, organizationId);
  }

  async deleteContactDetail(customerId: string, contactDetailId: string, user: CurrentUserData) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const result = await this.prisma.contactDetail.updateMany({
      where: {
        id: contactDetailId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Contact detail ${contactDetailId} not found for this customer/organization`,
      );
    }

    return { message: 'Contact detail deleted successfully' };
  }

  // ===========================
  // LOCATIONS
  // ===========================

  async getLocations(customerId: string, organizationId: string) {
    await this.ensureCustomerAccess(customerId, organizationId);

    return this.prisma.location.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
      },
    });
  }

  async addLocation(
    customerId: string,
    createLocationDto: CreateLocationDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);
    this.ensureLocationPayloadHasData(createLocationDto);

    return this.prisma.location.create({
      data: {
        organizationId,
        customerId,
        village: createLocationDto.village,
        tehsil: createLocationDto.tehsil,
        district: createLocationDto.district,
        state: createLocationDto.state,
        pincode: createLocationDto.pincode,
        landmark: createLocationDto.landmark,
      },
    });
  }

  async updateLocation(
    customerId: string,
    locationId: string,
    updateLocationDto: UpdateLocationDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const data: Prisma.LocationUpdateManyMutationInput = {};

    if (updateLocationDto.village !== undefined) {
      data.village = updateLocationDto.village;
    }

    if (updateLocationDto.tehsil !== undefined) {
      data.tehsil = updateLocationDto.tehsil;
    }

    if (updateLocationDto.district !== undefined) {
      data.district = updateLocationDto.district;
    }

    if (updateLocationDto.state !== undefined) {
      data.state = updateLocationDto.state;
    }

    if (updateLocationDto.pincode !== undefined) {
      data.pincode = updateLocationDto.pincode;
    }

    if (updateLocationDto.landmark !== undefined) {
      data.landmark = updateLocationDto.landmark;
    }

    if (Object.keys(data).length === 0) {
      return this.getEntity('location', locationId, customerId, organizationId);
    }

    const result = await this.prisma.location.updateMany({
      where: {
        id: locationId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data,
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Location ${locationId} not found for this customer/organization`,
      );
    }

    return this.getEntity('location', locationId, customerId, organizationId);
  }

  async deleteLocation(customerId: string, locationId: string, user: CurrentUserData) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const result = await this.prisma.location.updateMany({
      where: {
        id: locationId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Location ${locationId} not found for this customer/organization`,
      );
    }

    return { message: 'Location deleted successfully' };
  }

  // ===========================
  // SOCIAL CONTEXTS
  // ===========================

  async getSocialContexts(customerId: string, organizationId: string) {
    await this.ensureCustomerAccess(customerId, organizationId);

    return this.prisma.socialContext.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
      },
    });
  }

  async addSocialContext(
    customerId: string,
    createSocialContextDto: CreateSocialContextDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);
    this.ensureSocialContextPayloadHasData(createSocialContextDto);

    return this.prisma.socialContext.create({
      data: {
        organizationId,
        customerId,
        caste: createSocialContextDto.caste,
        educationLevel: createSocialContextDto.educationLevel,
        occupation: createSocialContextDto.occupation,
        incomeRange: createSocialContextDto.incomeRange,
      },
    });
  }

  async updateSocialContext(
    customerId: string,
    socialContextId: string,
    updateSocialContextDto: UpdateSocialContextDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const data: Prisma.SocialContextUpdateManyMutationInput = {};

    if (updateSocialContextDto.caste !== undefined) {
      data.caste = updateSocialContextDto.caste;
    }

    if (updateSocialContextDto.educationLevel !== undefined) {
      data.educationLevel = updateSocialContextDto.educationLevel;
    }

    if (updateSocialContextDto.occupation !== undefined) {
      data.occupation = updateSocialContextDto.occupation;
    }

    if (updateSocialContextDto.incomeRange !== undefined) {
      data.incomeRange = updateSocialContextDto.incomeRange;
    }

    if (Object.keys(data).length === 0) {
      return this.getEntity('socialContext', socialContextId, customerId, organizationId);
    }

    const result = await this.prisma.socialContext.updateMany({
      where: {
        id: socialContextId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data,
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Social context ${socialContextId} not found for this customer/organization`,
      );
    }

    return this.getEntity('socialContext', socialContextId, customerId, organizationId);
  }

  async deleteSocialContext(customerId: string, socialContextId: string, user: CurrentUserData) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const result = await this.prisma.socialContext.updateMany({
      where: {
        id: socialContextId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Social context ${socialContextId} not found for this customer/organization`,
      );
    }

    return { message: 'Social context deleted successfully' };
  }

  // ===========================
  // DOCUMENTS (KYC)
  // ===========================

  async getDocuments(customerId: string, organizationId: string) {
    await this.ensureCustomerAccess(customerId, organizationId);

    return this.prisma.document.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
      },
    });
  }

  async addDocument(
    customerId: string,
    createDocumentDto: CreateDocumentDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);
    this.ensureDocumentPayloadHasData(createDocumentDto);

    // Check for duplicate Aadhar last 4 digits
    if (createDocumentDto.aadharLast4) {
      const existingAadhar = await this.prisma.document.findFirst({
        where: {
          organizationId,
          aadharLast4: createDocumentDto.aadharLast4,
          deletedAt: null,
        },
        include: {
          customer: {
            select: { customerCode: true, fullName: true },
          },
        },
      });
      if (existingAadhar) {
        throw new ConflictException(
          `Aadhar ending with ${createDocumentDto.aadharLast4} already exists for customer ${existingAadhar.customer.customerCode} (${existingAadhar.customer.fullName})`,
        );
      }
    }

    return this.prisma.document.create({
      data: {
        organizationId,
        customerId,
        aadharLast4: createDocumentDto.aadharLast4,
        aadharVerified: createDocumentDto.aadharVerified ?? false,
      },
    });
  }

  async updateDocument(
    customerId: string,
    documentId: string,
    updateDocumentDto: UpdateDocumentDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const data: Prisma.DocumentUpdateManyMutationInput = {};

    if (updateDocumentDto.aadharLast4 !== undefined) {
      data.aadharLast4 = updateDocumentDto.aadharLast4;
    }

    if (updateDocumentDto.aadharVerified !== undefined) {
      data.aadharVerified = updateDocumentDto.aadharVerified;
    }

    if (Object.keys(data).length === 0) {
      return this.getEntity('document', documentId, customerId, organizationId);
    }

    const result = await this.prisma.document.updateMany({
      where: {
        id: documentId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data,
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Document ${documentId} not found for this customer/organization`,
      );
    }

    return this.getEntity('document', documentId, customerId, organizationId);
  }

  async deleteDocument(customerId: string, documentId: string, user: CurrentUserData) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const result = await this.prisma.document.updateMany({
      where: {
        id: documentId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Document ${documentId} not found for this customer/organization`,
      );
    }

    return { message: 'Document deleted successfully' };
  }

  // ===========================
  // ACCOUNTS
  // ===========================

  async getAccounts(customerId: string, organizationId: string) {
    await this.ensureCustomerAccess(customerId, organizationId);

    return this.prisma.account.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
      },
    });
  }

  async addAccount(customerId: string, createAccountDto: CreateAccountDto, user: CurrentUserData) {
    const { organizationId, userId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    return this.prisma.account.create({
      data: {
        organizationId,
        customerId,
        createdById: userId,
        openingBalance: createAccountDto.openingBalance ?? 0,
        openedAt: createAccountDto.openedAt ? new Date(createAccountDto.openedAt) : new Date(),
        status: createAccountDto.status ?? 'ACTIVE',
      },
    });
  }

  async updateAccount(
    customerId: string,
    accountId: string,
    updateAccountDto: UpdateAccountDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const data: Prisma.AccountUpdateManyMutationInput = {};

    if (updateAccountDto.openingBalance !== undefined) {
      data.openingBalance = updateAccountDto.openingBalance;
    }

    if (updateAccountDto.openedAt !== undefined) {
      data.openedAt = new Date(updateAccountDto.openedAt);
    }

    if (updateAccountDto.status !== undefined) {
      data.status = updateAccountDto.status;
    }

    if (Object.keys(data).length === 0) {
      return this.getEntity('account', accountId, customerId, organizationId);
    }

    const result = await this.prisma.account.updateMany({
      where: {
        id: accountId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data,
    });

    if (result.count === 0) {
      throw new NotFoundException(`Account ${accountId} not found for this customer/organization`);
    }

    return this.getEntity('account', accountId, customerId, organizationId);
  }

  async deleteAccount(customerId: string, accountId: string, user: CurrentUserData) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const result = await this.prisma.account.updateMany({
      where: {
        id: accountId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException(`Account ${accountId} not found for this customer/organization`);
    }

    return { message: 'Account deleted successfully' };
  }

  // ===========================
  // META TRACKING
  // ===========================

  async getMetaTrackings(customerId: string, organizationId: string) {
    await this.ensureCustomerAccess(customerId, organizationId);

    return this.prisma.metaTracking.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
      },
    });
  }

  async addMetaTracking(
    customerId: string,
    createMetaTrackingDto: CreateMetaTrackingDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);
    this.ensureMetaTrackingPayloadHasData(createMetaTrackingDto);

    return this.prisma.metaTracking.create({
      data: {
        organizationId,
        customerId,
        registeredOn: createMetaTrackingDto.registeredOn
          ? new Date(createMetaTrackingDto.registeredOn)
          : undefined,
        notes: createMetaTrackingDto.notes,
        source: createMetaTrackingDto.source,
      },
    });
  }

  async updateMetaTracking(
    customerId: string,
    metaTrackingId: string,
    updateMetaTrackingDto: UpdateMetaTrackingDto,
    user: CurrentUserData,
  ) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const data: Prisma.MetaTrackingUpdateManyMutationInput = {};

    if (updateMetaTrackingDto.registeredOn !== undefined) {
      data.registeredOn = new Date(updateMetaTrackingDto.registeredOn);
    }

    if (updateMetaTrackingDto.notes !== undefined) {
      data.notes = updateMetaTrackingDto.notes;
    }

    if (updateMetaTrackingDto.source !== undefined) {
      data.source = updateMetaTrackingDto.source;
    }

    if (Object.keys(data).length === 0) {
      return this.getEntity('metaTracking', metaTrackingId, customerId, organizationId);
    }

    const result = await this.prisma.metaTracking.updateMany({
      where: {
        id: metaTrackingId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data,
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Meta tracking ${metaTrackingId} not found for this customer/organization`,
      );
    }

    return this.getEntity('metaTracking', metaTrackingId, customerId, organizationId);
  }

  async deleteMetaTracking(customerId: string, metaTrackingId: string, user: CurrentUserData) {
    const { organizationId } = user;

    await this.ensureCustomerAccess(customerId, organizationId);

    const result = await this.prisma.metaTracking.updateMany({
      where: {
        id: metaTrackingId,
        customerId,
        organizationId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Meta tracking ${metaTrackingId} not found for this customer/organization`,
      );
    }

    return { message: 'Meta tracking deleted successfully' };
  }

  // ===========================
  // PRIVATE HELPERS
  // ===========================

  private async bumpCustomerSequence(
    tx: Prisma.TransactionClient,
    organizationId: string,
    incrementBy: number = 1,
  ): Promise<number> {
    const result = await tx.$queryRaw<{ nextCustomerNumber: number }[]>`
      UPDATE "Organization"
      SET "nextCustomerNumber" = "nextCustomerNumber" + ${incrementBy}
      WHERE "id" = ${organizationId}
      RETURNING "nextCustomerNumber"
    `;

    const row = result[0];

    if (!row) {
      throw new NotFoundException(`Organization with ID ${organizationId} not found`);
    }

    return row.nextCustomerNumber - incrementBy;
  }

  private generateCustomerCode(sequence: number): string {
    const normalizedSequence = Math.max(sequence, 1);
    return `${CustomersService.CUSTOMER_CODE_PREFIX}${normalizedSequence
      .toString()
      .padStart(CustomersService.CUSTOMER_CODE_PAD_LENGTH, '0')}`;
  }

  private async ensureCustomerAccess(customerId: string, organizationId: string): Promise<void> {
    const exists = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException(`Customer with ID ${customerId} not found in this organization`);
    }
  }

  private handleContactDetailUniqueConstraint(error: unknown, primaryPhone?: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      primaryPhone
    ) {
      throw new ConflictException(
        `Primary phone ${primaryPhone} is already used within this organization`,
      );
    }

    throw error;
  }

  private async getEntity(
    entityType:
      | 'contactDetail'
      | 'location'
      | 'socialContext'
      | 'document'
      | 'account'
      | 'metaTracking',
    entityId: string,
    customerId: string,
    organizationId: string,
  ) {
    const where = {
      id: entityId,
      customerId,
      organizationId,
      deletedAt: null,
    };

    let entity;
    switch (entityType) {
      case 'contactDetail':
        entity = await this.prisma.contactDetail.findFirst({ where });
        break;
      case 'location':
        entity = await this.prisma.location.findFirst({ where });
        break;
      case 'socialContext':
        entity = await this.prisma.socialContext.findFirst({ where });
        break;
      case 'document':
        entity = await this.prisma.document.findFirst({ where });
        break;
      case 'account':
        entity = await this.prisma.account.findFirst({ where });
        break;
      case 'metaTracking':
        entity = await this.prisma.metaTracking.findFirst({ where });
        break;
    }

    if (!entity) {
      throw new NotFoundException(
        `${entityType} ${entityId} not found for this customer/organization`,
      );
    }

    return entity;
  }

  private ensureLocationPayloadHasData(dto: CreateLocationDto | UpdateLocationDto) {
    const hasData = [
      dto.village,
      dto.tehsil,
      dto.district,
      dto.state,
      dto.pincode,
      dto.landmark,
    ].some((value) => value !== undefined);

    if (!hasData) {
      throw new BadRequestException('At least one location field is required');
    }
  }

  private ensureSocialContextPayloadHasData(dto: CreateSocialContextDto | UpdateSocialContextDto) {
    const hasData = [dto.caste, dto.educationLevel, dto.occupation, dto.incomeRange].some(
      (value) => value !== undefined,
    );

    if (!hasData) {
      throw new BadRequestException('At least one social context field is required');
    }
  }

  private ensureDocumentPayloadHasData(dto: CreateDocumentDto | UpdateDocumentDto) {
    const hasData = [dto.aadharLast4, dto.aadharVerified].some((value) => value !== undefined);

    if (!hasData) {
      throw new BadRequestException('At least one document field is required');
    }
  }

  private ensureMetaTrackingPayloadHasData(dto: CreateMetaTrackingDto | UpdateMetaTrackingDto) {
    const hasData = [dto.registeredOn, dto.notes, dto.source].some((value) => value !== undefined);

    if (!hasData) {
      throw new BadRequestException('At least one meta tracking field is required');
    }
  }
}
