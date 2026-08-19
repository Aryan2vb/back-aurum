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
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
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

/**
 * `occurrence` separates genuinely repeated transactions (same day, amount, ref and
 * narration) so the 2nd copy is not swallowed as a duplicate. The 1st occurrence keeps
 * the plain payload hash, so fingerprints of already-imported lines stay stable.
 */
export function fingerprintHdfcRow(
  row: {
    txnDate: Date;
    narration: string;
    debit: number;
    credit: number;
    refNumber: string | null;
  },
  occurrence = 1,
): string {
  const dateKey = row.txnDate.toISOString().slice(0, 10);
  const payload = [
    dateKey,
    row.debit.toFixed(2),
    row.credit.toFixed(2),
    row.refNumber || '',
    row.narration.trim().replace(/\s+/g, ' '),
  ].join('|');
  const keyed = occurrence > 1 ? `${payload}|#${occurrence}` : payload;
  return createHash('sha256').update(keyed).digest('hex');
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

function isHdfcAmountField(raw: string): boolean {
  const cleaned = String(raw || '')
    .replace(/,/g, '')
    .trim();
  return /^-?\d+\.\d{1,2}$/.test(cleaned);
}

/** Headerless rows: find debit/credit by amount positions so comma-split refs stay in refNumber. */
function parseHdfcHeaderlessRow(parts: string[]): {
  debit: number;
  credit: number;
  refNumber: string | null;
  closingBalance: number | null;
  valueDate: Date | null;
  narration: string;
} | null {
  let amountIdx = 1;
  while (
    amountIdx < parts.length - 1 &&
    !(isHdfcAmountField(parts[amountIdx]) && isHdfcAmountField(parts[amountIdx + 1]))
  ) {
    amountIdx += 1;
  }
  if (amountIdx >= parts.length - 1) return null;

  const debit = parseHdfcAmount(parts[amountIdx]);
  const credit = parseHdfcAmount(parts[amountIdx + 1]);
  const rest = parts.slice(amountIdx + 2);
  let closingBalance: number | null = null;
  let refParts = rest;
  if (rest.length && isHdfcAmountField(rest[rest.length - 1])) {
    closingBalance = parseHdfcAmount(rest[rest.length - 1]);
    refParts = rest.slice(0, -1);
  }

  const middle = parts.slice(1, amountIdx);
  let valueDate: Date | null = null;
  let narrationParts = middle;
  if (middle.length) {
    const maybeValueDate = parseHdfcDate(middle[middle.length - 1]);
    if (maybeValueDate) {
      valueDate = maybeValueDate;
      narrationParts = middle.slice(0, -1);
    }
  }

  return {
    debit,
    credit,
    refNumber: normalizeHdfcRef(refParts.join(',')),
    closingBalance,
    valueDate,
    narration: narrationParts.join(', '),
  };
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
  const hasClosingBalance =
    headerIdx >= 0 ? /closing\s*balance/i.test(lines[headerIdx]) : undefined;
  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

  const rows: HdfcStatementRow[] = [];
  const occurrences = new Map<string, number>();
  for (const line of dataLines) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 6) continue;

    const txnDate = parseHdfcDate(parts[0]);
    if (!txnDate) continue;

    let debit: number;
    let credit: number;
    let refNumber: string | null;
    let closingBalance: number | null;
    let valueDate: Date | null = null;
    let narration: string;

    if (hasClosingBalance === undefined) {
      const parsedRow = parseHdfcHeaderlessRow(parts);
      if (!parsedRow) continue;
      debit = parsedRow.debit;
      credit = parsedRow.credit;
      refNumber = parsedRow.refNumber;
      closingBalance = parsedRow.closingBalance;
      valueDate = parsedRow.valueDate;
      narration = parsedRow.narration;
    } else {
      const tailCount = hasClosingBalance ? 4 : 3;
      const tail = parts.slice(-tailCount);
      const middle = parts.slice(1, parts.length - tailCount);
      debit = parseHdfcAmount(tail[0]);
      credit = parseHdfcAmount(tail[1]);
      refNumber = normalizeHdfcRef(tail[2] || '');
      closingBalance = tailCount === 4 ? parseHdfcAmount(tail[3]) : null;
      let narrationParts = middle;
      if (middle.length) {
        const maybeValueDate = parseHdfcDate(middle[middle.length - 1]);
        if (maybeValueDate) {
          valueDate = maybeValueDate;
          narrationParts = middle.slice(0, -1);
        }
      }
      narration = narrationParts.join(', ');
    }

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
    const base = fingerprintHdfcRow(row);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    row.fingerprint = occurrence === 1 ? base : fingerprintHdfcRow(row, occurrence);
    rows.push(row);
  }

  return rows;
}
