# Credits (Udhar) API - cURL Examples

This document contains cURL examples for all Credit/Udhar API endpoints.

## Prerequisites

Set your base URL and JWT token:

```bash
BASE_URL="http://localhost:3000"
TOKEN="your-jwt-token-here"
```

---

## 💳 CREDIT CRUD

### 1. Create Credit

```bash
# Basic credit creation
curl -X POST "${BASE_URL}/credits" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "uuid-customer-id-here",
    "totalAmount": 50000.00,
    "saleReference": "INV-2024-001",
    "itemSummary": "Gold Necklace 22K, 45g",
    "description": "Wedding jewelry credit",
    "creditDate": "2024-01-15T10:00:00Z",
    "expectedDueDate": "2024-02-15T10:00:00Z",
    "reminderFrequency": "WEEKLY",
    "notes": "Customer promised to pay in installments"
  }'

# Create credit with initial payment
curl -X POST "${BASE_URL}/credits" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "uuid-customer-id-here",
    "totalAmount": 50000.00,
    "initialPayment": 10000.00,
    "saleReference": "INV-2024-002",
    "itemSummary": "Gold Ring 18K, 10g",
    "expectedDueDate": "2024-03-01T10:00:00Z",
    "reminderFrequency": "MONTHLY"
  }'

# Minimal credit creation (only required fields)
curl -X POST "${BASE_URL}/credits" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "uuid-customer-id-here",
    "totalAmount": 25000.00
  }'
```

**Response includes:** Created credit with customer info and `customerCreditSummary` (decision support data).

---

### 2. Get All Credits (with Filters & Pagination)

```bash
# Get all credits (default pagination)
curl -X GET "${BASE_URL}/credits" \
  -H "Authorization: Bearer ${TOKEN}"

# Get credits with pagination
curl -X GET "${BASE_URL}/credits?page=1&limit=20" \
  -H "Authorization: Bearer ${TOKEN}"

# Filter by customer
curl -X GET "${BASE_URL}/credits?customerId=uuid-customer-id-here" \
  -H "Authorization: Bearer ${TOKEN}"

# Filter by status
curl -X GET "${BASE_URL}/credits?status=ACTIVE" \
  -H "Authorization: Bearer ${TOKEN}"

# Filter by overdue only
curl -X GET "${BASE_URL}/credits?overdueOnly=true" \
  -H "Authorization: Bearer ${TOKEN}"

# Filter by due date range
curl -X GET "${BASE_URL}/credits?dueBefore=2024-02-01&dueAfter=2024-01-01" \
  -H "Authorization: Bearer ${TOKEN}"

# Filter by credit date range
curl -X GET "${BASE_URL}/credits?creditDateFrom=2024-01-01&creditDateTo=2024-01-31" \
  -H "Authorization: Bearer ${TOKEN}"

# Search credits (by sale reference, item summary, description, or customer name)
curl -X GET "${BASE_URL}/credits?search=gold" \
  -H "Authorization: Bearer ${TOKEN}"

# Combined filters with sorting
curl -X GET "${BASE_URL}/credits?status=ACTIVE&customerId=uuid-customer-id&page=1&limit=10&sortBy=creditDate&sortOrder=desc" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Query Parameters:**
- `customerId` - Filter by customer ID
- `status` - Filter by status (ACTIVE, PAID, OVERDUE, CANCELLED)
- `overdueOnly` - Boolean, show only overdue credits
- `dueBefore` - Date string (ISO 8601), credits due before this date
- `dueAfter` - Date string (ISO 8601), credits due after this date
- `creditDateFrom` - Date string, credits created from this date
- `creditDateTo` - Date string, credits created until this date
- `search` - Search in saleReference, itemSummary, description, or customer name
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)
- `sortBy` - Field to sort by (default: creditDate)
- `sortOrder` - Sort direction: asc or desc (default: desc)

---

### 3. Get Credit by ID

```bash
CREDIT_ID="uuid-credit-id-here"

curl -X GET "${BASE_URL}/credits/${CREDIT_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Response includes:** Credit details with customer info, all transactions, and remaining balance.

---

