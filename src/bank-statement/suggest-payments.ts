/** Non-cash modes that typically appear on a bank statement. */
export const BANKISH_PAYMENT_MODES = [
  'UPI',
  'BANK_TRANSFER',
  'CHEQUE',
  'CARD',
  'NEFT',
  'RTGS',
  'IMPS',
  'OTHER',
] as const;

export type PaymentCandidate = {
  id: string;
  amount: number;
  /** payment.amount − already-linked statement credits */
  remaining: number;
  mode: string;
  reference: string | null;
  paidAt: Date | string;
  accountId: string | null;
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  customerName: string;
};

export type StatementCredit = {
  credit: number;
  narration: string;
  refNumber: string | null;
  txnDate: Date | string;
  accountId: string;
};

export const AMOUNT_TOLERANCE = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD for payment/bank dates (date-only compare; not invoice date). */
export const calendarDayKey = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

export const sameCalendarDay = (
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): boolean => {
  const ka = calendarDayKey(a);
  const kb = calendarDayKey(b);
  return Boolean(ka && kb && ka === kb);
};

/** Bucket payments by YYYY-MM-DD so scoring skips other days. */
export const indexPaymentsByCalendarDay = (
  payments: PaymentCandidate[],
): Map<string, PaymentCandidate[]> => {
  const map = new Map<string, PaymentCandidate[]>();
  for (const payment of payments) {
    const key = calendarDayKey(payment.paidAt);
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(payment);
    else map.set(key, [payment]);
  }
  return map;
};

const daysBetween = (a: Date | string, b: Date | string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;

/**
 * Score existing invoice payments against a bank credit.
 * Same calendar day as bank txn (payment paidAt). Credit may be a split
 * that fills part of a larger booked payment (remaining ≥ credit).
 */
export const suggestPaymentsForCredit = (
  line: StatementCredit,
  payments: PaymentCandidate[],
  limit = 5,
) => {
  const credit = Number(line.credit);
  const narration = (line.narration || '').toUpperCase();
  const bankRef = (line.refNumber || '').toUpperCase().trim();
  const bankDay = calendarDayKey(line.txnDate);

  return payments
    .map((payment) => {
      if (!sameCalendarDay(payment.paidAt, line.txnDate)) return null;

      const remaining = Number(payment.remaining ?? payment.amount);
      if (credit > remaining + AMOUNT_TOLERANCE) return null;

      let score = 0;
      const exactPayment = Math.abs(Number(payment.amount) - credit) <= AMOUNT_TOLERANCE;
      const exactRemaining = Math.abs(remaining - credit) <= AMOUNT_TOLERANCE;

      if (exactPayment) score += 100;
      else if (exactRemaining)
        score += 90; // last split that completes the payment
      else score += 40; // partial toward a larger payment

      if (payment.accountId && payment.accountId === line.accountId) score += 40;
      else if (!payment.accountId) score += 10;

      const dayDiff = daysBetween(payment.paidAt, line.txnDate);
      if (dayDiff < 0.5) score += 50;
      else score += 35;

      const payRef = (payment.reference || '').toUpperCase().trim();
      if (bankRef && payRef && (bankRef.includes(payRef) || payRef.includes(bankRef))) {
        score += 90;
      } else if (payRef && payRef.length >= 4 && narration.includes(payRef)) {
        score += 70;
      }

      const invNo = (payment.invoiceNumber || '').toUpperCase();
      if (invNo && narration.includes(invNo)) score += 80;
      const invTail = invNo.split('/').filter(Boolean).pop();
      if (invTail && invTail.length >= 3 && narration.includes(invTail)) score += 40;

      const name = (payment.customerName || '').toUpperCase().trim();
      if (name.length >= 4) {
        const tokens = name.split(/\s+/).filter((t) => t.length >= 4);
        if (tokens.some((t) => t && narration.includes(t))) score += 30;
      }

      if (score <= 0) return null;
      return {
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoiceNumber,
        invoiceStatus: payment.invoiceStatus,
        customerName: payment.customerName,
        mode: payment.mode,
        amount: Number(payment.amount),
        remaining,
        paidAt: payment.paidAt,
        reference: payment.reference,
        score,
        bankDay,
        split: !exactPayment,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .slice(0, limit);
};

export type InvoiceBankReconcile = 'full' | 'partial' | 'none' | null;

/** Invoice-level statement cover for bankish payments (cash / old-gold ignored). */
export const invoiceBankReconcileStatus = (
  payments: { id: string; amount: unknown; mode: string }[],
  linkedByPaymentId: Map<string, number>,
): InvoiceBankReconcile => {
  const bankish = (payments || []).filter((payment) =>
    BANKISH_PAYMENT_MODES.includes(payment.mode as (typeof BANKISH_PAYMENT_MODES)[number]),
  );
  if (!bankish.length) return null;
  const due = bankish.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const linked = bankish.reduce(
    (sum, payment) => sum + (linkedByPaymentId.get(payment.id) || 0),
    0,
  );
  if (linked <= AMOUNT_TOLERANCE) return 'none';
  if (due - linked <= AMOUNT_TOLERANCE) return 'full';
  return 'partial';
};

/** Payments whose remaining capacity ≈ selectedCreditsSum (for bulk link). */
export const paymentsMatchingCreditSum = (
  creditSum: number,
  payments: PaymentCandidate[],
  txnDate: Date | string,
) =>
  payments.filter((payment) => {
    if (!sameCalendarDay(payment.paidAt, txnDate)) return false;
    const remaining = Number(payment.remaining ?? payment.amount);
    return Math.abs(remaining - creditSum) <= AMOUNT_TOLERANCE;
  });
