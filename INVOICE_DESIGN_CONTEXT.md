# Aurum Invoice Module - Product Context Document

## Purpose
This document provides complete context about the Invoice module for UX designers and Product Managers to design user flows and interfaces.

---

## 1. Domain Overview

### What is an Invoice in Aurum?
An Invoice is a GST-compliant billing document generated for customers. It supports:
- **Standard invoices** (general goods)
- **Jewellery invoices** (with purity, HUID, weight fields)
- **Multiple tax types** (CGST+SGST, IGST, or no tax)
- **Partial payments** (creates automatic Udhar/credit entries for balance)
- **Digital sharing** (PDF/HTML generation with secure links)

### Key Business Terms
- **Udhar**: Credit/loan given to customer (balance amount after partial payment)
- **DRAFT**: Unfinalized invoice (no invoice number, editable)
- **Finalize**: Converting draft to official invoice (assigns invoice number)
- **OrgInvoiceSettings**: Company GST details, logo, bank info, default tax rates
- **Snapshot**: Immutable copy of company & buyer details at time of invoice creation

---

## 2. Data Models

### Invoice Status Lifecycle
```
DRAFT → FINALIZE → [UNPAID | PARTIAL | PAID]
   ↓                    ↓
CANCELLED          CANCELLED (if not paid)
```

**Status Definitions:**
- `DRAFT`: Being prepared, no invoice number, editable
- `UNPAID`: Finalized, no payment received, full balance as Udhar
- `PARTIAL`: Finalized, some payment received, balance as Udhar
- `PAID`: Fully paid
- `CANCELLED`: Voided (cannot cancel paid invoices)

### Core Invoice Entity
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | System identifier |
| invoiceNumber | String | e.g., "INV/42/2024-25" (auto-generated) |
| status | Enum | DRAFT, UNPAID, PARTIAL, PAID, CANCELLED |
| customerId | UUID | Linked customer |
| taxType | Enum | CGST_SGST, IGST, NONE |
| subtotal | Decimal | Sum of line items (pre-tax) |
| cgstRate, sgstRate, igstRate | Decimal | Tax percentages |
| cgstAmount, sgstAmount, igstAmount | Decimal | Calculated tax amounts |
| roundOff | Decimal | ±0.50 to nearest rupee |
| totalAmount | Decimal | Final amount payable |
| paidAmount | Decimal | Amount already received |
| invoiceDate | Date | Date of transaction |
| financialYear | String | e.g., "2024-25" for sequence tracking |
| templateType | String | "standard", "jewellery", "modern" |
| companySnapshot | JSON | Frozen org details at creation time |
| buyerSnapshot | JSON | Frozen customer details |
| notes | String | Additional remarks |
| modeOfPayment | String | Cash, UPI, etc. |

### Invoice Line Items
| Field | Type | Description |
|-------|------|-------------|
| slNo | Int | Serial number (1, 2, 3...) |
| description | String | Item name/description |
| hsnSac | String | GST HSN/SAC code |
| quantity | Decimal | Number of units |
| unit | String | PCS, GM, etc. |
| unitPrice | Decimal | Price per unit |
| makingCharges | Decimal | Jewellery-specific |
| grossWeight | Decimal | Jewellery - gross weight in grams |
| netWeight | Decimal | Jewellery - net weight |
| purity | String | e.g., "22K", "916" |
| huid | String | Hallmark Unique ID |
| taxableAmount | Decimal | (quantity × unitPrice) + makingCharges |
| totalAmount | Decimal | taxableAmount + item's portion of tax |

### OrgInvoiceSettings (Company Configuration)
| Field | Purpose |
|-------|---------|
| companyName, address, gstin, state, stateCode | Header details on invoice |
| phone, email, pan | Contact information |
| mantra | Religious/traditional header text |
| logoUrl, bisLogoUrl | Company and BIS certification logos |
| bankName, bankBranch, bankAccountName, bankAccountNumber, bankIfsc | Payment details footer |
| defaultTaxType, defaultCgstRate, defaultSgstRate, defaultIgstRate | Default tax settings |
| defaultTemplate | "standard", "jewellery", "modern" |
| invoiceNumberPrefix | e.g., "INV", "GST" |
| startingSequence | Starting number for new financial year |
| declaration, termsOfDelivery | Default footer text |