### 4. Update Credit

```bash
CREDIT_ID="uuid-credit-id-here"

# Update credit details
curl -X PATCH "${BASE_URL}/credits/${CREDIT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "saleReference": "INV-2024-001-UPDATED",
    "itemSummary": "Gold Necklace 22K, 50g",
    "description": "Updated description",
    "expectedDueDate": "2024-03-15T10:00:00Z",
    "reminderFrequency": "BIWEEKLY",
    "notes": "Updated notes"
  }'

# Update credit status
curl -X PATCH "${BASE_URL}/credits/${CREDIT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "OVERDUE"
  }'

# Update total amount (recalculates status if needed)
curl -X PATCH "${BASE_URL}/credits/${CREDIT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "totalAmount": 60000.00
  }'

# Update next reminder date manually
curl -X PATCH "${BASE_URL}/credits/${CREDIT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "nextReminderDate": "2024-02-20T10:00:00Z"
  }'
```

---

### 5. Delete Credit (Soft Delete)

```bash
CREDIT_ID="uuid-credit-id-here"

curl -X DELETE "${BASE_URL}/credits/${CREDIT_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Response:** 204 No Content (soft delete sets `deletedAt` timestamp)

---

## 📊 STATS & REPORTS

### 6. Get Credit Statistics

```bash
curl -X GET "${BASE_URL}/credits/stats" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Response includes:**
- **Exposure:**
  - `totalCreditsIssued` - Total amount of all credits ever issued
  - `totalCreditsCount` - Total number of credits
  - `creditsIssuedThisMonth` - Amount issued this month
  - `creditsCountThisMonth` - Count of credits this month
  - `creditsIssuedThisYear` - Amount issued this year
  - `creditsCountThisYear` - Count of credits this year
  - `totalOutstanding` - Total outstanding amount (active + overdue)

- **Recovery:**
  - `totalRecovered` - Total amount recovered from paid credits
  - `recoveredThisMonth` - Amount recovered this month
  - `transactionsThisMonth` - Number of payment transactions this month
  - `recoveryRateThisMonth` - Recovery rate percentage

- **Risk:**
  - `activeCreditsCount` - Number of active credits
  - `overdueCreditsCount` - Number of overdue credits
  - `overdueAmount` - Total overdue amount
  - `overdueBuckets` - Age-based buckets (0-30days, 30-60days, 60+days)
  - `topDebtors` - Top 10 customers by outstanding amount

---

## 🔔 REMINDERS

### 7. Get Due Reminders

```bash
# Get reminders due in next 7 days (default)
curl -X GET "${BASE_URL}/credits/due-reminders" \
  -H "Authorization: Bearer ${TOKEN}"

# Get reminders due in next 14 days
curl -X GET "${BASE_URL}/credits/due-reminders?days=14" \
  -H "Authorization: Bearer ${TOKEN}"

# Get reminders due in next 30 days
curl -X GET "${BASE_URL}/credits/due-reminders?days=30" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Response includes:** Credits with reminders due, customer contact info, remaining balance, and days overdue.

**Filters applied:**
- Only ACTIVE and OVERDUE credits
- Excludes credits with recent payments (within 2 days)
- Ordered by expected due date and next reminder date

---

## 👤 CUSTOMER CREDIT SUMMARY

### 8. Get Customer Credit Summary

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/credits/customer/${CUSTOMER_ID}/summary" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Response includes:**
- `totalActiveUdhar` - Total outstanding amount
- `openCreditsCount` - Number of active/overdue credits
- `totalCreditsEver` - Total amount of all credits ever given
- `totalRepaid` - Total amount repaid across all credits
- `oldestUnpaidDays` - Days since oldest unpaid credit's due date
- `lastPaymentDate` - Date of last payment (across all credits)
- `overdueCount` - Number of overdue credits
- `behaviorTag` - Behavior classification (CLEAR, REGULAR, DELAYED, RISKY)
- `riskLevel` - Risk level (LOW, MEDIUM, HIGH, VERY_HIGH)

**Use case:** Decision support when creating new credits - shows customer's credit history and risk profile.

---

## 💰 CREDIT TRANSACTIONS (PAYMENTS)

### 9. Get Credit Transactions (Payment History)

```bash
CREDIT_ID="uuid-credit-id-here"

