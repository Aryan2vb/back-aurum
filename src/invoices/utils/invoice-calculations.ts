/**
 * Invoice calculation utilities
 * Server-side port of bill/src/lib/invoice/calculations.ts
 * Do NOT rewrite — port only.
 */

import {
  CompanyDetails,
  BuyerDetails,
  InvoiceMetadata,
  InvoiceItem,
  TaxDetails,
  HsnSummary,
  InvoiceData,
} from './invoice-types';

// ───────────────────────────── words ─────────────────────────────

const ones = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertChunk(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertChunk(n % 100) : '');
}

/**
 * Convert a number to Indian Rupees in words.
 * e.g. 1234567 → "Indian Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only"
 */
export function numberToIndianWords(num: number): string {
  if (num === 0) return 'Zero Rupees Only';

  const isNegative = num < 0;
  num = Math.abs(num);

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let result = '';

  if (rupees > 0) {
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const remainder = rupees % 1000;

    const parts: string[] = [];
    if (crore > 0) parts.push(convertChunk(crore) + ' Crore');
    if (lakh > 0) parts.push(convertChunk(lakh) + ' Lakh');
    if (thousand > 0) parts.push(convertChunk(thousand) + ' Thousand');
    if (remainder > 0) parts.push(convertChunk(remainder));

    result = parts.join(' ') + ' Rupees';
  }

  if (paise > 0) {
    result += (rupees > 0 ? ' and ' : '') + convertChunk(paise) + ' Paise';
  }

  result += ' Only';

  return (isNegative ? 'Minus ' : '') + 'Indian Rupees ' + result;
}

// ───────────────────────────── financial year ─────────────────────────────

/**
 * Returns "YY-YY" for the Indian financial year containing the given date.
 * e.g. April 2025 → "25-26"; January 2026 → "25-26"
 */
export function getFinancialYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  if (month >= 4) {
    return `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
  }
  return `${String(year - 1).slice(2)}-${String(year).slice(2)}`;
}

// ───────────────────────────── form shapes ─────────────────────────────

export interface FormItem {
  description: string;
  hsnSac: string;
  partNo?: string;
  quantity: number;
  unit: string;
  rate: number;
  makingCharges?: number;
  grossWeight?: number;
  netWeight?: number;
  purity?: string;
  huid?: string;
}

export interface FormTaxConfig {
  cgstRate: number;
  sgstRate: number;
  igstRate?: number;
}

export interface FormState {
  company: CompanyDetails;
  buyer: BuyerDetails;
  metadata: InvoiceMetadata;
  items: FormItem[];
  taxConfig: FormTaxConfig;
  declaration?: string;
}

// ───────────────────────────── core calculation ─────────────────────────────

/**
 * Calculate a complete InvoiceData from a form state.
 * Port of calculateInvoiceData from bill/src/lib/invoice/calculations.ts.
 */
export function calculateInvoiceData(form: FormState): InvoiceData {
  // Build line items
  const items: InvoiceItem[] = form.items.map((item, index) => {
    const making = item.makingCharges ?? 0;
    return {
      slNo: index + 1,
      description: item.description,
      hsnSac: item.hsnSac,
      partNo: item.partNo,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.rate,
      makingCharges: item.makingCharges,
      grossWeight: item.grossWeight,
      netWeight: item.netWeight,
      purity: item.purity,
      huid: item.huid,
      amount: Math.round(item.quantity * (item.rate + making) * 100) / 100,
    };
  });

  const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);

  // Tax calculations
  const cgstRate = form.taxConfig.cgstRate;
  const sgstRate = form.taxConfig.sgstRate;
  const igstRate = form.taxConfig.igstRate || 0;

  const cgstAmount = Math.round(((subtotal * cgstRate) / 100) * 100) / 100;
  const sgstAmount = Math.round(((subtotal * sgstRate) / 100) * 100) / 100;
  const igstAmount = igstRate > 0 ? Math.round(((subtotal * igstRate) / 100) * 100) / 100 : 0;

  const taxes: TaxDetails = {
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    ...(igstRate > 0 ? { igstRate, igstAmount } : {}),
  };

  // HSN summary (group by HSN code)
  const hsnMap = new Map<string, { taxableValue: number }>();
  items.forEach((item) => {
    const existing = hsnMap.get(item.hsnSac) || { taxableValue: 0 };
    existing.taxableValue += item.amount;
    hsnMap.set(item.hsnSac, existing);
  });

  const hsnSummary: HsnSummary[] = Array.from(hsnMap.entries()).map(([hsnSac, data]) => {
    const hsnCgst = Math.round(((data.taxableValue * cgstRate) / 100) * 100) / 100;
    const hsnSgst = Math.round(((data.taxableValue * sgstRate) / 100) * 100) / 100;
    return {
      hsnSac,
      taxableValue: Math.round(data.taxableValue * 100) / 100,
      cgstRate,
      cgstAmount: hsnCgst,
      sgstRate,
      sgstAmount: hsnSgst,
      totalTaxAmount: Math.round((hsnCgst + hsnSgst) * 100) / 100,
    };
  });

  // Totals with round-off
  const totalBeforeRound = subtotal + cgstAmount + sgstAmount + igstAmount;
  const totalAmount = Math.round(totalBeforeRound);
  const roundOff = Math.round((totalAmount - totalBeforeRound) * 100) / 100;
  const totalTaxAmount = cgstAmount + sgstAmount + igstAmount;

  return {
    company: form.company,
    buyer: form.buyer,
    metadata: form.metadata,
    items,
    taxes,
    hsnSummary,
    roundOff,
    totalQuantity: Math.round(totalQuantity * 100) / 100,
    totalAmount,
    amountInWords: numberToIndianWords(totalAmount),
    taxAmountInWords: numberToIndianWords(totalTaxAmount),
    declaration: form.declaration,
  };
}
