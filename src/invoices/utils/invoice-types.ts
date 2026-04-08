import { TaxType } from '@prisma/client';

// Invoice Generator Types — server-side port of bill/src/lib/invoice/types.ts

export interface BankDetails {
  bankName: string;
  branch: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
}

export interface CompanyDetails {
  name: string;
  address: string;
  gstin: string;
  state: string;
  stateCode: string;
  logo?: string;
  bisLogo?: string;
  mantra?: string;
  phone?: string;
  email?: string;
  pan?: string;
  bankDetails?: BankDetails;
}

export interface BuyerDetails {
  name: string;
  address: string;
  phone?: string;
  state: string;
  stateCode: string;
  email?: string;
  pan?: string;
}

export interface InvoiceMetadata {
  invoiceNo: string;
  date: string;
  deliveryNote?: string;
  modeOfPayment?: string;
  referenceNo?: string;
  referenceDate?: string;
  buyerOrderNo?: string;
  buyerOrderDate?: string;
  dispatchDocNo?: string;
  deliveryNoteDate?: string;
  dispatchedThrough?: string;
  destination?: string;
  termsOfDelivery?: string;
  placeOfSupply?: string;
  financialYear?: string;
  invoiceType?: string;
}

export interface InvoiceItem {
  slNo: number;
  description: string;
  hsnSac: string;
  partNo?: string;
  quantity: number;
  unit: string;
  rate: number;
  makingCharges?: number;
  purity?: string;
  netWeight?: number;
  grossWeight?: number;
  huid?: string;
  amount: number;
}

export interface TaxDetails {
  taxType?: TaxType;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate?: number;
  igstAmount?: number;
  totalTaxAmount?: number;
}

export interface HsnSummary {
  hsnSac: string;
  taxableValue: number;
  taxType?: TaxType;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate?: number;
  igstAmount?: number;
  totalTaxAmount: number;
}

export interface InvoiceData {
  company: CompanyDetails;
  buyer: BuyerDetails;
  metadata: InvoiceMetadata;
  items: InvoiceItem[];
  taxType?: TaxType;
  taxes: TaxDetails;
  hsnSummary: HsnSummary[];
  roundOff: number;
  totalQuantity: number;
  totalAmount: number;
  amountInWords: string;
  taxAmountInWords: string;
  declaration?: string;
  authorizedSignatory?: string;
  // Jewellery-template extras
  cashReceived?: number;
  amtBalance?: number;
  hallmarkingCharge?: number;
}
