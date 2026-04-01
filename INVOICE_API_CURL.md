# Invoices API — Curl Reference

This document provides a comprehensive list of curl commands to interact with the Invoices module.

## 🔑 Setup & Auth

All requests assume the server is running at `http://localhost:3000` and require a valid JWT bearer token.

```bash
# Configuration
export BASE_URL="http://localhost:3000"
export AUTH_TOKEN="your_jwt_here" # Paste your token here
```

---

## 🛠️ Organisation Settings
Configure shop details (GSTIN, Address, Bank) that appear on invoices.

### Update/Upsert Settings
**POST** `/invoices/settings`

```bash
curl -X POST "$BASE_URL/invoices/settings" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Aurum Jewellery & Gems",
    "address": "Shop 12, Gold Souk, Johari Bazaar, Jaipur",
    "gstin": "08ABCDE1234F1Z5",
    "state": "Rajasthan",
    "stateCode": "08",
    "phone": "9876543210",
    "email": "contact@aurumjewellers.com",
    "pan": "ABCDE1234F",
    "mantra": "॥ शुभम भवतु ॥",
    "bankName": "ICICI Bank",
    "bankBranch": "MI Road",
    "bankAccountName": "Aurum Jewellery PVT LTD",
    "bankAccountNumber": "602105001234",
    "bankIfsc": "ICIC0006021",
    "defaultTaxType": "CGST_SGST",
    "defaultCgstRate": 1.5,
    "defaultSgstRate": 1.5,
    "defaultTemplate": "jewellery",
    "declaration": "We declare that this invoice shows the actual price of the goods described.",
    "termsOfDelivery": "FOB Jaipur"
  }'
```

### Get Current Settings
**GET** `/invoices/settings`

```bash
curl -X GET "$BASE_URL/invoices/settings" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

---

## 🧾 Invoice Operations

### Create Final Invoice
**POST** `/invoices` (Consumes a sequence number e.g., IS/001/24-25)

```bash
curl -X POST "$BASE_URL/invoices" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUSTOMER_UUID",
    "paidAmount": 25000,
    "taxType": "CGST_SGST",
    "templateType": "jewellery",
    "modeOfPayment": "UPI",
    "notes": "Custom engraving: A & S",
    "items": [
      {
        "description": "22K Gold Bangles",
        "hsnSac": "7113",
        "quantity": 1,
        "unitPrice": 85500.50,
        "grossWeight": 15.650,
        "netWeight": 15.200,
        "purity": "22K",
        "huid": "ABC123XYZ"
      }
    ]
  }'
```

### Create Draft Invoice
**POST** `/invoices/draft` (Does not consume a sequence number)

```bash
curl -X POST "$BASE_URL/invoices/draft" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUSTOMER_UUID",
    "items": [
      {
        "description": "Silver Anklets",
        "hsnSac": "7114",
        "quantity": 2,
        "unitPrice": 4500
      }
    ]
  }'
```

### Find All Invoices
**GET** `/invoices`

```bash
# Filter by status or customer if supported
curl -G "$BASE_URL/invoices" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "limit=20" \
  -d "page=1"
```

### Get Single Invoice
**GET** `/invoices/:id`

```bash
curl -X GET "$BASE_URL/invoices/INVOICE_UUID" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

### Cancel Invoice
**DELETE** `/invoices/:id`

```bash
curl -X DELETE "$BASE_URL/invoices/INVOICE_UUID" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

---

## 💳 Payments

### Record a Payment
**PATCH** `/invoices/:id/payment`

```bash
curl -X PATCH "$BASE_URL/invoices/INVOICE_UUID/payment" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 15000,
    "paymentMethod": "UPI",
    "referenceNumber": "TXN9988776655",
    "notes": "Balance payment for Gold Chain",
    "transactionDate": "2024-04-01T12:00:00Z"
  }'
```

---

## 📄 Documents

### Download PDF
**GET** `/invoices/:id/pdf`

```bash
# Save to a local file
curl -X GET "$BASE_URL/invoices/INVOICE_UUID/pdf" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  --output invoice.pdf
```

---

## 🏗️ Technical Details

### Key Enums & Defaults
- **TaxType**: `CGST_SGST`, `IGST`, `NONE`
- **PaymentMethod**: `CASH`, `UPI`, `BANK_TRANSFER`, `CHEQUE`, `CARD`, `OTHER`
- **TemplateType**: `standard`, `jewellery`
- **Units**: Default is `PCS`.
