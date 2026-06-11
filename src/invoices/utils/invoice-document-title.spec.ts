import { generateInvoiceHtml } from './generate-invoice-html';
import { generateJewelleryInvoiceHtml } from './generate-jewellery-html';
import { generateModernInvoiceHtml } from './generate-modern-html';
import { InvoiceData } from './invoice-types';

const invoiceData = {
  company: {
    name: 'Aurum',
    address: '',
    gstin: '',
    state: '',
    stateCode: '',
  },
  buyer: {
    name: 'Customer Name',
    address: '',
    state: '',
    stateCode: '',
  },
  metadata: {
    invoiceNo: 'MJ_121_26-27',
    date: '',
  },
  items: [],
  taxes: {
    cgstRate: 0,
    cgstAmount: 0,
    sgstRate: 0,
    sgstAmount: 0,
  },
  hsnSummary: [],
  roundOff: 0,
  totalQuantity: 0,
  totalAmount: 0,
  amountInWords: '',
  taxAmountInWords: '',
} as InvoiceData;

describe('invoice document titles', () => {
  it.each([
    ['default', generateInvoiceHtml],
    ['jewellery', generateJewelleryInvoiceHtml],
    ['modern', generateModernInvoiceHtml],
  ])('includes the customer name in the %s template title', (_template, generateHtml) => {
    expect(generateHtml(invoiceData)).toContain(
      '<title>Tax Invoice - Customer Name - MJ_121_26-27</title>',
    );
  });
});
