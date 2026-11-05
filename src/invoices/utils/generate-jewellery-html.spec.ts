import { generateJewelleryInvoiceHtml } from './generate-jewellery-html';

const data = (company: Record<string, any> = {}): any => ({
  company: {
    name: 'Test Jewellers',
    address: 'Main Road',
    gstin: '23AAAAA0000A1Z5',
    state: 'MP',
    stateCode: '23',
    ...company,
  },
  buyer: { name: 'Buyer', address: 'Market', state: 'MP', stateCode: '23' },
  metadata: { invoiceNo: 'INV/1/25-26', date: '2025-04-01' },
  items: [],
  taxes: { cgstRate: 1.5, sgstRate: 1.5, cgstAmount: 0, sgstAmount: 0, igstRate: 0, igstAmount: 0 },
  taxType: 'CGST_SGST',
  hsnSummary: [],
  roundOff: 0,
  totalAmount: 0,
  amountInWords: 'Zero Only',
  taxAmountInWords: 'Zero Only',
  amtBalance: 0,
});

const metaInfo = (html: string) =>
  html.match(/<div class="meta-info">([\s\S]*?)<\/div>\s*<\/div>/)![1];

describe('generateJewelleryInvoiceHtml shop GSTIN', () => {
  it('prints the shop GSTIN on the line after the shop name, before the address', () => {
    const html = generateJewelleryInvoiceHtml(data());
    const name = html.indexOf('<div class="company-name">Test Jewellers</div>');
    const gstin = html.indexOf('<div class="company-gstin">GSTIN : 23AAAAA0000A1Z5</div>');
    const address = html.indexOf('<div class="company-addr">Main Road</div>');

    expect(name).toBeGreaterThan(-1);
    expect(gstin).toBeGreaterThan(name);
    expect(address).toBeGreaterThan(gstin);
  });

  it('no longer prints the GSTIN under invoice number and date', () => {
    const meta = metaInfo(generateJewelleryInvoiceHtml(data()));
    expect(meta).toContain('INVOICE NO:');
    expect(meta).not.toContain('GSTIN');
  });

  it('leaves the GSTIN line out when the shop has none', () => {
    expect(generateJewelleryInvoiceHtml(data({ gstin: '' }))).not.toContain('company-gstin">');
  });
});
