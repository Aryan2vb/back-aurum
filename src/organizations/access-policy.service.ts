import { BadRequestException, Injectable } from '@nestjs/common';
import { OrganizationRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_MODULES,
  AccessModule,
  DEFAULT_MODULE_ROLES,
  DELEGATED_ROLES,
  DelegatedRole,
} from './access-policy.constants';
import {
  isWithinAccessWindow,
  normalizeModuleAccess,
  parseHmToMinutes,
  roleCanAccessModule,
} from './access-policy.util';
import { UpdateAccessPolicyDto } from './dto/update-access-policy.dto';

export type AccessPolicyView = {
  accessWindowEnabled: boolean;
  accessWindowStart: string;
  accessWindowEnd: string;
  timezone: string;
  moduleAccess: Record<AccessModule, DelegatedRole[]>;
  /** For the caller's role: which modules are open. OWNER → all true. */
  modulesForRole: Record<AccessModule, boolean>;
  withinAccessWindow: boolean;
};

@Injectable()
export class AccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicyView(
    organizationId: string,
    role: OrganizationRole,
    now = new Date(),
  ): Promise<AccessPolicyView> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        timezone: true,
        accessPolicy: true,
      },
    });

    const timezone = org?.timezone || 'UTC';
    const policy = org?.accessPolicy;
    const moduleAccess = normalizeModuleAccess(policy?.moduleAccess ?? {});
    const accessWindowEnabled = policy?.accessWindowEnabled ?? false;
    const accessWindowStart = policy?.accessWindowStart ?? '09:00';
    const accessWindowEnd = policy?.accessWindowEnd ?? '20:00';

    const withinAccessWindow =
      role === OrganizationRole.OWNER ||
      isWithinAccessWindow(now, timezone, accessWindowStart, accessWindowEnd, accessWindowEnabled);

    const modulesForRole = {} as Record<AccessModule, boolean>;
    for (const mod of ACCESS_MODULES) {
      modulesForRole[mod] = roleCanAccessModule(role, mod, moduleAccess);
    }

    return {
      accessWindowEnabled,
      accessWindowStart,
      accessWindowEnd,
      timezone,
      moduleAccess,
      modulesForRole,
      withinAccessWindow,
    };
  }

  async assertWithinAccessWindow(
    organizationId: string,
    role: OrganizationRole,
    now = new Date(),
  ): Promise<{ ok: true } | { ok: false; start: string; end: string; timezone: string }> {
    if (role === OrganizationRole.OWNER) return { ok: true };

    const view = await this.getPolicyView(organizationId, role, now);
    if (view.withinAccessWindow) return { ok: true };
    return {
      ok: false,
      start: view.accessWindowStart,
      end: view.accessWindowEnd,
      timezone: view.timezone,
    };
  }

  async assertModuleAccess(
    organizationId: string,
    role: OrganizationRole,
    module: AccessModule,
  ): Promise<boolean> {
    if (role === OrganizationRole.OWNER) return true;
    const view = await this.getPolicyView(organizationId, role);
    return view.modulesForRole[module];
  }

  async upsert(organizationId: string, dto: UpdateAccessPolicyDto) {
    if (dto.accessWindowStart !== undefined && parseHmToMinutes(dto.accessWindowStart) === null) {
      throw new BadRequestException('accessWindowStart must be HH:mm');
    }
    if (dto.accessWindowEnd !== undefined && parseHmToMinutes(dto.accessWindowEnd) === null) {
      throw new BadRequestException('accessWindowEnd must be HH:mm');
    }

    let moduleAccess: Prisma.InputJsonValue | undefined;
    if (dto.moduleAccess) {
      moduleAccess = normalizeModuleAccess(dto.moduleAccess) as unknown as Prisma.InputJsonValue;
    }

    if (dto.timezone !== undefined) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException('Invalid IANA timezone');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.timezone !== undefined) {
        await tx.organization.update({
          where: { id: organizationId },
          data: { timezone: dto.timezone },
        });
      }

      const existing = await tx.orgAccessPolicy.findUnique({
        where: { organizationId },
      });

      if (!existing) {
        await tx.orgAccessPolicy.create({
          data: {
            organizationId,
            accessWindowEnabled: dto.accessWindowEnabled ?? false,
            accessWindowStart: dto.accessWindowStart ?? '09:00',
            accessWindowEnd: dto.accessWindowEnd ?? '20:00',
            moduleAccess:
              moduleAccess ?? (normalizeModuleAccess({}) as unknown as Prisma.InputJsonValue),
          },
        });
      } else {
        await tx.orgAccessPolicy.update({
          where: { organizationId },
          data: {
            ...(dto.accessWindowEnabled !== undefined
              ? { accessWindowEnabled: dto.accessWindowEnabled }
              : {}),
            ...(dto.accessWindowStart !== undefined
              ? { accessWindowStart: dto.accessWindowStart }
              : {}),
            ...(dto.accessWindowEnd !== undefined ? { accessWindowEnd: dto.accessWindowEnd } : {}),
            ...(moduleAccess !== undefined ? { moduleAccess } : {}),
          },
        });
      }
    });

    return this.getPolicyView(organizationId, OrganizationRole.OWNER);
  }

  /** Defaults used when no row exists yet (for settings UI). */
  defaultModuleAccess(): Record<AccessModule, DelegatedRole[]> {
    return normalizeModuleAccess({});
  }
}

// re-export for tests
export { DEFAULT_MODULE_ROLES, DELEGATED_ROLES };
