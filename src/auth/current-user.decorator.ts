import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';

export interface CurrentUserData {
  userId: string;
  email: string;
  organizationId: string;
  role: OrganizationRole;
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