curl -X GET "${BASE_URL}/credits/${CREDIT_ID}/transactions" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Response:** List of all payment transactions for the credit, ordered by date (newest first).

---

### 10. Add Payment Transaction

```bash
CREDIT_ID="uuid-credit-id-here"

# Basic payment
curl -X POST "${BASE_URL}/credits/${CREDIT_ID}/transactions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000.00,
    "paymentMethod": "CASH",
    "notes": "Partial payment received"
  }'

# Payment with all details
curl -X POST "${BASE_URL}/credits/${CREDIT_ID}/transactions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 15000.00,
    "transactionDate": "2024-01-20T14:30:00Z",
    "paymentMethod": "UPI",
    "referenceNumber": "UPI123456789",
    "collectedBy": "Rajesh Kumar",
    "notes": "Payment via PhonePe"
  }'

# Payment methods: CASH, UPI, BANK_TRANSFER, CHEQUE, CARD, OTHER
```

**Response includes:** Created transaction, updated credit with new balance, and remaining balance.

**Note:** Payment automatically updates credit's `paidAmount` and `status` (sets to PAID if fully paid).

---

### 11. Update Payment Transaction

```bash
CREDIT_ID="uuid-credit-id-here"
TRANSACTION_ID="uuid-transaction-id-here"

# Update payment amount (recalculates credit balance)
curl -X PATCH "${BASE_URL}/credits/${CREDIT_ID}/transactions/${TRANSACTION_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 12000.00,
    "paymentMethod": "BANK_TRANSFER",
    "referenceNumber": "TXN987654321",
    "notes": "Updated payment amount"
  }'

# Update payment details (without changing amount)
curl -X PATCH "${BASE_URL}/credits/${CREDIT_ID}/transactions/${TRANSACTION_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionDate": "2024-01-21T10:00:00Z",
    "collectedBy": "Suresh Kumar",
    "notes": "Updated collection details"
  }'
```

**Note:** If amount is changed, credit balance is automatically recalculated and status updated.

---

### 12. Delete Payment Transaction

```bash
CREDIT_ID="uuid-credit-id-here"
TRANSACTION_ID="uuid-transaction-id-here"

curl -X DELETE "${BASE_URL}/credits/${CREDIT_ID}/transactions/${TRANSACTION_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Response:** 204 No Content

**Note:** Credit balance is automatically recalculated after deletion, and status is updated if needed.

---

## 📝 ENUMS & VALUES

### Credit Status
- `ACTIVE` - Unpaid or partially paid
- `PAID` - Fully repaid
- `OVERDUE` - Past expected due date
- `CANCELLED` - Written off

### Reminder Frequency
- `WEEKLY` - Remind every week
- `BIWEEKLY` - Remind every 2 weeks
- `MONTHLY` - Remind every month
- `CUSTOM` - Custom frequency (defaults to weekly)

### Payment Method
- `CASH` - Cash payment
- `UPI` - UPI payment (PhonePe, GooglePay, etc.)
- `BANK_TRANSFER` - Bank transfer/NEFT/RTGS
- `CHEQUE` - Cheque payment
- `CARD` - Card payment
- `OTHER` - Other payment method

### Risk Level (in Customer Summary)
- `LOW` - Low risk customer
- `MEDIUM` - Medium risk customer
- `HIGH` - High risk customer
- `VERY_HIGH` - Very high risk customer

### Behavior Tag (in Customer Summary)
- `CLEAR` - No active credits
- `REGULAR` - Active credits but none overdue
- `DELAYED` - Has overdue credits but <30 days
- `RISKY` - Has overdue credits >30 days

---

## 🔄 COMPLETE WORKFLOW EXAMPLES

### Example 1: Create Credit and Track Payments

```bash
# 1. Create a new credit
CREDIT_RESPONSE=$(curl -s -X POST "${BASE_URL}/credits" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "uuid-customer-id-here",
    "totalAmount": 50000.00,
    "saleReference": "INV-2024-001",
    "itemSummary": "Gold Necklace 22K, 45g",
    "expectedDueDate": "2024-02-15T10:00:00Z",
    "reminderFrequency": "WEEKLY"
  }')

