import { validate } from 'class-validator';
import { CreateBillBookDto } from './create-bill-book.dto';

describe('CreateBillBookDto', () => {
  it('accepts selected invoice IDs or invoice filters without imposing a count limit', async () => {
    const selected = Object.assign(new CreateBillBookDto(), {
      invoiceIds: Array.from({ length: 1200 }, (_, index) => `invoice-${index}`),
    });
    const filtered = Object.assign(new CreateBillBookDto(), {
      search: 'MJ',
      status: 'PAID',
      dateFrom: '2026-04-01',
      dateTo: '2026-06-12',
    });

    await expect(validate(selected)).resolves.toHaveLength(0);
    await expect(validate(filtered)).resolves.toHaveLength(0);
  });
});
