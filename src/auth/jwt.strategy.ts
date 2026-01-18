import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  org: string;
  role: OrganizationRole;
  sessionId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    });
  }

  async validate(payload: JwtPayload) {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session has expired');
    }

    if (session.userId !== payload.sub || session.organizationId !== payload.org) {
      throw new UnauthorizedException('Session does not match token claims');
    }

    if (session.role !== payload.role) {
      throw new UnauthorizedException('Session role mismatch');
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: payload.sub,
          organizationId: payload.org,
        },
      },
    });

    if (!membership) {
      throw new UnauthorizedException(
        'User is not a member of the specified organization',
      );
    }

    if (membership.role !== payload.role) {
      throw new UnauthorizedException('Role mismatch');
    }

    // Return user info that will be attached to request.user
    return {
      userId: payload.sub,
      email: payload.email,
      organizationId: payload.org,
      role: payload.role,
      sessionId: session.id,
    };
  }
}

