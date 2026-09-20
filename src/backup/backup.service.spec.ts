// @nestjs/schedule ships ESM-only, which jest's CJS transform can't load; the cron
// decorator is irrelevant to these unit tests.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_DAY_AT_MIDNIGHT: '0 0 * * *' },
}));

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BackupService, buildPgEnv } from './backup.service';

const ORG = 'org-1';

function makeService(overrides: Record<string, any> = {}) {
  const models: Record<string, any> = {};
  const model = (name: string) =>
    (models[name] ??= {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    });

  const tx: any = new Proxy({}, { get: (_t, name: string) => model(name) });
  const prisma: any = {
    organization: { findUnique: jest.fn().mockResolvedValue({ id: ORG, name: 'Org One' }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    ...overrides,
  };
  return { service: new BackupService(prisma), tx, model, prisma };
}

const backup = (data: Record<string, any>, orgId: string | null = ORG) => ({
  metadata: orgId ? { organizationId: orgId } : {},
  organization: orgId ? { id: orgId, name: 'Org One' } : undefined,
  data,
});

describe('BackupService.importOrganizationData', () => {
  it('rejects malformed files with a 400', async () => {
    const { service } = makeService();
    await expect(service.importOrganizationData(ORG, { nope: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a backup that does not declare which organization it came from', async () => {
    const { service } = makeService();
    await expect(
      service.importOrganizationData(ORG, backup({ customers: [{ id: 'c1' }] }, null)),
    ).rejects.toThrow(/does not identify the organization/);
  });

  it('rejects a backup exported from a different organization', async () => {
    const { service } = makeService();
    await expect(
      service.importOrganizationData(ORG, backup({ customers: [{ id: 'c1' }] }, 'org-2')),
    ).rejects.toThrow(/Organization Mismatch/);
  });

  it('refuses the whole import when a record id already belongs to another organization', async () => {
    const { service, model } = makeService();
    model('customer').findFirst.mockResolvedValue({ id: 'victim-customer' });

    await expect(
      service.importOrganizationData(ORG, backup({ customers: [{ id: 'victim-customer', fullName: 'X' }] })),
    ).rejects.toThrow(/belong to another organization/);

    // ownership check is scoped to "not this org" and nothing was written
    expect(model('customer').findFirst.mock.calls[0][0].where).toEqual({
      id: { in: ['victim-customer'] },
      organizationId: { not: ORG },
    });
    expect(model('customer').updateMany).not.toHaveBeenCalled();
    expect(model('customer').create).not.toHaveBeenCalled();
  });

  it('updates only rows owned by the target org, and creates the rest scoped to it', async () => {
    const { service, model } = makeService();
    model('customer').updateMany.mockResolvedValue({ count: 0 });

    const result = await service.importOrganizationData(
      ORG,
      backup({ customers: [{ id: 'c1', fullName: 'A', organizationId: 'spoofed' }] }),
    );

    expect(model('customer').updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: ORG },
      data: { fullName: 'A', organizationId: ORG },
    });
    expect(model('customer').create).toHaveBeenCalledWith({
      data: { id: 'c1', fullName: 'A', organizationId: ORG },
    });
    expect(result.restoredCounts.customers).toBe(1);
  });

  it('writes null Json columns as Prisma.DbNull instead of a bare null', async () => {
    const { service, model } = makeService();
    await service.importOrganizationData(
      ORG,
      backup({ invoices: [{ id: 'i1', buyerSnapshot: null, companySnapshot: { a: 1 } }] }),
    );
    const data = model('invoice').updateMany.mock.calls[0][0].data;
    expect(data.buyerSnapshot).toBe(Prisma.DbNull);
    expect(data.companySnapshot).toEqual({ a: 1 });
  });

  it('imports financial accounts before the payments/ledger rows that reference them', async () => {
    const { service, model } = makeService();
    const order: string[] = [];
    for (const name of ['financialAccount', 'ledgerEntry', 'invoicePayment', 'purchasePayment']) {
      model(name).updateMany.mockImplementation(async () => {
        order.push(name);
        return { count: 1 };
      });
    }
    await service.importOrganizationData(
      ORG,
      backup({
        invoicePayments: [{ id: 'p1' }],
        purchasePayments: [{ id: 'p2' }],
        ledgerEntries: [{ id: 'l1' }],
        financialAccounts: [{ id: 'a1' }],
      }),
    );
    expect(order[0]).toBe('financialAccount');
  });

  it('never moves an invoice sequence backwards', async () => {
    const { service, model } = makeService();
    model('invoiceSequence').updateMany.mockResolvedValue({ count: 0 });
    model('invoiceSequence').count.mockResolvedValue(1); // row exists with a higher live value

    await service.importOrganizationData(
      ORG,
      backup({ invoiceSequences: [{ id: 's1', financialYear: '2026-27', nextSequence: 5 }] }),
    );

    expect(model('invoiceSequence').updateMany.mock.calls[0][0].where).toEqual({
      id: 's1',
      organizationId: ORG,
      nextSequence: { lte: 5 },
    });
    expect(model('invoiceSequence').create).not.toHaveBeenCalled();
  });
});

describe('BackupService.getBackupHistory', () => {
  it("shows an organization only its own exports, never system dumps", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ auditLog: { findMany } });
    await service.getBackupHistory(ORG);
    expect(findMany.mock.calls[0][0].where).toEqual({
      action: 'EXPORT',
      organizationId: ORG,
      entityType: 'ORGANIZATION_BACKUP',
    });
  });

  it('scopes system history to the primary org so the tenant guard does not reject it', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({
      auditLog: { findMany },
      organization: { findFirst: jest.fn().mockResolvedValue({ id: 'primary' }) },
    });
    await service.getBackupHistory();
    expect(findMany.mock.calls[0][0].where).toEqual({
      action: 'EXPORT',
      organizationId: 'primary',
      entityType: 'FULL_SYSTEM_BACKUP',
    });
  });
});

describe('buildPgEnv', () => {
  it('moves credentials into PG* env vars and drops Prisma-only params', () => {
    const env = buildPgEnv(
      'postgresql://app:p%40ss%24w0rd@db.example.com:6543/aurum?schema=public&pgbouncer=true&sslmode=require',
    );
    expect(env.PGHOST).toBe('db.example.com');
    expect(env.PGPORT).toBe('6543');
    expect(env.PGUSER).toBe('app');
    expect(env.PGPASSWORD).toBe('p@ss$w0rd'); // decoded, never shell-interpolated
    expect(env.PGDATABASE).toBe('aurum');
    expect(env.PGSSLMODE).toBe('require');
  });
});
