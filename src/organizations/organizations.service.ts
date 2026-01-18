import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditAction, OrganizationStatus } from '@prisma/client';
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
}

