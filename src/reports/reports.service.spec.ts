import { ReportsService } from './reports.service';

describe('ReportsService collections report', () => {
  it('filters, sorts, and returns collections by the actual paidAt date', async () => {
    const prisma = {
      invoicePayment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ReportsService(prisma as any);

    await service.getCollectionsReport('org-1', {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });

    expect(prisma.invoicePayment.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        paidAt: {
          gte: new Date('2026-06-01'),
          lte: new Date('2026-06-30T23:59:59.999Z'),
        },
      },
      select: {
        mode: true,
        amount: true,
        paidAt: true,
        reference: true,
        invoice: { select: { invoiceNumber: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  });
});
