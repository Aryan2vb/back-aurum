import {
  indexPaymentsByCalendarDay,
  paymentsMatchingCreditSum,
  suggestPaymentsForCredit,
} from './suggest-payments';

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
    remaining: 10000,
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
      {
        ...base,
        id: 'pay-weak',
        amount: 10000,
        remaining: 10000,
        reference: null,
        customerName: 'Other',
        invoiceNumber: 'ZZ-9',
        accountId: null,
        paidAt: '2026-07-20',
      },
      base,
    ]);
    expect(suggestions[0]?.paymentId).toBe('pay-1');
    expect(suggestions[0]?.invoiceStatus).toBe('PAID');
  });

  it('only suggests payments on the same calendar day as the bank credit', () => {
    const suggestions = suggestPaymentsForCredit(line, [
      { ...base, id: 'pay-other-day', paidAt: '2026-07-21' },
      base,
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.paymentId).toBe('pay-1');
  });

  it('suggests a larger booked payment for a split credit', () => {
    const suggestions = suggestPaymentsForCredit(line, [
      {
        ...base,
        id: 'pay-50k',
        amount: 50000,
        remaining: 50000,
        reference: null,
      },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.paymentId).toBe('pay-50k');
    expect(suggestions[0]?.split).toBe(true);
    expect(suggestions[0]?.remaining).toBe(50000);
  });

  it('rejects credits larger than remaining capacity', () => {
    const suggestions = suggestPaymentsForCredit(line, [
      { ...base, id: 'pay-partial', amount: 50000, remaining: 5000 },
    ]);
    expect(suggestions).toHaveLength(0);
  });

  it('rejects amount mismatches beyond ₹1 for exact-size payments', () => {
    const suggestions = suggestPaymentsForCredit(line, [
      { ...base, id: 'pay-off', amount: 9500, remaining: 9500 },
    ]);
    // 10k credit vs 9.5k remaining → no fit
    expect(suggestions).toHaveLength(0);
  });
});

describe('paymentsMatchingCreditSum', () => {
  it('finds a ₹50k payment for 10+20+5+15 same-day credits', () => {
    const payment = {
      id: 'pay-50',
      amount: 50000,
      remaining: 50000,
      mode: 'UPI',
      reference: null,
      paidAt: '2026-07-20',
      accountId: 'bank-1',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-1',
      invoiceStatus: 'PAID',
      customerName: 'Aryan',
    };
    const matches = paymentsMatchingCreditSum(50000, [payment], '2026-07-20');
    expect(matches).toHaveLength(1);
  });
});

describe('indexPaymentsByCalendarDay', () => {
  it('buckets payments so scoring can skip other days', () => {
    const pay = (id, paidAt) => ({
      id,
      amount: 1,
      remaining: 1,
      mode: 'UPI',
      reference: null,
      paidAt,
      accountId: 'bank-1',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-1',
      invoiceStatus: 'PAID',
      customerName: 'Aryan',
    });
    const byDay = indexPaymentsByCalendarDay([
      pay('a', '2026-07-20'),
      pay('b', '2026-07-21T08:00:00.000Z'),
      pay('c', '2026-07-20T12:00:00.000Z'),
    ]);
    expect([...byDay.keys()].sort()).toEqual(['2026-07-20', '2026-07-21']);
    expect(byDay.get('2026-07-20')?.map((p) => p.id)).toEqual(['a', 'c']);
  });
});
