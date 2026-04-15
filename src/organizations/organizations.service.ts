import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AuditAction, OrganizationStatus, OrganizationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddMemberDto } from './dto/add-member.dto';
import { CurrentUserData } from '../auth/current-user.decorator';
import { UploadService } from '../uploads/upload.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {
    this.logger.log('OrganizationsService initialized');
  }

  async addMember(dto: AddMemberDto, actor: CurrentUserData) {
    const normalizedFullName = dto.fullName.trim();

    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: actor.organizationId },
        select: {
          id: true,
          status: true,
          deletedAt: true,
        },
      });

      if (!organization || organization.deletedAt) {
        throw new NotFoundException('Organization not found');
      }

      if (
        organization.status !== OrganizationStatus.ACTIVE &&
        organization.status !== OrganizationStatus.TRIAL
      ) {
        throw new ForbiddenException('Organization is not active');
      }

      const existingUser = await tx.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });

      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }

      const passwordHash = await this.hashPassword(dto.password);
      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          email: dto.email.toLowerCase(),
          fullName: normalizedFullName,
          passwordHash,
        },
      });

      const membership = await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: dto.role,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          userId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'OrganizationMember',
          entityId: membership.id,
          metadata: {
            event: 'ADD_MEMBER',
            email: dto.email,
            role: dto.role,
          },
        },
      });

      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: membership.role,
      };
    });
  }

  private async hashPassword(password: string) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  async getMembers(actor: CurrentUserData) {
    const members = await this.prisma.organizationMember.findMany({
      where: {
        organizationId: actor.organizationId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return members.map((m) => ({
      id: m.userId,
      email: m.user?.email,
      fullName: m.user?.fullName,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async changeMemberRole(targetUserId: string, newRole: OrganizationRole, actor: CurrentUserData) {
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMember.findUnique({
        where: {
          userId_organizationId: {
            userId: targetUserId,
            organizationId: actor.organizationId,
          },
        },
      });

      if (!membership) throw new NotFoundException('Member not found');

      if (targetUserId === actor.userId && membership.role === OrganizationRole.OWNER) {
        throw new ForbiddenException('Owners cannot change their own role');
      }

      if (membership.role === OrganizationRole.OWNER && newRole !== OrganizationRole.OWNER) {
        const ownerCount = await tx.organizationMember.count({
          where: { organizationId: actor.organizationId, role: OrganizationRole.OWNER },
        });
        if (ownerCount <= 1)
          throw new ForbiddenException('Cannot change the role of the last owner');
      }

      await tx.organizationMember.update({
        where: { id: membership.id },
        data: { role: newRole },
      });

      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.userId,
          action: AuditAction.UPDATE,
          entityType: 'OrganizationMember',
          entityId: membership.id,
          metadata: { event: 'CHANGE_ROLE', newRole },
        },
      });

      return { success: true };
    });
  }

  async removeMember(targetUserId: string, actor: CurrentUserData) {
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMember.findUnique({
        where: {
          userId_organizationId: {
            userId: targetUserId,
            organizationId: actor.organizationId,
          },
        },
      });

      if (!membership) throw new NotFoundException('Member not found');

      if (targetUserId === actor.userId && membership.role === OrganizationRole.OWNER) {
        throw new ForbiddenException('Owners cannot remove themselves from the organization');
      }

      if (membership.role === OrganizationRole.OWNER) {
        const ownerCount = await tx.organizationMember.count({
          where: { organizationId: actor.organizationId, role: OrganizationRole.OWNER },
        });
        if (ownerCount <= 1) throw new ForbiddenException('Cannot remove the last owner');
      }

      await tx.organizationMember.delete({
        where: { id: membership.id },
      });

      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.userId,
          action: AuditAction.DELETE,
          entityType: 'OrganizationMember',
          entityId: membership.id,
          metadata: { event: 'REMOVE_MEMBER' },
        },
      });

      return { success: true };
    });
  }

  // ─── Organization Lifecycle ────────────────────────────────────────────────

  /**
   * Soft-delete an organization.
   * Sets deletedAt + INACTIVE status. R2 files are preserved during grace period.
   * Only OWNER can trigger this.
   */
  async softDeleteOrg(actor: CurrentUserData) {
    const org = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
    });

    if (!org || org.deletedAt) {
      throw new NotFoundException('Organization not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: actor.organizationId },
        data: {
          deletedAt: new Date(),
          status: OrganizationStatus.INACTIVE,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.userId,
          action: AuditAction.SOFT_DELETE,
          entityType: 'Organization',
          entityId: actor.organizationId,
          metadata: { event: 'ORG_SOFT_DELETE' },
        },
      });
    });

    this.logger.warn(`Org soft-deleted: ${actor.organizationId} by user ${actor.userId}`);
    return { success: true, message: 'Organization scheduled for deletion' };
  }

  /**
   * Permanently delete an organization and all its data.
   * Purges R2 storage first (best-effort), then cascades the DB delete.
   *
   * ONLY call this after the grace period has elapsed and soft-delete is confirmed.
   * Must only be called by a super-admin / internal job — NOT exposed via HTTP directly.
   */
  async hardDeleteOrg(orgId: string): Promise<void> {
    this.logger.warn(`Starting hard delete for org: ${orgId}`);

    // 1. Purge R2 storage first — best effort, non-fatal
    await this.uploadService
      .purgeOrgFolder(orgId)
      .catch((err) =>
        this.logger.error(`R2 cleanup failed for org ${orgId} — continuing with DB delete`, err),
      );

    // 2. Hard delete from DB — Prisma cascade handles all child records
    await this.prisma.organization.delete({ where: { id: orgId } });

    this.logger.warn(`Org hard-deleted: ${orgId}`);
  }
}
