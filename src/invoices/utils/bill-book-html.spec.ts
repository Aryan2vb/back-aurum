import { buildBillBookHtml, getBillBookTitle } from './bill-book-html';

describe('buildBillBookHtml', () => {
  it('isolates bills, removes their print buttons, and adds one bill book toolbar', () => {
    const invoiceHtml = (name: string) => `<!DOCTYPE html>
      <html>
        <head><style>body { font-family: Arial; } .invoice { color: black; }</style></head>
        <body>
          <button class="print-btn" onclick="window.print()">Save as PDF / Print</button>
          <div class="invoice">${name}</div>
        </body>
      </html>`;

    const html = buildBillBookHtml({
      title: 'Bill Book - 2 Bills',
      invoices: [invoiceHtml('First Bill'), invoiceHtml('Second Bill')],
    });

    expect(html).toContain('<title>Bill Book - 2 Bills</title>');
    expect(html).toContain('2 Bills');
    expect(html).toContain('data-bill-template="0"');
    expect(html).toContain('data-bill-template="1"');
    expect(html).toContain('attachShadow');
    expect(html).toContain('break-after: page');
    expect(html).toContain('First Bill');
    expect(html).toContain('Second Bill');
    expect(html.match(/class="print-btn"/g)).toHaveLength(1);
  });
});

describe('getBillBookTitle', () => {
  it('names selected and filtered Bill Books', () => {
    expect(getBillBookTitle({ selectedCount: 12 })).toBe('Bill Book - 12 Bills');
    expect(
      getBillBookTitle({
        dateFrom: '2026-04-01',
        dateTo: '2026-04-30',
      }),
    ).toBe('Bill Book - 01-Apr-2026 to 30-Apr-2026');
    expect(getBillBookTitle({})).toBe('Bill Book - All Time');
  });
});
