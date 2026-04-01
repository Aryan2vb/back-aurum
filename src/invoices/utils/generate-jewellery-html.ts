/**
 * Generates the jewellery-specific invoice template.
 * Server-side port of bill/src/lib/invoice/generateJewelleryHtml.ts
 */
import { InvoiceData } from './invoice-types';

export function generateJewelleryInvoiceHtml(data: InvoiceData): string {
    const {
        company,
        buyer,
        metadata,
        items,
        taxes,
        roundOff,
        totalAmount,
        amountInWords,
        declaration,
    } = data;

    const fmt = (n: number) =>
        new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const cashReceived = data.cashReceived !== undefined ? data.cashReceived : totalAmount;
    const amtBalance = data.amtBalance !== undefined ? data.amtBalance : 0;

    const itemRows = items.map(item => `
        <tr>
            <td>${item.description.split('\\n')[0].replace(/GOLD JEWELLERY-\d+\n?/i, '').trim() || item.description.split('\n').pop()}</td>
            <td class="ctr">${item.quantity}</td>
            <td class="ctr">${item.hsnSac}</td>
            <td class="ctr">${item.grossWeight ? fmt(item.grossWeight) + ' GM' : item.quantity + ' ' + item.unit}</td>
            <td class="ctr">${item.purity || '-'}</td>
            <td class="rgt">${fmt(item.rate)}</td>
            <td class="rgt">${item.makingCharges ? fmt(item.makingCharges) : '-'}</td>
            <td class="rgt">${item.huid ? '45.00' : '-'}</td>
            <td class="rgt">${fmt(item.amount)}</td>
        </tr>`).join('');

    const emptyRows = Array(Math.max(0, 6 - items.length))
        .fill('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>')
        .join('');

    const termsDefault = `1. All disputes are subject to REWA Jurisdiction Only.
2. Interest @18% p.a. will be charged if the payment is not paid within 30 days.
3. I have checked the ornaments mentioned above and I am satisfied with the quality, rates, designs and specifications, thereof which are in perfect and acceptable condition and in taken thereof I have appended my signature here.
4. Making Charges & GST are not refundable in case of changing/exchanging of jewellery.
5. Choose wisely & purchase only if it satisfies you.`;

    const terms = declaration || termsDefault;

    const coAny = company as any;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tax Invoice - ${metadata.invoiceNo}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #000; background: #fff; }
        .invoice { max-width: 800px; margin: 0 auto; padding: 20px; border: 2px solid #000; }
        .header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid #000; }
        .header-left { display: flex; align-items: flex-start; gap: 12px; }
        .logo-circle { width: 60px; height: 60px; border: 2px solid #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: serif; font-size: 28px; font-weight: bold; flex-shrink: 0; }
        .header-center { text-align: center; flex: 1; }
        .mantra { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
        .company-name { font-size: 20px; font-weight: bold; margin-bottom: 2px; }
        .company-addr { font-size: 11px; color: #333; }
        .company-phone { font-size: 11px; font-weight: bold; }
        .header-right { text-align: right; flex-shrink: 0; }
        .scan-text { font-size: 10px; font-weight: bold; margin-bottom: 2px; }
        .qr-placeholder { width: 70px; height: 70px; border: 1px solid #ccc; display: inline-block; background: #f9f9f9; }
        .tax-title { text-align: center; font-size: 16px; font-weight: bold; color: #c00; padding: 6px 0; border-bottom: 2px solid #c00; margin-bottom: 8px; }
        .buyer-meta { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #000; margin-bottom: 8px; }
        .buyer-info { font-size: 12px; }
        .meta-info { text-align: right; font-size: 12px; }
        .meta-info div { margin-bottom: 1px; }
        .items-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
        .items-table th { background: #f0f0f0; border: 1px solid #000; padding: 6px 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
        .items-table td { border-left: 1px solid #000; border-right: 1px solid #000; padding: 5px 4px; font-size: 11px; vertical-align: top; }
        .items-table tbody tr:last-child td { border-bottom: 1px solid #000; }
        .ctr { text-align: center; } .rgt { text-align: right; } .lft { text-align: left; }
        .totals-section { border: 1px solid #000; border-top: none; }
        .totals-row { display: flex; justify-content: flex-end; padding: 2px 10px; font-size: 12px; }
        .totals-row .label { font-weight: bold; min-width: 140px; text-align: right; margin-right: 10px; }
        .totals-row .value { min-width: 100px; text-align: right; font-weight: bold; }
        .totals-divider { border-top: 1px solid #000; margin: 0; }
        .cash-section { display: flex; justify-content: space-between; padding: 6px 10px; border: 1px solid #000; border-top: none; font-size: 12px; font-weight: bold; }
        .balance-row { text-align: right; padding: 2px 10px; font-size: 12px; font-weight: bold; border: 1px solid #000; border-top: none; }
        .dr-text { color: #c00; }
        .payable-section { border: 1px solid #000; border-top: none; padding: 8px 10px; }
        .payable-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
        .payable-label { font-weight: bold; font-size: 12px; }
        .payable-words { font-size: 12px; font-weight: bold; }
        .bank-details { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .bank-table { font-size: 11px; }
        .bank-table td { padding: 1px 4px; vertical-align: top; }
        .bank-table .blabel { font-weight: bold; white-space: nowrap; }
        .terms-section { border: 1px solid #000; border-top: none; padding: 10px; }
        .terms-title { font-weight: bold; font-size: 12px; margin-bottom: 4px; }
        .terms-text { font-size: 10px; line-height: 1.5; white-space: pre-line; }
        .signature-section { display: flex; justify-content: space-between; padding: 40px 10px 10px; border: 1px solid #000; border-top: none; }
        .sig-label { font-weight: bold; font-size: 12px; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } .invoice { padding: 10px; max-width: 100%; border-width: 1px; } @page { margin: 8mm; size: A4; } }
    </style>
</head>
<body>
    <div class="invoice">
        <div class="header">
            <div class="header-left"><div class="logo-circle">${company.name.slice(0, 2).toUpperCase()}</div></div>
            <div class="header-center">
                <div class="mantra">${coAny.mantra || 'ॐ भूर्भुवः स्वः'}</div>
                <div class="company-name">${company.name}</div>
                <div class="company-addr">${company.address}</div>
                <div class="company-phone">PHONE : ${coAny.phone || ''}</div>
            </div>
            <div class="header-right">
                <div class="scan-text">Scan this</div>
                <div class="qr-placeholder"></div>
            </div>
        </div>
        <div class="tax-title">TAX INVOICE</div>
        <div class="buyer-meta">
            <div class="buyer-info">
                <div><strong>NAME &nbsp; : &nbsp; ${buyer.name}</strong></div>
                <div><strong>ADDRESS : </strong> ${buyer.address}</div>
                ${buyer.state ? `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${buyer.state}</div>` : ''}
            </div>
            <div class="meta-info">
                <div><strong>INVOICE NO:</strong> ${metadata.invoiceNo}</div>
                <div><strong>DATE:</strong> ${metadata.date}</div>
                <div><strong>GSTIN :</strong> ${company.gstin}</div>
            </div>
        </div>
        <table class="items-table">
            <thead><tr>
                <th class="lft" style="width:120px;">PROD DESC</th>
                <th style="width:40px;">QTY</th>
                <th style="width:70px;">HSN</th>
                <th style="width:85px;">GS WT</th>
                <th style="width:60px;">PURITY</th>
                <th style="width:80px;">RATE</th>
                <th style="width:65px;">MKG</th>
                <th style="width:50px;">HMC</th>
                <th style="width:100px;">FINAL AMT</th>
            </tr></thead>
            <tbody>${itemRows}${emptyRows}</tbody>
        </table>
        <div class="totals-section">
            <div class="totals-row" style="padding-top:6px;"><span class="label">AMT :</span><span class="value">${fmt(subtotal)}</span></div>
            <div class="totals-row"><span class="label">CGST (${taxes.cgstRate}%) :</span><span class="value">${fmt(taxes.cgstAmount)}</span></div>
            <div class="totals-row"><span class="label">SGST (${taxes.sgstRate}%) :</span><span class="value">${fmt(taxes.sgstAmount)}</span></div>
            ${taxes.igstRate && taxes.igstRate > 0 ? `<div class="totals-row"><span class="label">IGST (${taxes.igstRate}%) :</span><span class="value">${fmt(taxes.igstAmount || 0)}</span></div>` : ''}
            <div class="totals-row"><span class="label">ROUND OFF :</span><span class="value">${roundOff >= 0 ? '+ ' : '- '}${fmt(Math.abs(roundOff))}</span></div>
            <div class="totals-divider"></div>
            <div class="totals-row" style="padding:4px 10px;font-size:13px;"><span class="label">TOTAL AMOUNT :</span><span class="value">${fmt(totalAmount)}</span></div>
        </div>
        <div class="cash-section">
            <div>CASH RECEIVED : &nbsp; ${fmt(cashReceived)}</div>
            <div>NET RECEIVABLE AMT : ${fmt(totalAmount)}</div>
        </div>
        <div class="balance-row">AMT BALANCE: ${fmt(Math.abs(amtBalance))} <span class="dr-text">${amtBalance >= 0 ? 'DR' : 'CR'}</span></div>
        <div class="payable-section">
            <div class="payable-row">
                <div class="payable-label">PAYABLE AMOUNT :</div>
                <div class="payable-words">${amountInWords}</div>
            </div>
            <div class="bank-details">
                <table class="bank-table">
                    <tr><td class="blabel">Bank Name</td><td>: ${coAny.bankDetails?.bankName || ''} ${coAny.bankDetails?.branch || ''}</td></tr>
                    <tr><td class="blabel">Bank Acc No</td><td>: ${coAny.bankDetails?.accountNumber || ''}</td></tr>
                    <tr><td class="blabel">Bank IFSC No</td><td>: ${coAny.bankDetails?.ifsc || ''}</td></tr>
                </table>
                <div style="text-align:center;">
                    <div style="font-size:10px;font-weight:bold;">SCAN QR CODE</div>
                    <div class="qr-placeholder" style="width:80px;height:80px;"></div>
                </div>
            </div>
        </div>
        <div class="terms-section">
            <div class="terms-title">Terms and Conditions :</div>
            <div class="terms-text">${terms}</div>
        </div>
        <div class="signature-section">
            <div class="sig-label">Customer Signatory</div>
            <div class="sig-label">Authorized Signatory</div>
        </div>
    </div>
</body>
</html>`.trim();
}
