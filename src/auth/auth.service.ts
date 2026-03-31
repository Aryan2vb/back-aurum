import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AuditAction, OrganizationRole, OrganizationStatus, Prisma } from '@prisma/client';
import { JwtPayload } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CurrentUserData } from './current-user.decorator';

interface AuthRequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthTokenResponse {
  accessToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTokenTtlMinutes = Number(
    process.env.JWT_ACCESS_TTL_MINUTES ?? 180, // Default 3 hours (180 minutes)
  );

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('AuthService initialized');
  }

  async signupFounder(dto: SignupDto, meta: AuthRequestMetadata): Promise<AuthTokenResponse> {
    this.logger.log(
      `Signup attempt for email: ${dto.email}, organization: ${dto.organizationName}`,
    );
    return this.prisma.$transaction(async (tx) => {
      await this.assertEmailAvailable(tx, dto.email);
      const normalizedFullName = dto.fullName.trim();

      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          status: OrganizationStatus.ACTIVE,
        },
      });

      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          email: dto.email,
          fullName: normalizedFullName,
          passwordHash: await this.hashPassword(dto.password),
        },
      });

      const membership = await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrganizationRole.OWNER,
        },
      });

      await this.recordAuditLog(tx, {
        organizationId: organization.id,
        userId: user.id,
        action: AuditAction.CREATE,
        entityType: 'Organization',
        entityId: organization.id,
        metadata: {
          event: 'SIGNUP_FOUNDER',
          organizationName: organization.name,
          email: user.email,
          fullName: normalizedFullName,
        },
        meta,
      });

      await this.recordAuditLog(tx, {
        organizationId: organization.id,
        userId: user.id,
        action: AuditAction.CREATE,
        entityType: 'OrganizationMember',
        entityId: membership.id,
        metadata: {
          event: 'CREATE_ORGANIZATION_MEMBER',
          role: membership.role,
          userFullName: normalizedFullName,
        },
        meta,
      });

      const session = await this.createSession(tx, user.id, organization.id, membership.role, meta);

      const accessToken = this.buildAccessToken({
        sub: user.id,
        email: user.email,
        org: organization.id,
        role: membership.role,
        sessionId: session.id,
      });

      await this.recordAuditLog(tx, {
        organizationId: organization.id,
        userId: user.id,
        action: AuditAction.LOGIN,
        entityType: 'User',
        entityId: user.id,
        metadata: {
          event: 'LOGIN',
          reason: 'SIGNUP_FOUNDER',
          fullName: normalizedFullName,
        },
        meta,
      });

      this.logger.log(`Signup successful for user ${user.id}, organization ${organization.id}`);
      return { accessToken };
    });
  }

  async getInvitationByToken(token: string) {
    this.logger.log(`Fetching invitation details for token: ${token.substring(0, 8)}...`);
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { token },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.acceptedAt) {
      throw new ConflictException('Invitation has already been accepted');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    return {
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organization.name,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(
    dto: AcceptInvitationDto,
    meta: AuthRequestMetadata,
  ): Promise<AuthTokenResponse> {
    this.logger.log(`Accepting invitation with token: ${dto.token.substring(0, 8)}...`);
    return this.prisma.$transaction(async (tx) => {
      await this.assertEmailAvailable(tx, dto.email);
      const normalizedFullName = dto.fullName?.trim() ?? null;

      const invitation = await tx.organizationInvitation.findUnique({
        where: { token: dto.token },
        include: {
          organization: true,
        },
      });

      if (!invitation) {
        throw new NotFoundException('Invitation not found');
      }

      if (invitation.acceptedAt) {
        throw new ConflictException('Invitation has already been accepted');
      }

      if (invitation.expiresAt < new Date()) {
        throw new BadRequestException('Invitation has expired');
      }

      if (invitation.email.toLowerCase() !== dto.email.toLowerCase()) {
        throw new ForbiddenException('Invitation email does not match');
      }

      if (
        invitation.organization.status !== OrganizationStatus.ACTIVE ||
        invitation.organization.deletedAt
      ) {
        throw new ForbiddenException('Organization is not active');
      }

      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          email: dto.email,
          fullName: normalizedFullName,
          passwordHash: await this.hashPassword(dto.password),
        },
      });

      const membership = await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: invitation.organizationId,
          role: invitation.role ?? OrganizationRole.STAFF,
        },
      });

      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      await this.recordAuditLog(tx, {
        organizationId: invitation.organizationId,
        userId: user.id,
        action: AuditAction.CREATE,
        entityType: 'OrganizationMember',
        entityId: membership.id,
        metadata: {
          event: 'CREATE_ORGANIZATION_MEMBER',
          source: 'INVITATION',
          role: membership.role,
          userFullName: normalizedFullName,
        },
        meta,
      });

      const session = await this.createSession(
        tx,
        user.id,
        invitation.organizationId,
        membership.role,
        meta,
      );

      const accessToken = this.buildAccessToken({
        sub: user.id,
        email: user.email,
        org: invitation.organizationId,
        role: membership.role,
        sessionId: session.id,
      });

      await this.recordAuditLog(tx, {
        organizationId: invitation.organizationId,
        userId: user.id,
        action: AuditAction.LOGIN,
        entityType: 'User',
        entityId: user.id,
        metadata: {
          event: 'LOGIN',
          reason: 'INVITATION',
          fullName: normalizedFullName,
        },
        meta,
      });

      this.logger.log(
        `Invitation accepted for user ${user.id}, organization ${invitation.organizationId}`,
      );
      return { accessToken };
    });
  }

  async login(dto: LoginDto, meta: AuthRequestMetadata): Promise<AuthTokenResponse> {
    this.logger.log(`Login attempt for email: ${dto.email}`);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        members: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      this.logger.warn(`Login failed: User not found or no password hash for email: ${dto.email}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await this.verifyPassword(dto.password, user.passwordHash);

    if (!valid) {
      this.logger.warn(`Login failed: Invalid password for email: ${dto.email}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.members.length !== 1) {
      throw new ForbiddenException('User must be bound to exactly one organization');
    }

    const membership = user.members[0];

    if (membership.organization.status !== OrganizationStatus.ACTIVE) {
      throw new ForbiddenException('Organization is not active');
    }

    const session = await this.createSession(
      this.prisma,
      user.id,
      membership.organizationId,
      membership.role,
      meta,
    );

    const accessToken = this.buildAccessToken({
      sub: user.id,
      email: user.email,
      org: membership.organizationId,
      role: membership.role,
      sessionId: session.id,
    });

    await this.recordAuditLog(this.prisma, {
      organizationId: membership.organizationId,
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      metadata: {
        event: 'LOGIN',
        reason: 'CREDENTIALS',
      },
      meta,
    });

    this.logger.log(
      `Login successful for user ${user.id}, organization ${membership.organizationId}`,
    );
    return { accessToken };
  }

  async whoami(user: CurrentUserData) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        members: {
          where: { organizationId: user.organizationId },
          select: {
            role: true,
            organization: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!dbUser) {
      throw new NotFoundException('User not found');
    }

    const membership = dbUser.members[0];

    return {
      userId: dbUser.id,
      email: dbUser.email,
      fullName: dbUser.fullName,
      sessionId: user.sessionId,
      organization: membership
        ? {
            id: membership.organization.id,
            name: membership.organization.name,
            status: membership.organization.status,
            role: membership.role,
          }
        : null,
    };
  }

  async logout(user: CurrentUserData, meta: AuthRequestMetadata) {
    this.logger.log(`Logout for user ${user.userId}, session ${user.sessionId}`);
    await this.revokeSession(user.sessionId, user.organizationId);

    await this.recordAuditLog(this.prisma, {
      organizationId: user.organizationId,
      userId: user.userId,
      action: AuditAction.LOGOUT,
      entityType: 'Session',
      entityId: user.sessionId,
      metadata: {
        event: 'LOGOUT',
        email: user.email,
      },
      meta,
    });

    return { success: true };
  }

  private async assertEmailAvailable(
    client: Prisma.TransactionClient | PrismaService,
    email: string,
  ): Promise<void> {
    const existing = await client.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('Email is already registered');
    }
  }

  private async revokeSession(sessionId: string, organizationId: string) {
    await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        organizationId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private async createSession(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    organizationId: string,
    role: OrganizationRole,
    meta: AuthRequestMetadata = {},
  ) {
    return client.session.create({
      data: {
        userId,
        organizationId,
        role,
        expiresAt: this.calculateExpiryDate(),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });
  }

  private buildAccessToken(payload: JwtPayload): string {
    const expiresInSeconds = this.accessTokenTtlMinutes * 60;
    return this.jwtService.sign(payload, {
      expiresIn: expiresInSeconds,
    });
  }

  private calculateExpiryDate() {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.accessTokenTtlMinutes);
    return expiresAt;
  }

  private async hashPassword(password: string) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  private async verifyPassword(password: string, hash: string) {
    return bcrypt.compare(password, hash);
  }

  private async recordAuditLog(
    client: Prisma.TransactionClient | PrismaService,
    params: {
      organizationId: string;
      userId?: string;
      action: AuditAction;
      entityType: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
      meta?: AuthRequestMetadata;
    },
  ) {
    await client.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: this.buildAuditMetadata(params.metadata ?? {}, params.meta),
        ipAddress: params.meta?.ipAddress,
        userAgent: params.meta?.userAgent,
      },
    });
  }

  private buildAuditMetadata(
    base: Record<string, unknown>,
    meta?: AuthRequestMetadata,
  ): Prisma.JsonObject {
    const metadata: Prisma.JsonObject = {};

    for (const [key, value] of Object.entries(base)) {
      metadata[key] = value as Prisma.JsonValue;
    }

    if (meta?.ipAddress) {
      metadata.ipAddress = meta.ipAddress;
    }

    if (meta?.userAgent) {
      metadata.userAgent = meta.userAgent;
    }

    return metadata;
  }
}
