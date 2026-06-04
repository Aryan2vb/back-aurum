import { CustomersService } from './customers.service';

describe('CustomersService input normalization', () => {
  const organizationId = 'org-1';
  const user = { organizationId, userId: 'user-1' };

  const buildService = (prismaOverrides: any = {}, txOverrides: any = {}) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ nextCustomerNumber: 2 }]),
      customer: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'customer-1', ...data })),
      },
      ...txOverrides,
    };
    const prisma = {
      contactDetail: {
        findFirst: jest.fn(),
      },
      customer: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      location: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
      ...prismaOverrides,
    };

    return {
      prisma,
      service: new CustomersService(prisma as any),
      tx,
    };
  };

  it('stores customer identity and location text in uppercase when creating a customer', async () => {
    const customerCreate = jest.fn().mockResolvedValue({ id: 'customer-1' });
    const { service } = buildService(
      {},
      {
        customer: {
          create: customerCreate,
        },
      },
    );

    await service.create(
      {
        fullName: 'aryan soni',
        gstin: '22aaaaa0000a1z5',
        fatherName: 'ramesh soni',
        motherName: 'sita soni',
        spouseName: 'riya soni',
        contactDetails: {
          primaryPhone: '9876543210',
        },
        locations: [
          {
            village: 'indore',
            tehsil: 'rau',
            district: 'indore',
            state: 'madhya pradesh',
            pincode: '452001',
            landmark: 'near mandir',
          },
        ],
      } as any,
      user as any,
    );

    expect(customerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullName: 'ARYAN SONI',
          gstin: '22AAAAA0000A1Z5',
          fatherName: 'RAMESH SONI',
          motherName: 'SITA SONI',
          spouseName: 'RIYA SONI',
          contactDetails: expect.objectContaining({
            create: expect.objectContaining({
              primaryPhone: '9876543210',
            }),
          }),
          locations: {
            create: [
              expect.objectContaining({
                village: 'INDORE',
                tehsil: 'RAU',
                district: 'INDORE',
                state: 'MADHYA PRADESH',
                pincode: '452001',
                landmark: 'NEAR MANDIR',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('stores customer identity text in uppercase when updating a customer', async () => {
    const { prisma, service } = buildService({
      customer: {
        update: jest.fn().mockResolvedValue({ id: 'customer-1' }),
      },
    });

    await service.update(
      'customer-1',
      {
        fullName: 'aryan soni',
        gstin: '22aaaaa0000a1z5',
        fatherName: 'ramesh soni',
      } as any,
      user as any,
    );

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullName: 'ARYAN SONI',
          gstin: '22AAAAA0000A1Z5',
          fatherName: 'RAMESH SONI',
        }),
      }),
    );
  });

  it('stores location text in uppercase when creating and updating locations', async () => {
    const { prisma, service } = buildService({
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }),
      },
      location: {
        create: jest.fn().mockResolvedValue({ id: 'location-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ id: 'location-1' }),
      },
    });

    await service.addLocation(
      'customer-1',
      {
        village: 'indore',
        tehsil: 'rau',
        district: 'indore',
        state: 'madhya pradesh',
        pincode: '452001',
        landmark: 'near mandir',
      },
      user as any,
    );
    await service.updateLocation(
      'customer-1',
      'location-1',
      {
        village: 'ujjain',
        landmark: 'mahakal road',
      },
      user as any,
    );

    expect(prisma.location.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          village: 'INDORE',
          tehsil: 'RAU',
          district: 'INDORE',
          state: 'MADHYA PRADESH',
          pincode: '452001',
          landmark: 'NEAR MANDIR',
        }),
      }),
    );
    expect(prisma.location.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          village: 'UJJAIN',
          landmark: 'MAHAKAL ROAD',
        }),
      }),
    );
  });
});
