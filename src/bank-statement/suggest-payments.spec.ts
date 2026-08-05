import { suggestPaymentsForCredit } from './suggest-payments';

describe('suggestPaymentsForCredit', () => {
  const line = {
    credit: 10000,
    narration: 'UPI/ARYAN SONI/INV-12/UTR123456',
    refNumber: 'UTR123456',
    txnDate: '2026-07-20',
    accountId: 'bank-1',
  };

  const base = {
    id: 'pay-1',
    amount: 10000,
    mode: 'UPI',
    reference: 'UTR123456',
    paidAt: '2026-07-20',
    accountId: 'bank-1',
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-12',
    invoiceStatus: 'PAID',
    customerName: 'Aryan Soni',
  };

  it('ranks an exact paid invoice payment first', () => {
    const suggestions = suggestPaymentsForCredit(line, [
      { ...base, id: 'pay-weak', amount: 10000, reference: null, customerName: 'Other', invoiceNumber: 'ZZ-9', accountId: null, paidAt: '2026-07-25' },
      base,
    ]);
    expect(suggestions[0]?.paymentId).toBe('pay-1');
    expect(suggestions[0]?.invoiceStatus).toBe('PAID');
  });

  it('rejects amount mismatches beyond ₹1', () => {
    const suggestions = suggestPaymentsForCredit(line, [
      { ...base, id: 'pay-off', amount: 9500 },
    ]);
    expect(suggestions).toHaveLength(0);
  });
});
