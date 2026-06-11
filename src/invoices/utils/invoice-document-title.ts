import { BuyerDetails, InvoiceMetadata } from './invoice-types';

export function getInvoiceDocumentTitle(
  buyer: Pick<BuyerDetails, 'name'>,
  metadata: Pick<InvoiceMetadata, 'invoiceNo'>,
): string {
  return ['Tax Invoice', buyer.name, metadata.invoiceNo].filter(Boolean).join(' - ');
}
