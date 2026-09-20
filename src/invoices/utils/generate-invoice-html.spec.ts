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

/**
 * Width of every row of the main items table, counting cells carried down from an
 * earlier row by a rowspan (the merged payments cell), so a misaligned row shows up.
 */
const rowWidths = (html: string): number[] => {
  const table = html.match(/<table class="items-table">([\s\S]*?)<\/table>/)![1];
  const carried: { span: number; remaining: number }[] = [];
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) => {
    let width = carried.reduce((sum, c) => sum + c.span, 0);
    const added: { span: number; remaining: number }[] = [];
    for (const [, attrs] of row.matchAll(/<t[dh]([^>]*)>/g)) {
      const span = Number(/colspan="(\d+)"/.exec(attrs)?.[1] ?? 1);
      const rowspan = Number(/rowspan="(\d+)"/.exec(attrs)?.[1] ?? 1);
      width += span;
      if (rowspan > 1) added.push({ span, remaining: rowspan - 1 });
    }
    carried.forEach((c) => (c.remaining -= 1));
    for (let i = carried.length - 1; i >= 0; i--)
      if (carried[i].remaining <= 0) carried.splice(i, 1);
    carried.push(...added);
    return width;
  });
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

describe('generateInvoiceHtml (standard template) payment placement', () => {
  const payments = [
    { mode: 'UPI', amount: 50000, paidAt: '2025-04-01T00:00:00.000Z' },
    { mode: 'CASH', amount: 20000, paidAt: '2025-04-02T00:00:00.000Z' },
  ];
  const html = generateInvoiceHtml(baseData([item({ purityLabel: '22K' })], { payments }));
  const table = html.match(/<table class="items-table">([\s\S]*?)<\/table>/)![1];

  it('lists each payment on the left, inside the tax block', () => {
    const cell = table.match(
      /<td colspan="3" rowspan="(\d+)" class="payments-cell">([\s\S]*?)<\/td>/,
    );
    expect(cell).not.toBeNull();
    expect(cell![2]).toContain('UPI');
    expect(cell![2]).toContain('CASH');
    // merged across every tax line: taxable value + CGST + SGST + round off
    expect(cell![1]).toBe('4');
  });

  it('shows only the payment lines, without a "Payment Received" heading', () => {
    expect(html).not.toContain('Payment Received');
    const cell = table.match(
      /<td colspan="3" rowspan="\d+" class="payments-cell">([\s\S]*?)<\/td>/,
    )![1];
    expect(cell.startsWith('<div>UPI')).toBe(true);
  });

  it('puts the payments cell in the same row as Taxable Value, before its label', () => {
    const firstTaxRow = table.match(/<tr class="tax-row"[^>]*>([\s\S]*?)<\/tr>/)![1];
    expect(firstTaxRow.indexOf('payments-cell')).toBeGreaterThan(-1);
    expect(firstTaxRow.indexOf('payments-cell')).toBeLessThan(
      firstTaxRow.indexOf('Taxable Value:'),
    );
  });

  it('no longer prints full-width payment rows between Total Amount and Balance Due', () => {
    const between = table.slice(table.indexOf('Total Amount'), table.indexOf('Balance Due'));
    expect(between).not.toContain('UPI');
    expect(between).not.toContain('CASH');
    expect(between).not.toContain('colspan="8"');
  });

  it('keeps the tax labels on the right of the payments cell (colspan 4)', () => {
    expect(table).toContain('<td colspan="4" class="text-right font-bold">Taxable Value:</td>');
  });

  it('keeps the original full-width layout when there are no payments', () => {
    const plain = generateInvoiceHtml(baseData([item({ purityLabel: '22K' })]));
    expect(plain).not.toContain('class="payments-cell"'); // the CSS rule is always present, the cell is not
    expect(plain).toContain('<td colspan="7" class="text-right font-bold">Taxable Value:</td>');
  });

  it('still lists every tax line (hallmarking, IGST) and stays aligned with a hallmarking charge', () => {
    const igst = generateInvoiceHtml(
      baseData([item({ purityLabel: '22K' })], {
        payments,
        taxType: 'IGST',
        hallmarkingCharge: 45,
        taxes: {
          cgstRate: 0,
          sgstRate: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstRate: 3,
          igstAmount: 3,
        },
      }),
    );
    expect(igst).toContain('Hallmarking Charges:');
    expect(igst).toContain('IGST(3%)');
    expect(igst).toMatch(/rowspan="4"/); // taxable + hallmarking + IGST + round off
    expect(new Set(rowWidths(igst))).toEqual(new Set([8]));
  });
});
