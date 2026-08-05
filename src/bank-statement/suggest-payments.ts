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

const AMOUNT_TOLERANCE = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

const daysBetween = (a: Date | string, b: Date | string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;

/**
 * Score existing invoice payments against a bank credit for month-end reconcile.
 * Does not create payments — staff confirms a link.
 */
export const suggestPaymentsForCredit = (
  line: StatementCredit,
  payments: PaymentCandidate[],
  limit = 5,
) => {
  const credit = Number(line.credit);
  const narration = (line.narration || '').toUpperCase();
  const bankRef = (line.refNumber || '').toUpperCase().trim();

  return payments
    .map((payment) => {
      let score = 0;
      const amountDiff = Math.abs(Number(payment.amount) - credit);
      if (amountDiff > AMOUNT_TOLERANCE) return null;
      score += 100 - amountDiff;

      if (payment.accountId && payment.accountId === line.accountId) score += 40;
      else if (!payment.accountId) score += 10;

      const dayDiff = daysBetween(payment.paidAt, line.txnDate);
      if (dayDiff <= 1) score += 50;
      else if (dayDiff <= 3) score += 35;
      else if (dayDiff <= 7) score += 20;
      else if (dayDiff > 31) score -= 20;

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
        if (tokens.some((t) => narration.includes(t))) score += 30;
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
        paidAt: payment.paidAt,
        reference: payment.reference,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .slice(0, limit);
};
