import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { FinanceBookQueryDto } from './finance.dto';

// Mirrors the global pipe in main.ts — forbidNonWhitelisted rejects any query
// key that is not declared on the DTO.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const meta: ArgumentMetadata = { type: 'query', metatype: FinanceBookQueryDto, data: '' };

describe('FinanceBookQueryDto', () => {
  it('accepts type with the shared date filters', async () => {
    await expect(
      pipe.transform({ type: 'CASH', dateFrom: '2026-07-01', dateTo: '2026-07-31' }, meta),
    ).resolves.toMatchObject({ type: 'CASH', dateFrom: '2026-07-01' });
  });

  it('rejects an unknown account type and unknown query keys', async () => {
    await expect(pipe.transform({ type: 'GOLD' }, meta)).rejects.toThrow();
    await expect(pipe.transform({ type: 'BANK', nope: '1' }, meta)).rejects.toMatchObject({
      response: { message: expect.arrayContaining(['property nope should not exist']) },
    });
  });
});
