type BillBookHtmlInput = {
  title: string;
  invoices: string[];
};

type BillBookTitleInput = {
  selectedCount?: number;
  dateFrom?: string;
  dateTo?: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatDate = (date?: string): string => {
  if (!date) return '';
  const [year, month, day] = date.split('-');
  return year && month && day && MONTHS[Number(month) - 1]
    ? `${day}-${MONTHS[Number(month) - 1]}-${year}`
    : date;
};

export function getBillBookTitle({ selectedCount, dateFrom, dateTo }: BillBookTitleInput): string {
  if (selectedCount !== undefined) return `Bill Book - ${selectedCount} Bills`;

  const from = formatDate(dateFrom);
  const to = formatDate(dateTo);
  if (from && to) return `Bill Book - ${from === to ? from : `${from} to ${to}`}`;
  if (from) return `Bill Book - From ${from}`;
  if (to) return `Bill Book - Up to ${to}`;
  return 'Bill Book - All Time';
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const removePrintButton = (html: string): string =>
  html.replace(
    /<button\b[^>]*class=["'][^"']*\bprint-btn\b[^"']*["'][^>]*>[\s\S]*?<\/button>/gi,
    '',
  );

const extractStyles = (html: string): string => {
  const styles = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1])
    .join('\n');

  return styles
    .replace(/\bhtml\s*,\s*body\b/gi, ':host')
    .replace(/\bbody\b/gi, ':host')
    .replace(/\bhtml\b/gi, ':host');
};

const extractBody = (html: string): string => {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return removePrintButton(body);
};

export function buildBillBookHtml({ title, invoices }: BillBookHtmlInput): string {
  const escapedTitle = escapeHtml(title);
  const templates = invoices
    .map(
      (invoice, index) => `
    <template data-bill-template="${index}">
      <style>
        :host { display: block; background: #fff; }
        ${extractStyles(invoice)}
      </style>
      ${extractBody(invoice)}
    </template>
    <section class="bill-book-page" data-bill-page="${index}"></section>`,
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
      box-shadow: 0 2px 12px rgba(0,0,0,.14); overflow: visible;
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
  <div class="bill-count">${invoices.length} Bills</div>
  ${templates}
  <script>
    document.querySelectorAll('[data-bill-template]').forEach((template) => {
      const page = document.querySelector('[data-bill-page="' + template.dataset.billTemplate + '"]');
      const shadow = page.attachShadow({ mode: 'open' });
      shadow.appendChild(template.content.cloneNode(true));
      template.remove();
    });
  </script>
</body>
</html>`;
}
