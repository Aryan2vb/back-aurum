import 'reflect-metadata';
import { OrganizationRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ReportsController } from './reports.controller';

describe('ReportsController permissions', () => {
  const reportHandlers = [
    'getSalesSummary',
    'getGstReport',
    'getCollectionsReport',
    'getOutstandingDues',
    'getInventoryFlow',
    'getCustomerStatement',
  ] as const;

  it.each(reportHandlers)('allows viewers to access %s', (handlerName) => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ReportsController.prototype[handlerName],
    ) as OrganizationRole[];

    expect(roles).toContain(OrganizationRole.VIEWER);
  });

  it.each(reportHandlers)('allows staff to access %s', (handlerName) => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ReportsController.prototype[handlerName],
    ) as OrganizationRole[];

    expect(roles).toContain(OrganizationRole.STAFF);
  });
});
