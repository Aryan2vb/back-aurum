import { generateInvoiceHtml } from './generate-invoice-html';

const baseData = (items: any[], extra: Record<string, any> = {}): any => ({
  company: {
    name: 'Test Jewellers',
    address: 'Main Road',
    gstin: '22AAAAA0000A1Z5',
    state: 'MP',
    stateCode: '23',
  },
  buyer: { name: 'B2B Buyer', address: 'Market', state: 'MP', stateCode: '23' },
  metadata: { invoiceNo: 'INV/1/25-26', date: '2025-04-01' },
  items,
  taxes: {
    cgstRate: 1.5,
    sgstRate: 1.5,
    cgstAmount: 1.5,
    sgstAmount: 1.5,
    igstRate: 0,
    igstAmount: 0,
  },
  taxType: 'CGST_SGST',
  hsnSummary: [],
  roundOff: 0,
  totalAmount: 103,
  amountInWords: 'One Hundred Three Only',
  taxAmountInWords: 'Three Only',
  amtBalance: 0,
  ...extra,
});

const item = (over: Record<string, any> = {}) => ({
  slNo: 1,
  description: 'Gold Ring',
  hsnSac: '7113',
  quantity: 1,
  grossWeight: 5,
  netWeight: 4.8,
  rate: 6000,
  makingCharges: 0,
  amount: 28800,
  ...over,
});

/** Sum of colspans (default 1) for every row of the main items table. */
const rowWidths = (html: string): number[] => {
  const table = html.match(/<table class="items-table">([\s\S]*?)<\/table>/)![1];
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<t[dh]([^>]*)>/g)].reduce(
      (sum, [, attrs]) => sum + Number(/colspan="(\d+)"/.exec(attrs)?.[1] ?? 1),
      0,
    ),
  );
};

describe('generateInvoiceHtml (standard template) purity column', () => {
  it('has a Purity header and prints each item purity', () => {
    const html = generateInvoiceHtml(
      baseData([item({ purityLabel: '22K' }), item({ slNo: 2, purityLabel: '24K' })]),
    );
    expect(html).toContain('>Purity</th>');
    expect(html).toContain('<td class="text-center">22K</td>');
    expect(html).toContain('<td class="text-center">24K</td>');
  });

  it('falls back to item.purity when purityLabel is missing', () => {
    const html = generateInvoiceHtml(baseData([item({ purity: '18K' })]));
    expect(html).toContain('<td class="text-center">18K</td>');
  });

  it.each([undefined, '', 'None', 'NONE', '-'])(
    'prints a dash for a missing purity (%p)',
    (purityLabel) => {
      const html = generateInvoiceHtml(baseData([item({ purityLabel })]));
      expect(html).toContain('<td class="text-center">-</td>');
    },
  );

  it('keeps every row of the items table the same width (header, items, spacers, tax and total rows)', () => {
    const paid = generateInvoiceHtml(
      baseData([item({ purityLabel: '22K' })], {
        payments: [{ mode: 'CASH', amount: 103, paidAt: '2025-04-01T00:00:00.000Z' }],
      }),
    );
    const widths = rowWidths(paid);
    expect(widths.length).toBeGreaterThan(8);
    expect(new Set(widths)).toEqual(new Set([8]));
  });

  it('stays aligned for IGST invoices and the cash-received line too', () => {
    const html = generateInvoiceHtml(
      baseData([item({ purityLabel: '22K' })], {
        taxType: 'IGST',
        taxes: {
          cgstRate: 0,
          sgstRate: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstRate: 3,
          igstAmount: 3,
        },
        cashReceived: 50,
      }),
    );
    expect(new Set(rowWidths(html))).toEqual(new Set([8]));
  });
});