---

## 3. API Endpoints & User Actions

### 3.1 Organization Settings Setup
**Who**: Owner/Admin (one-time setup)

| Endpoint | Method | Action | Role |
|----------|--------|--------|------|
| `/invoices/settings` | POST | Configure company GST, logo, bank details, defaults | OWNER, ADMIN |
| `/invoices/settings` | GET | View current settings | All roles |
| `/invoices/settings/preview` | GET | Preview how invoice will look with current settings | All roles |

**UX Considerations:**
- Settings form is extensive (20+ fields) - consider stepper/wizard
- Logo upload needed for logoUrl/bisLogoUrl
- GSTIN validation (15 characters, format check)
- Preview should show sample invoice with dummy data

---

### 3.2 Draft Invoice Creation
**Who**: Owner, Admin, Staff

| Endpoint | Method | Action |
|----------|--------|--------|
| `/invoices/draft` | POST | Create draft invoice |

**Input Fields:**
- customerId (dropdown/search)
- items[] - array of line items (dynamic add/remove)
  - For jewellery: show purity, huid, weight fields
- paidAmount (optional, defaults 0)
- taxType (dropdown: CGST+SGST, IGST, None)
- cgstRate, sgstRate, igstRate (auto-filled from settings, editable)
- templateType (dropdown: Standard, Jewellery, Modern)
- modeOfPayment (dropdown: Cash, UPI, Bank Transfer, Cheque, Card)
- deliveryNote, dispatchDocNo, destination, termsOfDelivery
- notes
- invoiceDate (date picker, default today)
- buyerAddress, buyerState, buyerStateCode (override customer address)
- autoCreateUdhar (checkbox, default true)

**Real-time Calculations Needed:**
- Subtotal = sum(items.taxableAmount)
- CGST = subtotal × cgstRate%
- SGST = subtotal × sgstRate%
- IGST = subtotal × igstRate%
- Total = subtotal + taxes
- Round-off = nearest rupee adjustment
- Balance = total - paidAmount

**UX Considerations:**
- Live preview of calculations as items added
- "Add Item" button for dynamic line items
- Item type toggle (standard vs jewellery)
- Customer search with autocomplete
- Show customer balance/udhar history as warning

---

### 3.3 Draft Management

| Endpoint | Method | Action |
|----------|--------|--------|
| `/invoices` | GET | List all invoices with filters |
| `/invoices/:id` | GET | View invoice details |
| `/invoices/:id` | PATCH | Update draft (only DRAFT editable) |
| `/invoices/:id/finalize` | POST | Convert draft to final invoice |

**Filter Options (Query Parameters):**
- customerId (filter by customer)
- status (DRAFT, UNPAID, PARTIAL, PAID, CANCELLED)
- dateFrom, dateTo (date range)
- search (fuzzy search invoiceNumber, customer name, notes)
- page, limit (pagination)
- sortBy, sortOrder (sorting)

**Finalize Modal Fields:**
- invoiceDate (confirm/edit)
- paidAmount (confirm/edit, defaults to draft value)
- manualInvoiceNumber (optional override)
- dueDate (for udhar if balance remains)
- notes (for ledger entry)
- autoCreateUdhar (checkbox, default true)

**UX Considerations:**
- Drafts should be visually distinct in list (badge/color)
- Warning if trying to finalize with 0 items
- Confirmation modal showing generated invoice number
- Option to print/share immediately after finalize

---

### 3.4 Payment Recording

| Endpoint | Method | Action |
|----------|--------|--------|
| `/invoices/:id/payment` | PATCH | Record partial or full payment |

**Input:**
- amount (number, max = remaining balance)
- notes (optional payment reference)

**Business Rules:**
- Cannot pay DRAFT (must finalize first)
- Cannot pay CANCELLED
- Cannot pay PAID (already done)
- Cannot exceed remaining balance
- Automatically updates linked Udhar entry
- Creates ledger entry for payment

**UX Considerations:**
- Show remaining balance prominently
- Quick-fill buttons: "Full Payment", "Half", "Custom"
- Payment history timeline on invoice detail
- Cash calculator for physical counting

---

### 3.5 Invoice Sharing & PDF

