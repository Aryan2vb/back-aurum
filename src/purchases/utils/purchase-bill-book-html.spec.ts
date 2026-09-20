import { buildPurchaseBillBookHtml, getPurchaseBillBookTitle } from './purchase-bill-book-html';

describe('buildPurchaseBillBookHtml', () => {
  it('renders a placeholder page when attachment is missing', () => {
    const html = buildPurchaseBillBookHtml({
      title: 'Purchase Bill Book - 1 Bill',
      pages: [
        {
          billNo: 'P-100',
          vendorName: 'Gold Supplier',
          purchaseDate: '2026-04-01T00:00:00.000Z',
          attachmentUrl: null,
        },
      ],
    });

    expect(html).toContain('<title>Purchase Bill Book - 1 Bill</title>');
    expect(html).toContain('1 Bill');
    expect(html).toContain('Supplier invoice attachment missing');
    expect(html).toContain('P-100');
    expect(html).toContain('Gold Supplier');
    expect(html).toContain('break-after: page');
  });

  it('embeds image and pdf attachments with bill headers', () => {
    const html = buildPurchaseBillBookHtml({
      title: 'Purchase Bill Book - 2 Bills',
      pages: [
        {
          billNo: 'IMG-1',
          vendorName: 'Vendor A',
          purchaseDate: '2026-04-02T00:00:00.000Z',
          attachmentUrl: 'https://cdn.example.com/inv.jpg',
          attachmentMime: 'image/jpeg',
        },
        {
          billNo: 'PDF-1',
          vendorName: 'Vendor B',
          purchaseDate: '2026-04-03T00:00:00.000Z',
          attachmentUrl: 'https://cdn.example.com/inv.pdf',
          attachmentMime: 'application/pdf',
        },
      ],
    });

    expect(html).toContain('2 Bills');
    expect(html).toContain('https://cdn.example.com/inv.jpg');
    expect(html).toContain('<img src=');
    expect(html).toContain('https://cdn.example.com/inv.pdf');
    expect(html).toContain('type="application/pdf"');
    expect(html.match(/class="print-btn"/g)).toHaveLength(1);
  });

  it('rejects non-http(s) attachment URLs', () => {
    const html = buildPurchaseBillBookHtml({
      title: 'Purchase Bill Book - 1 Bill',
      pages: [
        {
          billNo: 'XSS-1',
          vendorName: 'Bad',
          purchaseDate: '2026-04-01T00:00:00.000Z',
          attachmentUrl: 'javascript:alert(1)',
          attachmentMime: 'image/jpeg',
        },
      ],
    });

    expect(html).toContain('Supplier invoice attachment missing');
    expect(html).not.toContain('javascript:');
  });

  it('does not treat “.pdf” in a query string as a PDF attachment', () => {
    const html = buildPurchaseBillBookHtml({
      title: 'Purchase Bill Book - 1 Bill',
      pages: [
        {
          billNo: 'Q-1',
          vendorName: 'Vendor',
          purchaseDate: '2026-04-01T00:00:00.000Z',
          attachmentUrl: 'https://cdn.example.com/invoice.html?ref=.pdfscan',
        },
      ],
    });

    expect(html).toContain('Attachment preview not supported');
    expect(html).toContain('href="https://cdn.example.com/invoice.html?ref=.pdfscan"');
    expect(html).not.toContain('type="application/pdf"');
  });
});

describe('getPurchaseBillBookTitle', () => {
  it('names selected and searched Bill Books', () => {
    expect(getPurchaseBillBookTitle({ selectedCount: 1 })).toBe('Purchase Bill Book - 1 Bill');
    expect(getPurchaseBillBookTitle({ selectedCount: 5 })).toBe('Purchase Bill Book - 5 Bills');
    expect(getPurchaseBillBookTitle({ search: 'gold' })).toBe('Purchase Bill Book - "gold"');
    expect(getPurchaseBillBookTitle({})).toBe('Purchase Bill Book - All Purchases');
  });
});
