export type PurchaseBillBookPage = {
  billNo: string;
  vendorName: string;
  purchaseDate: string;
  attachmentUrl?: string | null;
  attachmentMime?: string | null;
  attachmentName?: string | null;
};

type PurchaseBillBookHtmlInput = {
  title: string;
  pages: PurchaseBillBookPage[];
};

type PurchaseBillBookTitleInput = {
  selectedCount?: number;
  search?: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatDate = (date?: string | Date): string => {
  if (!date) return '—';
  if (date instanceof Date) {
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = MONTHS[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return month ? `${day}-${month}-${year}` : '—';
  }
  const iso = String(date).slice(0, 10);
  const [year, month, day] = iso.split('-');
  return year && month && day && MONTHS[Number(month) - 1]
    ? `${day}-${MONTHS[Number(month) - 1]}-${year}`
    : iso;
};

export function getPurchaseBillBookTitle({
  selectedCount,
  search,
}: PurchaseBillBookTitleInput): string {
  if (selectedCount !== undefined) return `Purchase Bill Book - ${selectedCount} Bills`;
  if (search?.trim()) return `Purchase Bill Book - "${search.trim()}"`;
  return 'Purchase Bill Book - All Purchases';
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const isImageMime = (mime?: string | null, url?: string | null): boolean => {
  if (mime?.startsWith('image/')) return true;
  const lower = (url || '').toLowerCase();
  return /\.(jpe?g|png|webp)(\?|$)/.test(lower);
};

const isPdfMime = (mime?: string | null, url?: string | null): boolean => {
  if (mime === 'application/pdf') return true;
  return /\.pdf(\?|$)/.test((url || '').toLowerCase());
};

const pageHeader = (page: PurchaseBillBookPage): string => {
  const billNo = escapeHtml(page.billNo || '—');
  const vendor = escapeHtml(page.vendorName || '—');
  const date = escapeHtml(formatDate(page.purchaseDate));
  return `<header class="bill-page-header">
    <div><span class="label">Bill</span> ${billNo}</div>
    <div><span class="label">Supplier</span> ${vendor}</div>
    <div><span class="label">Date</span> ${date}</div>
  </header>`;
};

const placeholderBody = (message: string): string => `
  <div class="bill-page-placeholder">
    <p class="placeholder-title">${escapeHtml(message)}</p>
  </div>`;

const buildPageBody = (page: PurchaseBillBookPage): string => {
  const url = page.attachmentUrl?.trim();
  // Only embed http(s) — escapeHtml alone does not stop javascript: / data: schemes.
  if (!url || !/^https?:\/\//i.test(url)) {
    return placeholderBody('Supplier invoice attachment missing');
  }

  const safeUrl = escapeHtml(url);
  const safeName = escapeHtml(page.attachmentName || 'Supplier invoice');

  if (isImageMime(page.attachmentMime, url)) {
    return `<div class="bill-page-media">
      <img src="${safeUrl}" alt="${safeName}" />
    </div>`;
  }

  if (isPdfMime(page.attachmentMime, url)) {
    return `<div class="bill-page-media bill-page-pdf">
      <object data="${safeUrl}" type="application/pdf" title="${safeName}">
        <embed src="${safeUrl}" type="application/pdf" />
        <p class="embed-fallback">PDF could not be embedded. <a href="${safeUrl}" target="_blank" rel="noopener">Open attachment</a></p>
      </object>
    </div>`;
  }

  return placeholderBody('Supplier invoice attachment missing');
};

export function buildPurchaseBillBookHtml({ title, pages }: PurchaseBillBookHtmlInput): string {
  const escapedTitle = escapeHtml(title);
  const pageSections = pages
    .map(
      (page) => `
    <section class="bill-book-page">
      ${pageHeader(page)}
      ${buildPageBody(page)}
    </section>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #e5e7eb; color: #111827; font-family: Arial, sans-serif; }
    .print-btn {
      position: fixed; right: 20px; bottom: 20px; z-index: 1000;
      border: 0; border-radius: 999px; padding: 12px 20px;
      background: #111827; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer;
      box-shadow: 0 6px 18px rgba(0,0,0,.2);
    }
    .bill-count {
      position: fixed; left: 20px; bottom: 20px; z-index: 1000;
      border-radius: 999px; padding: 10px 16px; background: #fff;
      box-shadow: 0 6px 18px rgba(0,0,0,.15); font-size: 13px; font-weight: 700;
    }
    .bill-book-page {
      width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff;
      box-shadow: 0 2px 12px rgba(0,0,0,.14); overflow: hidden;
      display: flex; flex-direction: column;
    }
    .bill-page-header {
      flex: 0 0 auto; padding: 10mm 12mm 6mm; border-bottom: 1px solid #e5e7eb;
      font-size: 13px; line-height: 1.5;
    }
    .bill-page-header .label { color: #6b7280; font-weight: 600; margin-right: 6px; }
    .bill-page-media {
      flex: 1 1 auto; min-height: 0; padding: 6mm 10mm 10mm;
      display: flex; align-items: center; justify-content: center;
    }
    .bill-page-media img {
      max-width: 100%; max-height: calc(297mm - 48mm); object-fit: contain;
    }
    .bill-page-pdf object, .bill-page-pdf embed {
      width: 100%; height: calc(297mm - 48mm); border: 0;
    }
    .embed-fallback { text-align: center; color: #6b7280; font-size: 14px; }
    .bill-page-placeholder {
      flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
      min-height: calc(297mm - 48mm); padding: 24mm;
    }
    .placeholder-title {
      margin: 0; font-size: 18px; font-weight: 700; color: #9ca3af; text-align: center;
    }
    @media print {
      @page { size: A4; margin: 5mm; }
      body { background: #fff; }
      .print-btn, .bill-count { display: none !important; }
      .bill-book-page {
        width: auto; min-height: 0; margin: 0; box-shadow: none;
        break-after: page; page-break-after: always;
      }
      .bill-book-page:last-of-type { break-after: auto; page-break-after: auto; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Save as PDF / Print</button>
  <div class="bill-count">${pages.length} Bills</div>
  ${pageSections}
</body>
</html>`;
}
