/**
 * Generates a printable HTML invoice from JSON data.
 * Server-side port of bill/src/lib/invoice/generateInvoiceHtml.ts
 * Browser-only helpers (printInvoice, downloadInvoiceHtml) removed.
 */
import { MakingChargesType } from '@prisma/client';
import { getInvoiceDocumentTitle } from './invoice-document-title';
import { InvoiceData } from './invoice-types';
import { formatPaymentLine } from './payment-date';

/** Purity as printed on the invoice; "-" when the item has none. */
function formatPurity(value?: string | null): string {
  const v = (value ?? '').trim();
  return !v || v.toUpperCase() === 'NONE' || v === '-' ? '-' : v;
}

export function generateInvoiceHtml(data: InvoiceData): string {
  const {
    company,
    buyer,
    metadata,
    items,
    taxes,
    hsnSummary,
    roundOff,
    totalAmount,
    amountInWords,
    taxAmountInWords,
    declaration = 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  } = data;

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      amount,
    );

  const hallmarkingCharge = data.hallmarkingCharge !== undefined ? data.hallmarkingCharge : 0;

  const itemRows = items
    .map((item) => {
      const makingChargeLabel =
        item.makingChargesType === MakingChargesType.PERCENTAGE_ON_METAL
          ? `${item.makingCharges}%`
          : item.makingChargesType === MakingChargesType.PER_GRAM
            ? `${item.makingCharges}/gm`
            : formatCurrency(item.makingCharges || 0);

      const rateDisplay =
        item.makingCharges && item.makingCharges > 0
          ? `<strong>${formatCurrency(item.rate)}</strong><br/><span class="text-sm" style="font-size:11px;">+ ${makingChargeLabel} </span>`
          : formatCurrency(item.rate);

      const purity = formatPurity(item.purityLabel || item.purity);
      const descLines = item.description.split('\n');
      const huidLine = item.huid
        ? `<br/><span class="text-sm"><strong>HUID:</strong> ${item.huid}</span>`
        : '';

      return `<tr>
      <td class="text-center">${item.slNo}</td>
      <td><strong>${descLines[0]}</strong>${descLines
        .slice(1)
        .map((l) => `<br/><span class="text-sm">${l}</span>`)
        .join('')}${huidLine}</td>
      <td class="text-center">${item.hsnSac}</td>
      <td class="text-right">${item.grossWeight ? formatCurrency(item.grossWeight) + ' GMS' : ''}</td>
      <td class="text-right">${item.netWeight ? formatCurrency(item.netWeight) + ' GMS' : ''}</td>
      <td class="text-center">${purity}</td>
      <td class="text-right">${rateDisplay}</td>
      <td class="text-right">${formatCurrency(item.amount)}</td>
    </tr>`;
    })
    .join('');

  const hsnRows = hsnSummary
    .map(
      (hsn) => `<tr>
      <td>${hsn.hsnSac}</td>
      <td class="text-right">${formatCurrency(hsn.taxableValue)}</td>
      ${
        data.taxType === 'IGST'
          ? `<td class="text-center">${hsn.igstRate}%</td>
             <td class="text-right">${formatCurrency(hsn.igstAmount || 0)}</td>`
          : `<td class="text-center">${hsn.cgstRate}%</td>
             <td class="text-right">${formatCurrency(hsn.cgstAmount)}</td>
             <td class="text-center">${hsn.sgstRate}%</td>
             <td class="text-right">${formatCurrency(hsn.sgstAmount)}</td>`
      }
      <td class="text-right">${formatCurrency(hsn.totalTaxAmount)}</td>
    </tr>`,
    )
    .join('');

  const totalTaxableValue = hsnSummary.reduce((sum, h) => sum + h.taxableValue, 0);
  const totalCgst = hsnSummary.reduce((sum, h) => sum + h.cgstAmount, 0);
  const totalSgst = hsnSummary.reduce((sum, h) => sum + h.sgstAmount, 0);
  const totalTax = hsnSummary.reduce((sum, h) => sum + h.totalTaxAmount, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${getInvoiceDocumentTitle(buyer, metadata)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; line-height: 1.4; color: #000; background: #fff; }
    .invoice-container { max-width: 800px; margin: 0 auto; padding: 20px; }
    .border { border: 1px solid #000; }
    .border-t { border-top: 1px solid #000; }
    .border-b { border-bottom: 1px solid #000; }
    .border-l { border-left: 1px solid #000; }
    .border-r { border-right: 1px solid #000; }
    table { width: 100%; border-collapse: collapse; }
    .items-table { border: 1px solid #000; }
    .items-table th { border: 1px solid #000; padding: 6px 8px; background: #f5f5f5; font-weight: bold; }
    .items-table td { border-left: 1px solid #000; border-right: 1px solid #000; padding: 4px 8px; }
    .items-table tbody tr:last-child td { border-bottom: 1px solid #000; }
    .hsn-table th, .hsn-table td { border: 1px solid #000; padding: 4px 8px; }
    .text-center { text-align: center; } .text-right { text-align: right; } .text-left { text-align: left; }
    .font-bold { font-weight: bold; } .text-sm { font-size: 11px; } .text-lg { font-size: 14px; }
    .px-2 { padding-left: 8px; padding-right: 8px; }
    .py-1 { padding-top: 4px; padding-bottom: 4px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .mb-1 { margin-bottom: 4px; } .mb-2 { margin-bottom: 8px; }
    .mantra-text { text-align: center; font-size: 10px; font-style: italic; padding: 2px 8px; }
    .logo-container { display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; border: 1px solid #000; border-bottom: none; }
    .logo-container .main-logo img { width: 60px; height: 60px; object-fit: cover; border-radius: 50%; border: 1px solid #eee; }
    .logo-container .bis-logo img { max-height: 32px; max-width: 80px; object-fit: contain; }
    .signature-area-box { text-align: center; }
    .signature-img { max-height: 90px; max-width: 180px; object-fit: contain; margin-bottom: 2px; }
    .qr-footer-box { text-align: center; }
    .qr-footer-img { max-height: 70px; max-width: 70px; object-fit: contain; }
    .header-title { text-align: center; font-size: 14px; font-weight: bold; padding: 4px; }
    .company-section { display: grid; grid-template-columns: 1fr 1fr; }
    .company-left, .company-right { border: 1px solid #000; padding: 8px; }
    .company-left { text-transform: uppercase; }
    .company-right { border-left: none; }
    .meta-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #000; }
    .meta-row:last-child { border-bottom: none; }
    .meta-cell { padding: 4px 8px; border-right: 1px solid #000; min-height: 24px; }
    .meta-cell:last-child { border-right: none; }
    .meta-label { font-size: 10px; color: #666; }
    .tax-row td { padding-top: 2px; padding-bottom: 2px; }
    .total-row { font-weight: bold; background: #f5f5f5; }
    .total-row td { border-top: 1px solid #000; border-bottom: 1px solid #000; }
    .footer-section { border: 1px solid #000; border-top: none; }
    .declaration-section { display: grid; grid-template-columns: 3fr 1fr; }
    .signature-box { text-align: right; padding: 20px 0 10px 10px; border-left: 1px solid #000; }
    .computer-generated { text-align: center; padding: 8px; font-style: italic; font-size: 11px; border-top: 1px solid #000; }
    .bank-details-box { margin-top: 8px; font-size: 11px; }
    .bank-table-std { width: auto; border-collapse: collapse; }
    .bank-table-std td { padding: 1px 0; }
    .bank-table-std .blabel { font-weight: bold; width: 100px; }
    .print-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #2563eb;
      color: white;
      padding: 12px 24px;
      border: none;
      border-radius: 30px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      transition: all 0.2s ease;
    }
    .print-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.2); background: #1d4ed8; }
    .print-btn:active { transform: translateY(0); }
    @media print { 
      body { background: white; }
      .print-btn { display: none !important; }
      .invoice-container { padding: 0; max-width: 100%; border: none; } 
      @page { margin: 10mm; size: A4; } 
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
    Save as PDF / Print
  </button>
  <div class="header-title">Tax Invoice</div>
  <div class="invoice-container">
    ${company.mantra ? `<div class="mantra-text">${company.mantra}</div>` : ''}
    ${
      company.logo || company.bisLogo
        ? `<div class="logo-container">
      <div class="main-logo">${company.logo ? `<img src="${company.logo}" alt="${company.name} Logo"/>` : ''}</div>
      <div class="bis-logo">${company.bisLogo ? `<img src="${company.bisLogo}" alt="BIS Hallmarked"/>` : ''}</div>
    </div>`
        : ''
    }
    <div class="company-section">
      <div class="company-left">
        <div class="font-bold text-lg mb-1">${company.name}</div>
        <div class="mb-1">${company.address}</div>
        <div class="mb-1">GSTIN/UIN: ${company.gstin}</div>
        <div class="mb-2">State Name: ${company.state}</div>
        <div class="font-bold mb-1">Buyer (Bill to)</div>
        <div class="font-bold">${buyer.name}</div>
        <div>${buyer.address}</div>
        ${buyer.phone ? `<div>Phn No-${buyer.phone}</div>` : ''}
        ${buyer.gstin ? `<div>GSTIN/UIN: ${buyer.gstin}</div>` : ''}
        <div>State Name: ${buyer.state}</div>
      </div>
      <div class="company-right">
        <div class="meta-row"><div class="meta-cell"><div class="meta-label">Invoice No.</div><div class="font-bold">${metadata.invoiceNo}</div></div><div class="meta-cell"><div class="meta-label">Dated</div><div class="font-bold">${metadata.date}</div></div></div>
        <div class="meta-row"><div class="meta-cell"><div class="meta-label">Delivery Note</div><div>${metadata.deliveryNote || ''}</div></div><div class="meta-cell"><div class="meta-label">Mode of Payment</div><div>${data.payments && data.payments.length ? data.payments.map((p: any) => p.mode).join(', ') : metadata.modeOfPayment || ''}</div></div></div>
        <div class="meta-row"><div class="meta-cell"><div class="meta-label">Reference No. &amp; Date</div><div>${metadata.referenceNo || ''} ${metadata.referenceDate || ''}</div></div><div class="meta-cell"><div class="meta-label">Other References</div><div></div></div></div>
        <div class="meta-row"><div class="meta-cell"><div class="meta-label">Buyer's Order No.</div><div>${metadata.buyerOrderNo || ''}</div></div><div class="meta-cell"><div class="meta-label">Dated</div><div>${metadata.buyerOrderDate || ''}</div></div></div>
        <div class="meta-row"><div class="meta-cell"><div class="meta-label">Dispatch Doc No.</div><div>${metadata.dispatchDocNo || ''}</div></div><div class="meta-cell"><div class="meta-label">Delivery Note Date</div><div>${metadata.deliveryNoteDate || ''}</div></div></div>
        <div class="meta-row"><div class="meta-cell"><div class="meta-label">Dispatched through</div><div>${metadata.dispatchedThrough || ''}</div></div><div class="meta-cell"><div class="meta-label">Destination</div><div>${metadata.destination || ''}</div></div></div>
      </div>
    </div>
    <table class="items-table">
      <thead><tr>
        <th class="text-center" style="width:35px;">Sl<br/>No.</th>
        <th class="text-left">Description of Goods</th>
        <th class="text-center" style="width:80px;">HSN/SAC</th>
        <th class="text-center" style="width:70px;">Gross<br/>Weight</th>
        <th class="text-center" style="width:70px;">Net<br/>Weight</th>
        <th class="text-center" style="width:60px;">Purity</th>
        <th class="text-center" style="width:90px;">Rate</th>
        <th class="text-right" style="width:100px;">Amount</th>
      </tr></thead>
      <tbody>
        ${itemRows}
        ${Array(Math.max(0, 2 - items.length))
          .fill(
            '<tr style="height:24px;"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>',
          )
          .join('')}
        <tr class="tax-row" style="border-top: 1px solid #000;">
          <td colspan="7" class="text-right font-bold">Taxable Value:</td>
          <td class="text-right font-bold">${formatCurrency(totalTaxableValue)}</td>
        </tr>
        ${
          hallmarkingCharge > 0
            ? `<tr class="tax-row">
          <td colspan="7" class="text-right">Hallmarking Charges:</td>
          <td class="text-right">${formatCurrency(hallmarkingCharge)}</td>
        </tr>`
            : ''
        }
        ${
          data.taxType === 'IGST'
            ? `<tr class="tax-row">
          <td colspan="7" class="text-right font-bold">IGST(${taxes.igstRate}%)</td>
          <td class="text-right">${formatCurrency(taxes.igstAmount || 0)}</td>
        </tr>`
            : `<tr class="tax-row">
          <td colspan="7" class="text-right font-bold">CGST(${taxes.cgstRate}%)</td>
          <td class="text-right">${formatCurrency(taxes.cgstAmount || 0)}</td>
        </tr>
        <tr class="tax-row">
          <td colspan="7" class="text-right font-bold">SGST(${taxes.sgstRate}%)</td>
          <td class="text-right">${formatCurrency(taxes.sgstAmount || 0)}</td>
        </tr>`
        }
        <tr class="tax-row">
          <td colspan="7" class="text-right font-bold">ROUND OFF</td>
          <td class="text-right">${roundOff >= 0 ? '' : '(-)'}${formatCurrency(Math.abs(roundOff))}</td>
        </tr>
        <tr class="total-row">
          <td colspan="7" class="text-right text-lg">Total Amount</td>
          <td class="text-right font-bold text-lg">₹${formatCurrency(totalAmount)}</td>
        </tr>
        ${
          data.payments && data.payments.length > 0
            ? data.payments
                .map(
                  (p: any) => `
        <tr class="tax-row">
          <td colspan="8" class="text-right">${formatPaymentLine(p, formatCurrency)}</td>
        </tr>`,
                )
                .join('')
            : (data.cashReceived || 0) > 0
              ? `
        <tr class="tax-row">
          <td colspan="7" class="text-right">Paid Amount</td>
          <td class="text-right">${formatCurrency(data.cashReceived || 0)}</td>
        </tr>`
              : ''
        }
        <tr class="tax-row">
          <td colspan="7" class="text-right font-bold" style="font-size: 14px;">Balance Due</td>
          <td class="text-right font-bold" style="font-size: 14px;">₹${formatCurrency(data.amtBalance || 0)}</td>
        </tr>
      </tbody>
    </table>
    <div class="border border-t-0 px-2 py-2" style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div>
        <span class="font-bold">Amount Chargeable (in words):</span>
        <span class="px-1" style="font-weight:bold;">${amountInWords}</span>
      </div>
      <span class="text-sm" style="white-space:nowrap;">E. &amp; O.E</span>
    </div>
    <table class="hsn-table">
      <thead>
        ${
          data.taxType === 'IGST'
            ? `<tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br/>Value</th><th colspan="2">IGST</th><th rowspan="2">Total<br/>Tax Amount</th></tr>
               <tr><th>Rate</th><th>Amount</th></tr>`
            : `<tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br/>Value</th><th colspan="2">CGST</th><th colspan="2">SGST/UTGST</th><th rowspan="2">Total<br/>Tax Amount</th></tr>
               <tr><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th></tr>`
        }
      </thead>
      <tbody>
        ${hsnRows}
        <tr class="total-row">
          <td class="text-right">Total</td>
          <td class="text-right">${formatCurrency(totalTaxableValue)}</td>
          ${
            data.taxType === 'IGST'
              ? `<td></td><td class="text-right">${formatCurrency(taxes.igstAmount || 0)}</td>`
              : `<td></td><td class="text-right">${formatCurrency(totalCgst)}</td><td></td><td class="text-right">${formatCurrency(totalSgst)}</td>`
          }
          <td class="text-right">${formatCurrency(totalTax)}</td>
        </tr>
      </tbody>
    </table>
    <div class="border border-t-0 px-2 py-1">Tax Amount (in words) : <strong>${taxAmountInWords}</strong></div>
    <div class="footer-section declaration-section">
      <div class="px-2 py-2">
        <div class="font-bold mb-1">Declaration</div>
        <div class="text-sm">${declaration}</div>
        ${
          company.bankDetails || company.qrCode
            ? `
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8px;">
          ${
            company.bankDetails
              ? `
          <div class="bank-details-box" style="margin-top: 0;">
            <div class="font-bold mb-1" style="font-size: 12px;">Bank Details</div>
            <table class="bank-table-std">
              <tr><td class="blabel">Bank Name</td><td>: ${company.bankDetails.bankName}</td></tr>
              <tr><td class="blabel">A/c No.</td><td>: ${company.bankDetails.accountNumber}</td></tr>
              <tr><td class="blabel">IFSC Code</td><td>: ${company.bankDetails.ifsc}</td></tr>
            </table>
          </div>`
              : '<div></div>'
          }
          ${
            company.qrCode
              ? `
          <div class="qr-footer-box" style="margin-left: 20px;">
            <div style="font-size: 8px; font-weight: bold; margin-bottom: 2px;">SCAN TO PAY</div>
            <img src="${company.qrCode}" class="qr-footer-img" alt="Payment QR"/>
          </div>`
              : ''
          }
        </div>`
            : ''
        }
      </div>
      <div class="signature-box" style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; padding: 10px; min-height: 140px;">
  
  <div style="width: 100%; text-align: right; margin-bottom: 10px;">
    for ${company.name}
  </div>

  <div class="signature-area-box" style="display: flex; flex-direction: column; justify-content: center; align-items: center; flex: 1; width: 100%;">
    
    ${
      company.signature
        ? `<img src="${company.signature}" class="signature-img" alt="Authorized Signature" style="display:block; margin-bottom:5px;"/>`
        : '<div style="height:50px;"></div>'
    }
    
    <div style="font-size: 11px; font-weight: bold; border-top: 1px dashed #ccc; padding-top: 5px; width: 85%; text-align: center;">
      Authorised Signatory
    </div>

  </div>
</div>
    </div>
  </div>
</body>
</html>`.trim();
}
