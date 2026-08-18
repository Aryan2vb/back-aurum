import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AccessPolicyService } from '../organizations/access-policy.service';
import {
  ACCESS_WINDOW_CLOSED,
  MODULE_ACCESS_DENIED,
} from '../organizations/access-policy.constants';
import { moduleForPath } from '../organizations/access-policy.util';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles =
      this.reflector.getAllAndOverride<OrganizationRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: OrganizationRole; organizationId?: string } | undefined;

    if (!user?.role) {
      if (requiredRoles.length === 0) return true;
      throw new ForbiddenException('Missing role for authorization');
    }

    if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role for this operation');
    }

    if (user.role === OrganizationRole.OWNER) return true;

    const urlPath = String(request.path || request.url || '')
      .split('?')[0]
      .replace(/^\/+/, '');

    // Allow logout outside the window so the client can clear the session.
    if (urlPath === 'auth/logout') return true;

    const windowCheck = await this.accessPolicy.assertWithinAccessWindow(
      user.organizationId!,
      user.role,
    );
    if (windowCheck.ok === false) {
      throw new ForbiddenException({
        code: ACCESS_WINDOW_CLOSED,
        message: `Access is only allowed between ${windowCheck.start} and ${windowCheck.end} (${windowCheck.timezone})`,
      });
    }

    const mod = moduleForPath(urlPath);
    if (mod) {
      const allowed = await this.accessPolicy.assertModuleAccess(
        user.organizationId!,
        user.role,
        mod,
      );
      if (!allowed) {
        throw new ForbiddenException({
          code: MODULE_ACCESS_DENIED,
          message: `Your role cannot access the ${mod} module`,
        });
      }
    }

    return true;
  }
}