# Extract credit ID from response (using jq if available)
CREDIT_ID=$(echo $CREDIT_RESPONSE | jq -r '.id')

# 2. Add first payment
curl -X POST "${BASE_URL}/credits/${CREDIT_ID}/transactions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 15000.00,
    "paymentMethod": "CASH",
    "notes": "First installment"
  }'

# 3. Add second payment
curl -X POST "${BASE_URL}/credits/${CREDIT_ID}/transactions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 20000.00,
    "paymentMethod": "UPI",
    "referenceNumber": "UPI123456",
    "notes": "Second installment"
  }'

# 4. Check credit status
curl -X GET "${BASE_URL}/credits/${CREDIT_ID}" \
  -H "Authorization: Bearer ${TOKEN}"

# 5. View payment history
curl -X GET "${BASE_URL}/credits/${CREDIT_ID}/transactions" \
  -H "Authorization: Bearer ${TOKEN}"
```

### Example 2: Check Customer Before Creating Credit

```bash
CUSTOMER_ID="uuid-customer-id-here"

# 1. Get customer credit summary (decision support)
curl -X GET "${BASE_URL}/credits/customer/${CUSTOMER_ID}/summary" \
  -H "Authorization: Bearer ${TOKEN}"

# Response shows:
# - totalActiveUdhar: 75000.00
# - riskLevel: "MEDIUM"
# - overdueCount: 1
# - lastPaymentDate: "2024-01-10T10:00:00Z"

# 2. Create new credit (response includes same summary)
curl -X POST "${BASE_URL}/credits" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "'${CUSTOMER_ID}'",
    "totalAmount": 30000.00,
    "expectedDueDate": "2024-03-01T10:00:00Z"
  }'
```

### Example 3: Monitor Overdue Credits

```bash
# 1. Get all overdue credits
curl -X GET "${BASE_URL}/credits?overdueOnly=true" \
  -H "Authorization: Bearer ${TOKEN}"

# 2. Get reminders for next 7 days
curl -X GET "${BASE_URL}/credits/due-reminders?days=7" \
  -H "Authorization: Bearer ${TOKEN}"

# 3. Get credit statistics
curl -X GET "${BASE_URL}/credits/stats" \
  -H "Authorization: Bearer ${TOKEN}"

# Response shows:
# - overdueCreditsCount: 5
# - overdueAmount: 125000.00
# - overdueBuckets: { "0-30days": 2, "30-60days": 2, "60+days": 1 }
```

---

## ⚠️ ERROR RESPONSES

### Common Error Codes

- `400 Bad Request` - Invalid input data (e.g., initial payment exceeds total amount)
- `401 Unauthorized` - Missing or invalid JWT token
- `404 Not Found` - Credit, customer, or transaction not found
- `403 Forbidden` - Access denied (e.g., credit belongs to different organization)

### Example Error Response

```json
{
  "statusCode": 400,
  "message": "Initial payment cannot exceed total amount",
  "error": "Bad Request"
}
```

---

## 📌 NOTES

1. **All endpoints require JWT authentication** - Include `Authorization: Bearer ${TOKEN}` header
2. **All amounts are in Decimal** - Use 2 decimal places (e.g., 50000.00)
3. **Dates are ISO 8601 format** - Use format: `2024-01-15T10:00:00Z`
4. **Soft deletes** - Deleted credits are not permanently removed, just marked with `deletedAt`
5. **Automatic calculations** - Credit status and balances are automatically updated on payment operations
6. **Transaction safety** - All payment operations are atomic (transaction-safe)
7. **Organization scoping** - All queries are automatically scoped to user's organization

---

## 🔗 Related Documentation

- [Customers API cURL Examples](./customers-api-curl.md)
- [Udhar Module Verification Report](../UDHAR_VERIFICATION_REPORT.md)
- [Supabase Sync Status](../SUPABASE_SYNC_STATUS.md)
