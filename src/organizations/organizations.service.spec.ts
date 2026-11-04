import { ForbiddenException } from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService.addMember role ceiling', () => {
  const transaction = jest.fn();
  const service = new OrganizationsService({ $transaction: transaction } as any, {} as any);

  const actor = (role: OrganizationRole) => ({
    userId: 'actor-1',
    email: 'actor@shop.test',
    organizationId: 'org-1',
    role,
    sessionId: 'session-1',
  });

  const dto = (role: OrganizationRole) => ({
    email: 'new@shop.test',
    fullName: 'New Member',
    password: 'password123',
    role,
  });

  beforeEach(() => transaction.mockReset().mockResolvedValue({ id: 'new-user' }));

  it('rejects an ADMIN creating an OWNER before touching the database', async () => {
    await expect(
      service.addMember(dto(OrganizationRole.OWNER), actor(OrganizationRole.ADMIN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([OrganizationRole.ADMIN, OrganizationRole.STAFF, OrganizationRole.VIEWER])(
    'lets an ADMIN add a %s',
    async (role) => {
      await service.addMember(dto(role), actor(OrganizationRole.ADMIN));
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('lets an OWNER add another OWNER', async () => {
    await service.addMember(dto(OrganizationRole.OWNER), actor(OrganizationRole.OWNER));
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
