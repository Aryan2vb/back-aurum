import { createHash } from 'crypto';

export type HdfcStatementRow = {
  txnDate: Date;
  valueDate: Date | null;
  narration: string;
  debit: number;
  credit: number;
  refNumber: string | null;
  closingBalance: number | null;
  fingerprint: string;
};

const AMOUNT_RE = /^-?\d+(?:\.\d+)?$/;

/** Parse DD/MM/YY or DD/MM/YYYY as UTC midnight. */
export function parseHdfcDate(raw: string): Date | null {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseHdfcAmount(raw: string): number {
  const cleaned = String(raw || '')
    .replace(/,/g, '')
    .trim();
  if (!cleaned || !AMOUNT_RE.test(cleaned)) return 0;
  return Math.round(Number(cleaned) * 100) / 100;
}

export function normalizeHdfcRef(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed || /^0+$/.test(trimmed)) return null;
  const stripped = trimmed.replace(/^0+/, '');
  return stripped || null;
}

export function fingerprintHdfcRow(row: {
  txnDate: Date;
  narration: string;
  debit: number;
  credit: number;
  refNumber: string | null;
}): string {
  const dateKey = row.txnDate.toISOString().slice(0, 10);
  const payload = [
    dateKey,
    row.debit.toFixed(2),
    row.credit.toFixed(2),
    row.refNumber || '',
    row.narration.trim().replace(/\s+/g, ' '),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

export function inferPaymentMethodFromNarration(
  narration: string,
): 'UPI' | 'NEFT' | 'RTGS' | 'IMPS' | 'BANK_TRANSFER' {
  const n = (narration || '').toUpperCase();
  if (n.includes('UPI')) return 'UPI';
  if (n.includes('NEFT')) return 'NEFT';
  if (n.includes('RTGS')) return 'RTGS';
  if (n.includes('IMPS')) return 'IMPS';
  return 'BANK_TRANSFER';
}

/**
 * HDFC netbanking "Delimited" export:
 * Date, Narration, Value Dat, Debit Amount, Credit Amount, Chq/Ref Number, Closing Balance
 * Fields are comma-separated and space-padded.
 */
export function parseHdfcDelimited(text: string): HdfcStatementRow[] {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headerIdx = lines.findIndex(
    (line) => /debit\s*amount/i.test(line) && /credit\s*amount/i.test(line),
  );
  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

  const rows: HdfcStatementRow[] = [];
  for (const line of dataLines) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 6) continue;

    const txnDate = parseHdfcDate(parts[0]);
    if (!txnDate) continue;

    const narration = parts[1] || '';
    const valueDate = parseHdfcDate(parts[2]);
    const debit = parseHdfcAmount(parts[3]);
    const credit = parseHdfcAmount(parts[4]);
    const refNumber = normalizeHdfcRef(parts[5] || '');
    const closingBalance = parts.length > 6 ? parseHdfcAmount(parts[6]) : null;

    if (debit <= 0 && credit <= 0) continue;

    const row = {
      txnDate,
      valueDate,
      narration,
      debit,
      credit,
      refNumber,
      closingBalance: closingBalance === 0 && parts.length <= 6 ? null : closingBalance,
      fingerprint: '',
    };
    row.fingerprint = fingerprintHdfcRow(row);
    rows.push(row);
  }

  return rows;
}
