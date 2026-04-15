import { InvoiceData } from './invoice-types';

/**
 * Generates a modern/clean themed HTML invoice
 */
export function generateModernInvoiceHtml(data: InvoiceData): string {
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

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      n,
    );

  const totalTaxableValue = hsnSummary.reduce((s, h) => s + h.taxableValue, 0);
  const totalCgst = hsnSummary.reduce((s, h) => s + h.cgstAmount, 0);
  const totalSgst = hsnSummary.reduce((s, h) => s + h.sgstAmount, 0);
  const totalTax = hsnSummary.reduce((s, h) => s + h.totalTaxAmount, 0);

  const itemRows = items
    .map(
      (item) => `
        <tr>
            <td style="text-align:center;padding:10px 8px;border-bottom:1px solid #eee;">${item.slNo}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #eee;font-weight:500;">${item.description}</td>
            <td style="text-align:center;padding:10px 8px;border-bottom:1px solid #eee;color:#666;">${item.hsnSac}</td>
            <td style="text-align:center;padding:10px 8px;border-bottom:1px solid #eee;">${item.quantity} ${item.unit}</td>
            <td style="text-align:right;padding:10px 8px;border-bottom:1px solid #eee;">₹${fmt(item.rate)}</td>
            <td style="text-align:right;padding:10px 8px;border-bottom:1px solid #eee;font-weight:600;">₹${fmt(item.amount)}</td>
        </tr>
    `,
    )
    .join('');

  const hsnRows = hsnSummary
    .map(
      (h) => `
        <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;">${h.hsnSac}</td>
            <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #eee;">₹${fmt(h.taxableValue)}</td>
            ${
              data.taxType === 'IGST'
                ? `<td style="text-align:center;padding:6px 10px;border-bottom:1px solid #eee;">${h.igstRate}%</td>
                   <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #eee;">₹${fmt(h.igstAmount || 0)}</td>`
                : `<td style="text-align:center;padding:6px 10px;border-bottom:1px solid #eee;">${h.cgstRate}%</td>
                   <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #eee;">₹${fmt(h.cgstAmount)}</td>
                   <td style="text-align:center;padding:6px 10px;border-bottom:1px solid #eee;">${h.sgstRate}%</td>
                   <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #eee;">₹${fmt(h.sgstAmount)}</td>`
            }
            <td style="text-align:right;padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">₹${fmt(h.totalTaxAmount)}</td>
        </tr>
    `,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${metadata.invoiceNo}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; }
        .invoice { max-width: 800px; margin: 0 auto; padding: 40px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 3px solid #2563eb; }
        .company-name { font-size: 22px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
        .company-info { color: #64748b; font-size: 12px; line-height: 1.6; }
        .invoice-badge { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; padding: 8px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 1px; }
        .invoice-meta { text-align: right; margin-top: 8px; }
        .invoice-meta div { font-size: 12px; color: #64748b; margin-top: 3px; }
        .invoice-meta strong { color: #1e293b; }
        .section { margin-bottom: 24px; }
        .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: #2563eb; margin-bottom: 10px; }
        .buyer-card { background: #f8fafc; border-radius: 8px; padding: 16px; border: 1px solid #e2e8f0; }
        .buyer-name { font-size: 15px; font-weight: 600; color: #1e293b; margin-bottom: 4px; }
        .buyer-info { font-size: 12px; color: #64748b; line-height: 1.6; }
        .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .meta-item { background: #f8fafc; border-radius: 6px; padding: 8px 12px; border: 1px solid #e2e8f0; }
        .meta-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .meta-value { font-size: 12px; font-weight: 500; color: #1e293b; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; }
        .items-table th { background: #f1f5f9; padding: 10px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border-bottom: 2px solid #e2e8f0; }
        .subtotal-section { background: #f8fafc; border-radius: 8px; padding: 16px; margin-top: 16px; }
        .subtotal-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: #475569; }
        .total-row-modern { display: flex; justify-content: space-between; padding: 12px 0 4px; font-size: 18px; font-weight: 700; color: #1e293b; border-top: 2px solid #e2e8f0; margin-top: 8px; }
        .words-box { background: #eff6ff; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #1e40ad; margin-top: 12px; border-left: 3px solid #2563eb; }
        .hsn-section { margin-top: 24px; }
        .hsn-table th { background: #f1f5f9; padding: 8px 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border-bottom: 2px solid #e2e8f0; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
        .declaration-text { font-size: 11px; color: #64748b; line-height: 1.6; }
        .signature-area { text-align: right; }
        .signature-img { max-height: 50px; max-width: 150px; object-fit: contain; margin-bottom: 4px; display: block; margin-left: auto; }
        .bank-details-modern { margin-top: 16px; font-size: 11px; color: #475569; }
        .bank-table-modern { width: auto; border-collapse: collapse; }
        .bank-table-modern td { padding: 2px 0; }
        .bank-table-modern .blabel { font-weight: 600; width: 110px; color: #64748b; }
        .signature-line { border-top: 1px solid #cbd5e1; margin-top: 4px; padding-top: 8px; font-size: 12px; color: #475569; }
        .qr-area { text-align: center; margin-top: 10px; }
        .qr-img { max-height: 80px; max-width: 80px; object-fit: contain; }
        .logo-img { width: 85px; height: 85px; object-fit: cover; border-radius: 50%; border: 1px solid #e2e8f0; margin-bottom: 12px; display: block; }
        .bis-logo-img { max-height: 40px; max-width: 80px; object-fit: contain; vertical-align: middle; margin-left: 12px; }
        .bottom-note { text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; font-style: italic; }
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
            .invoice { padding: 0; max-width: 100%; }
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
    <div class="invoice">
        <!-- Header -->
        <div class="header">
            <div>
            <div style="display: flex; align-items: center; margin-bottom: 12px;">
                ${company.logo ? `<img src="${company.logo}" class="logo-img" alt="Logo"/>` : ''}
                ${company.bisLogo ? `<img src="${company.bisLogo}" class="bis-logo-img" alt="BIS Logo"/>` : ''}
            </div>
                <div class="company-name">${company.name}</div>
                <div class="company-info">
                    ${company.address}<br>
                    GSTIN: ${company.gstin}<br>
                    State: ${company.state} (${company.stateCode})
                </div>
            </div>
            <div>
                <div class="invoice-badge">TAX INVOICE</div>
                <div class="invoice-meta">
                    <div><strong>${metadata.invoiceNo}</strong></div>
                    <div>Date: <strong>${metadata.date}</strong></div>
                    ${data.payments && data.payments.length ? `<div>Payment: ${data.payments.map((p: any) => p.mode).join(', ')}</div>` : metadata.modeOfPayment ? `<div>Payment: ${metadata.modeOfPayment}</div>` : ''}
                </div>
            </div>
        </div>

        <!-- Buyer + Meta -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
            <div class="section">
                <div class="section-title">Bill To</div>
                <div class="buyer-card">
                    <div class="buyer-name">${buyer.name}</div>
                    <div class="buyer-info">
                        ${buyer.address}<br>
                        ${buyer.phone ? `Phone: ${buyer.phone}<br>` : ''}
                        State: ${buyer.state} (${buyer.stateCode})
                    </div>
                </div>
            </div>
            <div class="section">
                <div class="section-title">Details</div>
                <div class="meta-grid" style="grid-template-columns:1fr 1fr;">
                    ${metadata.referenceNo ? `<div class="meta-item"><div class="meta-label">Ref No.</div><div class="meta-value">${metadata.referenceNo}</div></div>` : ''}
                    ${metadata.buyerOrderNo ? `<div class="meta-item"><div class="meta-label">Buyer Order</div><div class="meta-value">${metadata.buyerOrderNo}</div></div>` : ''}
                    ${metadata.dispatchedThrough ? `<div class="meta-item"><div class="meta-label">Dispatch</div><div class="meta-value">${metadata.dispatchedThrough}</div></div>` : ''}
                    ${metadata.destination ? `<div class="meta-item"><div class="meta-label">Destination</div><div class="meta-value">${metadata.destination}</div></div>` : ''}
                    ${metadata.termsOfDelivery ? `<div class="meta-item" style="grid-column:span 2;"><div class="meta-label">Terms</div><div class="meta-value">${metadata.termsOfDelivery}</div></div>` : ''}
                </div>
            </div>
        </div>

        <!-- Items Table -->
        <div class="section">
            <div class="section-title">Items</div>
            <table class="items-table">
                <thead>
                    <tr>
                        <th style="text-align:center;width:40px;">#</th>
                        <th style="text-align:left;">Description</th>
                        <th style="text-align:center;width:90px;">HSN/SAC</th>
                        <th style="text-align:center;width:80px;">Qty</th>
                        <th style="text-align:right;width:90px;">Rate</th>
                        <th style="text-align:right;width:100px;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRows}
                </tbody>
            </table>

            <!-- Subtotal -->
            <div class="subtotal-section">
                <div class="subtotal-row"><span>Subtotal</span><span>₹${fmt(totalTaxableValue)}</span></div>
                ${
                  data.taxType === 'IGST'
                    ? `<div class="subtotal-row"><span>IGST @ ${taxes.igstRate}%</span><span>₹${fmt(taxes.igstAmount || 0)}</span></div>`
                    : `<div class="subtotal-row"><span>CGST @ ${taxes.cgstRate}%</span><span>₹${fmt(taxes.cgstAmount)}</span></div>
                <div class="subtotal-row"><span>SGST @ ${taxes.sgstRate}%</span><span>₹${fmt(taxes.sgstAmount)}</span></div>`
                }
                ${roundOff !== 0 ? `<div class="subtotal-row"><span>Round Off</span><span>${roundOff >= 0 ? '' : '(-)'}₹${fmt(Math.abs(roundOff))}</span></div>` : ''}
                <div class="total-row-modern"><span>Total</span><span>₹${fmt(totalAmount)}</span></div>
                ${
                  data.payments && data.payments.length > 0
                    ? data.payments
                        .map(
                          (p: any) => `
                <div class="subtotal-row" style="margin-top:4px;">
                  <span style="font-size:11px;color:#64748b;">${p.mode} Received</span>
                  <span style="font-size:11px;color:#64748b;font-weight:600;">₹${fmt(Number(p.amount))}</span>
                </div>`,
                        )
                        .join('')
                    : (data.cashReceived || 0) > 0
                      ? `<div class="subtotal-row" style="margin-top:4px;">
                  <span style="font-size:11px;color:#64748b;">Paid Amount</span>
                  <span style="font-size:11px;color:#64748b;font-weight:600;">₹${fmt(data.cashReceived || 0)}</span>
                </div>`
                      : ''
                }
                <div class="subtotal-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;">
                    <span style="font-weight:700;color:#2563eb;">Balance Due</span>
                    <span style="font-weight:700;color:#2563eb;">₹${fmt(data.amtBalance || 0)}</span>
                </div>
            </div>

            <div class="words-box">
                <strong>Amount in words:</strong> ${amountInWords}
            </div>
        </div>

        <!-- HSN Summary -->
        <div class="hsn-section">
            <div class="section-title">HSN/SAC Summary</div>
            <table class="hsn-table">
                <thead>
                    ${
                      data.taxType === 'IGST'
                        ? `<tr>
                        <th style="text-align:left;">HSN/SAC</th>
                        <th style="text-align:right;">Taxable Value</th>
                        <th style="text-align:center;">IGST Rate</th>
                        <th style="text-align:right;">IGST Amt</th>
                        <th style="text-align:right;">Total Tax</th>
                    </tr>`
                        : `<tr>
                        <th style="text-align:left;">HSN/SAC</th>
                        <th style="text-align:right;">Taxable Value</th>
                        <th style="text-align:center;">CGST Rate</th>
                        <th style="text-align:right;">CGST Amt</th>
                        <th style="text-align:center;">SGST Rate</th>
                        <th style="text-align:right;">SGST Amt</th>
                        <th style="text-align:right;">Total Tax</th>
                    </tr>`
                    }
                </thead>
                <tbody>
                    ${hsnRows}
                    <tr style="font-weight:600;border-top:2px solid #e2e8f0;">
                        <td style="padding:8px 10px;">Total</td>
                        <td style="text-align:right;padding:8px 10px;">₹${fmt(totalTaxableValue)}</td>
                        ${
                          data.taxType === 'IGST'
                            ? `<td></td><td style="text-align:right;padding:8px 10px;">₹${fmt(taxes.igstAmount || 0)}</td>`
                            : `<td></td><td style="text-align:right;padding:8px 10px;">₹${fmt(totalCgst)}</td>
                        <td></td><td style="text-align:right;padding:8px 10px;">₹${fmt(totalSgst)}</td>`
                        }
                        <td style="text-align:right;padding:8px 10px;">₹${fmt(totalTax)}</td>
                    </tr>
                </tbody>
            </table>
            <div style="font-size:11px;color:#64748b;margin-top:6px;">
                Tax Amount (in words): <strong>${taxAmountInWords}</strong>
            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            <div>
                <div class="section-title">Declaration</div>
                <div class="declaration-text">${declaration}</div>
                ${
                  company.bankDetails
                    ? `
                <div class="bank-details-modern">
                  <div style="font-weight: 600; margin-bottom: 6px; color: #1e293b; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">Bank Details</div>
                  <table class="bank-table-modern">
                    <tr><td class="blabel">Bank Name</td><td>: ${company.bankDetails.bankName}</td></tr>
                    <tr><td class="blabel">Account Number</td><td>: ${company.bankDetails.accountNumber}</td></tr>
                    <tr><td class="blabel">IFSC Code</td><td>: ${company.bankDetails.ifsc}</td></tr>
                  </table>
                </div>`
                    : ''
                }
                <!--
                ${
                  company.qrCode
                    ? `
                <div class="qr-area">
                  <div style="font-size: 9px; font-weight: 600; color: #64748b; margin-bottom: 4px;">PAYMENT QR</div>
                  <img src="${company.qrCode}" class="qr-img" alt="QR"/>
                </div>`
                    : ''
                }
                -->
            </div>
            <div class="signature-area">
                <div style="font-size:12px;color:#64748b;margin-bottom:8px;">for ${company.name}</div>
                ${company.signature ? `<img src="${company.signature}" class="signature-img" alt="Signature"/>` : '<div style="height:40px;"></div>'}
                <div class="signature-line">Authorised Signatory</div>
            </div>
        </div>

        <div class="bottom-note">This is a Computer Generated Invoice</div>
    </div>
</body>
</html>`.trim();
}
