import {
  fingerprintHdfcRow,
  inferPaymentMethodFromNarration,
  normalizeHdfcRef,
  parseHdfcAmount,
  parseHdfcDate,
  parseHdfcDelimited,
} from './hdfc-statement.parser';

const SAMPLE = `
  Date     ,Narration                                                                                                                ,Value Dat,Debit Amount       ,Credit Amount      ,Chq/Ref Number   ,Closing Balance
 03/07/26  ,UPI-DOMINOS PIZZA-PAYTM-51955531@PTYS-YESB0PTMUPI-125696538778-UPI                                                       ,03/07/26 ,        225.76     ,          0.00     ,0000125696538778       ,      3457.47  
 04/07/26  ,UPI-DIVYANI SONI-DIVYANIS1408-1@OKICICI-HDFC0006102-618521556072-UPI                                                     ,04/07/26 ,          0.00     ,       2000.00     ,0000618521556072       ,      4481.71  
 06/07/26  ,NEFT CR-UTIB0001920-CASHFREE PAYMENTS INDIA PRIVATE LIMITED-ARYAN SONI-AXISCN1397974004                                  ,06/07/26 ,          0.00     ,          1.00     ,AXISCN1397974004       ,       432.71  
 06/07/26  ,APY28335152_072026_510080742807_INSTALLM                                                                                 ,04/07/26 ,         50.00     ,          0.00     ,000000000000000        ,       431.71  
`.replace(/\n/g, '\r\n');

describe('parseHdfcDelimited', () => {
  it('extracts credit and debit columns from HDFC delimited export', () => {
    const rows = parseHdfcDelimited(SAMPLE);
    expect(rows).toHaveLength(4);

    expect(rows[0]).toMatchObject({
      debit: 225.76,
      credit: 0,
      narration: expect.stringContaining('DOMINOS'),
      refNumber: '125696538778',
    });
    expect(rows[0].txnDate.toISOString().slice(0, 10)).toBe('2026-07-03');

    expect(rows[1]).toMatchObject({
      debit: 0,
      credit: 2000,
      refNumber: '618521556072',
    });

    expect(rows[2]).toMatchObject({
      debit: 0,
      credit: 1,
      refNumber: 'AXISCN1397974004',
    });
    expect(inferPaymentMethodFromNarration(rows[2].narration)).toBe('NEFT');

    expect(rows[3]).toMatchObject({
      debit: 50,
      credit: 0,
      refNumber: null,
    });
  });

  it('rejoins narration commas instead of treating them as extra columns', () => {
    const text = `Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
20/07/26,UPI-FOO, BAR, BAZ-PAY,20/07/26,0.00,100.00,REF123,500.00`;
    const [row] = parseHdfcDelimited(text);
    expect(row.narration).toBe('UPI-FOO, BAR, BAZ-PAY');
    expect(row.credit).toBe(100);
    expect(row.refNumber).toBe('REF123');
  });

  it('keeps comma narration intact when the export has no closing balance column', () => {
    const text = `Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number
20/07/26,UPI-FOO, BAR, BAZ-PAY,20/07/26,0.00,100.00,REF123`;
    const [row] = parseHdfcDelimited(text);
    expect(row.narration).toBe('UPI-FOO, BAR, BAZ-PAY');
    expect(row.credit).toBe(100);
    expect(row.refNumber).toBe('REF123');
    expect(row.closingBalance).toBeNull();
  });

  it('keeps comma-split reference numbers together when the export has a header', () => {
    const text = `Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
06/07/26,NEFT CR-UTIB0001920-CASHFREE,06/07/26,0.00,1.00,AXISCN,1397974004,432.71`;
    const [row] = parseHdfcDelimited(text);
    expect(row).toMatchObject({
      debit: 0,
      credit: 1,
      narration: 'NEFT CR-UTIB0001920-CASHFREE',
      refNumber: 'AXISCN,1397974004',
      closingBalance: 432.71,
    });
  });

  it('builds stable fingerprints for dedupe', () => {
    const [a] = parseHdfcDelimited(SAMPLE);
    const again = fingerprintHdfcRow(a);
    expect(again).toBe(a.fingerprint);
    expect(a.fingerprint).toHaveLength(64);
  });

  it('keeps repeated identical transactions distinct without moving the first fingerprint', () => {
    const row = '20/07/26,UPI-FOO-PAY,20/07/26,0.00,100.00,REF123,500.00';
    const [single] =
      parseHdfcDelimited(`Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
${row}`);
    const rows =
      parseHdfcDelimited(`Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
${row}
${row}`);
    expect(rows).toHaveLength(2);
    expect(rows[0].fingerprint).toBe(single.fingerprint);
    expect(rows[1].fingerprint).not.toBe(rows[0].fingerprint);
  });

  it('parses headerless four-column rows by amount positions', () => {
    const rows = parseHdfcDelimited(
      '03/07/26,UPI-DOMINOS PIZZA,03/07/26,225.76,0.00,0000125696538778,3457.47',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      debit: 225.76,
      credit: 0,
      refNumber: '125696538778',
      closingBalance: 3457.47,
    });
  });

  it('parses headerless three-column rows without treating ref as closing balance', () => {
    const rows = parseHdfcDelimited(
      '03/07/26,UPI-DOMINOS PIZZA,03/07/26,225.76,0.00,0000125696538778',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      debit: 225.76,
      credit: 0,
      refNumber: '125696538778',
      closingBalance: null,
    });
  });

  it('keeps comma-split reference numbers together on headerless rows', () => {
    const rows = parseHdfcDelimited(
      '06/07/26,NEFT CR-UTIB0001920-CASHFREE,06/07/26,0.00,1.00,AXISCN,1397974004,432.71',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      debit: 0,
      credit: 1,
      refNumber: 'AXISCN,1397974004',
      closingBalance: 432.71,
    });
  });
});

describe('hdfc helpers', () => {
  it('parses amounts and dates', () => {
    expect(parseHdfcAmount('  1,200.50  ')).toBe(1200.5);
    expect(parseHdfcDate('04/07/26')?.toISOString().slice(0, 10)).toBe('2026-07-04');
    expect(parseHdfcDate('31/02/26')).toBeNull();
    expect(normalizeHdfcRef('0000125696538778')).toBe('125696538778');
    expect(normalizeHdfcRef('000000000000000')).toBeNull();
  });
});