| Endpoint | Method | Action | Access |
|----------|--------|--------|--------|
| `/invoices/:id/pdf?signature=xxx` | GET | Download PDF | Public with signature |
| `/invoices/:id/html?signature=xxx` | GET | View HTML | Public with signature |
| `/invoices/:id/sign` | GET | Generate shareable signed URL | All roles |
| `/invoices/:id/send` | POST | Send via email/WhatsApp | OWNER, ADMIN, STAFF |

**Send Invoice Input:**
- recipientEmails[] (array)
- message (custom message template)
- includePdf (boolean)

**UX Considerations:**
- "Share" button with options: Download PDF, Copy Link, WhatsApp, Email
- QR code generation for quick sharing
- Signature links expire in 7 days
- Preview before sending
- Template selection affects PDF layout

---

### 3.6 Invoice Cancellation

| Endpoint | Method | Action |
|----------|--------|--------|
| `/invoices/:id` | DELETE | Cancel invoice |

**Business Rules:**
- Only OWNER can cancel
- Cannot cancel PAID invoices (refund first)
- Automatically cancels linked Udhar entries
- Soft delete (preserves record with CANCELLED status)

**UX Considerations:**
- Confirmation dialog with reason input
- Warning about linked udhar being cancelled
- Visual indicator (strikethrough/red badge) in lists

---

## 4. Templates & Visual Output

### Standard Template
- Classic table layout
- Company header with GSTIN
- Item table with HSN codes
- Tax summary box
- Bank details footer
- Signature/declaration

### Jewellery Template
- Emphasizes purity and HUID
- Weight columns (gross/net)
- Making charges display
- Gold rate reference
- Hallmark compliance footer

### Modern Template
- Clean minimal design
- Card-based item display
- QR code for digital verification
- Simplified tax breakdown

---

## 5. Permissions Matrix

| Action | OWNER | ADMIN | STAFF | VIEWER |
|--------|-------|-------|-------|--------|
| Configure Settings | ✓ | ✓ | ✗ | ✗ |
| Create Draft | ✓ | ✓ | ✓ | ✗ |
| View Invoices | ✓ | ✓ | ✓ | ✓ |
| Update Draft | ✓ | ✓ | ✓ | ✗ |
| Finalize | ✓ | ✓ | ✓ | ✗ |
| Record Payment | ✓ | ✓ | ✓ | ✗ |
| Send/Share | ✓ | ✓ | ✓ | ✗ |
| Cancel | ✓ | ✗ | ✗ | ✗ |

---

## 6. Business Rules & Validations

### Invoice Number Generation
- Format: `{prefix}/{sequence}/{financialYear}`
- Example: `INV/42/2024-25`
- Auto-increments per financial year
- Can be manually overridden (with uniqueness check)

### Financial Year Calculation
- India FY: April 1 - March 31
- Format: `2024-25` (current year - next year)
- Sequences reset per FY

### Tax Calculation Logic
- CGST_SGST: Both applied (intra-state)
- IGST: Only IGST applied (inter-state)
- NONE: No tax
- Round-off: Nearest rupee (±0.50)

### Udhar Auto-Creation
When invoice is finalized with balance > 0:
1. Creates UdharEntry for balance amount
2. Creates LedgerEntry (type: UDHAR)
3. Links Udhar to Invoice
4. Status tracks separately (Udhar can be paid independently)

### Payment Flow
When payment recorded:
1. Updates invoice.paidAmount
2. Updates invoice.status (PARTIAL → PAID)
3. Updates linked UdharEntry.paidAmount
4. Updates UdharEntry.status
5. Creates LedgerEntry (type: PAYMENT)

---

## 7. Error Scenarios to Handle

| Scenario | Error Message | UX Handling |
|----------|---------------|-------------|
| Settings not configured | "Invoice settings not configured" | Prompt to complete setup |
| Duplicate invoice number | "Invoice number already exists" | Show conflict, suggest next |
| Over-payment | "Payment exceeds remaining balance" | Block, show max allowed |
| Cancel paid invoice | "Cannot cancel a fully paid invoice" | Explain refund requirement |
| Invalid GSTIN | Format validation | Real-time validation |
| Draft with no items | "At least one item required" | Disable finalize button |
| Edit finalized invoice | "Only DRAFT invoices can be modified" | Suggest cancel+recreate |

---

## 8. Integration Points

