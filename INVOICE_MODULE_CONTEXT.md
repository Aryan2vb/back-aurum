# Invoice Module Context for Aurum (back-aurum)

## 1. Goal
Add a robust **Invoice Management Module** to the Aurum backend (`back-aurum`). This module will handle generating invoices, tracking payments, and automatically creating "Udhar" (Credit) records for unpaid or partially paid transactions.

## 2. Current Backend Architecture
- **Framework**: NestJS
- **Database**: PostgreSQL with Prisma ORM
- **Multi-tenancy**: All entities are scoped to an `Organization` (via `organizationId`).
- **Auth**: JWT-based with `OrganizationRole` (OWNER, ADMIN, STAFF, VIEWER).

### Existing Models (Highly Relevant to Invoicing)
- **Customer**: Every invoice must be linked to a customer record.
- **Credit (Udhar)**: Currently used to track money owed by a customer.
  - Fields include: `totalAmount`, `paidAmount`, `status` (ACTIVE, PAID, OVERDUE), `nextReminderDate`, and `saleReference`.
  - Service logic already exists to find "Due Reminders" and calculate next reminder dates based on frequency.
- **CreditTransaction**: Tracks individual payments made against a specific `Credit` record.

## 3. High-Level Requirements for the Invoice Module

### Schema Proposals
- **Invoice**:
  - `id`, `organizationId`, `customerId`, `invoiceNumber` (sequential per org).
  - `invoiceDate`, `dueDate`.
  - `status`: DRAFT, SENT, PAID, PARTIAL, UNPAID, CANCELLED.
  - `totalAmount` (subtotal + tax).
  - `paidAmount` (initial payment at time of invoice).
  - `notes`, `createdById`.
  - **Linking**: Should have a `creditId` (optional, populated if there's any unpaid amount).
- **InvoiceItem**:
  - `id`, `invoiceId`, `description`, `quantity`, `unitPrice`, `taxAmount`, `totalAmount`.

### Business Logic
1.  **Creation Flow**: When an invoice is finalized:
    - If `paidAmount < totalAmount`:
      - Automatically create a `Credit` (Udhar) record.
      - Associate the `Credit` record's `saleReference` with the `invoiceNumber`.
      - Link the `Invoice` to that `Credit`.
    - If `paidAmount == totalAmount`: Status = PAID, no credit record needed.
2.  **Payment Recording**:
    - If a payment is recorded against an invoice that has a linked `Credit`, it should update the `CreditTransaction` and `Credit` record accordingly via the existing `CreditsService`.
3.  **Reminders**:
    - Leverage the existing `CreditsService.getDueReminders` for invoices that resulted in credit.
4.  **Templating**:
    - Build a service to populate the user-provided HTML template with invoice data.
    - Support converting this to PDF or providing a web-viewable URL.
5.  **Actions**: "Send later" functionality (triggered manually or after creation via email/WhatsApp).

## 4. Interaction Points
- **CreditsService integration**: The `InvoicesService` should inject and call `CreditsService` to create/synchronize balances.
- **CustomerProfile integration**: Customers should be able to see their list of Invoices alongside their Udhar history.
- **Notification Service**: A placeholder or logic for sending links to customers (WhatsApp/Email).
