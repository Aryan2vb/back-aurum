import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }
    const requiredRoles =
      this.reflector.getAllAndOverride<OrganizationRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('Missing role for authorization');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role for this operation');
    }

    return true;
  }
}