### Customer Module
- Customer dropdown in invoice creation
- Customer's default address auto-filled
- View customer's invoice history
- Real-time balance check (warn if high udhar)

### Udhar/Credit Module
- Auto-creates Udhar on partial payment
- Udhar list shows source invoice
- Payment on Udhar updates invoice
- Linked ledger entries

### Ledger Module
- Every invoice creates ledger entry
- Payments create ledger entries
- Audit trail for all transactions

---

## 9. Mobile Considerations

- Invoice creation should work on tablet (shop floor)
- PDF preview optimized for mobile viewing
- Quick actions: Share via WhatsApp native
- Signature-based links work without login
- Offline draft creation (sync when online)

---

## 10. Reports & Analytics (Future)

- Monthly GST summary (CGST, SGST, IGST totals)
- Outstanding payments by customer
- Invoice volume trends
- Template usage analytics
- Payment method breakdown

---

## 11. Sample User Flows

### Flow 1: New Customer → Invoice → Full Payment
1. Register customer
2. Create invoice draft
3. Add items
4. Set paidAmount = total (full payment)
5. Finalize → Status: PAID
6. Print/share PDF

### Flow 2: Existing Customer → Partial Invoice → Later Payment
1. Search customer
2. Create invoice draft
3. Add items
4. Set paidAmount = partial (e.g., 30%)
5. Finalize → Status: UNPAID, Udhar created
6. Customer pays later → Record payment → Status: PARTIAL/PAID

### Flow 3: Jewellery Sale with HUID
1. Create draft with templateType = "jewellery"
2. Add items with purity, HUID, weights
3. Preview (jewellery layout)
4. Finalize
5. PDF includes HUID verification section

---

## Questions for UX/PM

1. **Settings Wizard**: Should settings setup be a guided wizard or single form?
2. **Item Entry**: Quick-add templates for common items? (e.g., "Gold Ring 22K")
3. **Draft Autosave**: Auto-save drafts every 30 seconds?
4. **Payment Recording**: Need photo capture of cash/cheque?
5. **Sharing**: Priority share methods? (WhatsApp default for India?)
6. **Offline**: Should draft creation work offline?
7. **Multi-user**: Real-time collaboration warnings (2 users editing same draft)?
8. **Printing**: Thermal printer support for small receipts?

---

## Technical Notes for Reference

- Backend: NestJS (TypeScript)
- Database: PostgreSQL with Prisma ORM
- PDF Generation: Puppeteer/Chromium
- Invoice Number: Auto-generated, unique per org per FY
- Signatures: HMAC-SHA256 with expiry
- File Storage: Logo/bisLogo via CDN URLs

---

## Controller Implementation Status

The following controllers are **implemented** in `invoices.controller.ts`:

### Settings Routes
- `POST /invoices/settings` - Configure org invoice settings
- `GET /invoices/settings` - Get current settings
- `GET /invoices/settings/preview` - Preview invoice with current settings

### Draft Routes
- `POST /invoices/draft` - Create draft invoice
- `POST /invoices/:id/finalize` - Finalize draft to invoice

### CRUD Routes
- `POST /invoices` - Create and finalize in one step
- `GET /invoices` - List invoices (with filtering, pagination)
- `GET /invoices/:id` - Get invoice details
- `PATCH /invoices/:id` - Update draft invoice

### Payment Routes
- `PATCH /invoices/:id/payment` - Record payment

### PDF & Sharing Routes
- `GET /invoices/:id/pdf?signature=` - Download PDF (public with signature)
- `GET /invoices/:id/html?signature=` - View HTML (public with signature)
- `GET /invoices/:id/sign` - Generate signed URL
- `POST /invoices/:id/send` - Send invoice via email/WhatsApp

### Cancellation
- `DELETE /invoices/:id` - Cancel invoice (OWNER only)

---

## DTOs Implemented

- `CreateInvoiceDto` - Invoice creation payload
- `CreateInvoiceItemDto` - Line item structure
- `CreateOrgInvoiceSettingsDto` - Settings configuration
- `FinalizeInvoiceDto` - Finalization parameters
- `QueryInvoicesDto` - List filtering/pagination
- `RecordPaymentDto` - Payment recording
- `SendInvoiceDto` - Send invoice payload
- `UpdateInvoiceDto` - Update draft payload
