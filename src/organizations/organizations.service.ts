import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditAction, OrganizationStatus, OrganizationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { CurrentUserData } from '../auth/current-user.decorator';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);
  private readonly inviteTtlDays = Number(process.env.ORG_INVITE_TTL_DAYS ?? 7);

  constructor(private readonly prisma: PrismaService) {
    this.logger.log('OrganizationsService initialized');
  }

  async inviteMember(dto: InviteMemberDto, actor: CurrentUserData) {
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

      const allowedStatuses: OrganizationStatus[] = [
        OrganizationStatus.ACTIVE,
        OrganizationStatus.TRIAL,
      ];

      if (!allowedStatuses.includes(organization.status)) {
        throw new ForbiddenException('Organization is not active');
      }

      const existingUser = await tx.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });

      if (existingUser) {
        throw new ConflictException('User already belongs to an organization');
      }

      const expiresAt = this.addDays(new Date(), this.inviteTtlDays);
      const token = randomUUID();

      const existingInvitation = await tx.organizationInvitation.findFirst({
        where: {
          organizationId: organization.id,
          email: dto.email,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      const invitation = existingInvitation
        ? await tx.organizationInvitation.update({
            where: { id: existingInvitation.id },
            data: {
              role: dto.role,
              token,
              expiresAt,
              createdById: actor.userId,
            },
          })
        : await tx.organizationInvitation.create({
            data: {
              organizationId: organization.id,
              email: dto.email,
              role: dto.role,
              token,
              expiresAt,
              createdById: actor.userId,
            },
          });

      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          userId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'OrganizationInvitation',
          entityId: invitation.id,
          metadata: {
            event: 'INVITE_MEMBER',
            email: dto.email,
            role: dto.role,
          },
        },
      });

      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        token: invitation.token,
      };
    });
  }

  private addDays(date: Date, days: number) {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
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
      
      if (membership.role === OrganizationRole.OWNER && newRole !== OrganizationRole.OWNER) {
        const ownerCount = await tx.organizationMember.count({
          where: { organizationId: actor.organizationId, role: OrganizationRole.OWNER },
        });
        if (ownerCount <= 1) throw new ForbiddenException('Cannot change the role of the last owner');
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
}

