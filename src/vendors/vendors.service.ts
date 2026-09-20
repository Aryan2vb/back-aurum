import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService) {}

  async createVendor(data: {
    organizationId: string;
    name: string;
    phone?: string;
    email?: string;
    gstin?: string;
    address?: string;
    stateCode?: string;
    stateName?: string;
  }) {
    return this.prisma.vendor.create({
      data,
    });
  }

  async getVendors(organizationId: string) {
    return this.prisma.vendor.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async getVendorById(id: string, organizationId: string) {
    return this.prisma.vendor.findFirst({
      where: { id, organizationId },
    });
  }

  async updateVendor(
    id: string,
    organizationId: string,
    data: {
      name?: string;
      phone?: string;
      email?: string;
      gstin?: string;
      address?: string;
      stateCode?: string;
      stateName?: string;
    },
  ) {
    const existing = await this.prisma.vendor.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Vendor not found');
    }

    return this.prisma.vendor.update({
      where: { id },
      data,
    });
  }
}
