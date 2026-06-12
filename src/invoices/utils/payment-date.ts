export const formatPaymentDate = (value?: string | Date): string => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
};

export const formatPaymentLine = (
  payment: { mode: string; amount: number; paidAt?: string | Date },
  formatAmount: (amount: number) => string,
): string =>
  `${payment.mode}: ₹${formatAmount(payment.amount || 0)}${payment.paidAt ? ` · ${formatPaymentDate(payment.paidAt)}` : ''}`;
