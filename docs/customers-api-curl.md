# Customers API - cURL Examples

This document contains cURL examples for all Customer API endpoints.

## Prerequisites

Set your base URL and JWT token:

```bash
BASE_URL="http://localhost:3000"
TOKEN="your-jwt-token-here"
```

---

## 🧑‍💼 CUSTOMER CRUD

### 1. Create Customer

```bash
curl -X POST "${BASE_URL}/customers" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Ramesh Kumar",
    "fatherName": "Suresh Kumar",
    "motherName": "Kamla Devi",
    "spouseName": "Sita Devi",
    "gender": "MALE",
    "dateOfBirth": "1985-05-15",
    "isDobEstimated": false,
    "contactDetails": {
      "primaryPhone": "9876543210",
      "secondaryPhone": "9876543211",
      "phoneOwnerType": "SELF",
      "preferredContactMethod": "WHATSAPP"
    }
  }'
```

### 2. Get All Customers

```bash
curl -X GET "${BASE_URL}/customers" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 3. Search Customers (with Pagination & Filters)

```bash
# Basic search with query
curl -X GET "${BASE_URL}/customers/search?query=ramesh" \
  -H "Authorization: Bearer ${TOKEN}"

# Advanced search with filters
curl -X GET "${BASE_URL}/customers/search?fullName=kumar&status=ACTIVE&village=chandpur&page=1&limit=20&sortBy=createdAt&sortOrder=desc" \
  -H "Authorization: Bearer ${TOKEN}"

# Search by phone
curl -X GET "${BASE_URL}/customers/search?phone=9876543210" \
  -H "Authorization: Bearer ${TOKEN}"

# Search by location
curl -X GET "${BASE_URL}/customers/search?district=lucknow&state=uttar%20pradesh" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 4. Get Customer Stats

```bash
curl -X GET "${BASE_URL}/customers/stats" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 5. Get Customer by Code

```bash
curl -X GET "${BASE_URL}/customers/code/C-000001" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 6. Get Customer by ID

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/customers/${CUSTOMER_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 7. Update Customer

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Ramesh Kumar Singh",
    "status": "ACTIVE",
    "gender": "MALE"
  }'
```

### 8. Soft Delete Customer

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X DELETE "${BASE_URL}/customers/${CUSTOMER_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 9. Restore Deleted Customer

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}/restore" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 10. Bulk Update Customer Status

```bash
curl -X PATCH "${BASE_URL}/customers/bulk/status" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "customerIds": [
      "uuid-customer-1",
      "uuid-customer-2",
      "uuid-customer-3"
    ],
    "status": "INACTIVE"
  }'
```

---

## 📞 CONTACT DETAILS

### 11. Get Contact Details

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/customers/${CUSTOMER_ID}/contact-details" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 12. Add Contact Detail

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X POST "${BASE_URL}/customers/${CUSTOMER_ID}/contact-details" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "primaryPhone": "9988776655",
    "secondaryPhone": "9988776656",
    "phoneOwnerType": "FAMILY",
    "preferredContactMethod": "CALL"
  }'
```

### 13. Update Contact Detail

```bash
CUSTOMER_ID="uuid-customer-id-here"
CONTACT_DETAIL_ID="uuid-contact-detail-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}/contact-details/${CONTACT_DETAIL_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "primaryPhone": "9988776666",
    "preferredContactMethod": "SMS"
  }'
```

### 14. Delete Contact Detail

```bash
CUSTOMER_ID="uuid-customer-id-here"
CONTACT_DETAIL_ID="uuid-contact-detail-id-here"

curl -X DELETE "${BASE_URL}/customers/${CUSTOMER_ID}/contact-details/${CONTACT_DETAIL_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 📍 LOCATIONS

### 15. Get Locations

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/customers/${CUSTOMER_ID}/locations" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 16. Add Location

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X POST "${BASE_URL}/customers/${CUSTOMER_ID}/locations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "village": "Chandpur",
    "tehsil": "Sadar",
    "district": "Lucknow",
    "state": "Uttar Pradesh",
    "pincode": "226001",
    "landmark": "Near Hanuman Mandir"
  }'
```

### 17. Update Location

```bash
CUSTOMER_ID="uuid-customer-id-here"
LOCATION_ID="uuid-location-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}/locations/${LOCATION_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "village": "Chandpur Kalan",
    "pincode": "226002"
  }'
```

### 18. Delete Location

```bash
CUSTOMER_ID="uuid-customer-id-here"
LOCATION_ID="uuid-location-id-here"

curl -X DELETE "${BASE_URL}/customers/${CUSTOMER_ID}/locations/${LOCATION_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 👥 SOCIAL CONTEXTS

### 19. Get Social Contexts

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/customers/${CUSTOMER_ID}/social-contexts" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 20. Add Social Context

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X POST "${BASE_URL}/customers/${CUSTOMER_ID}/social-contexts" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "caste": "General",
    "educationLevel": "Graduate",
    "occupation": "Farmer",
    "incomeRange": "MEDIUM"
  }'
```

### 21. Update Social Context

```bash
CUSTOMER_ID="uuid-customer-id-here"
SOCIAL_CONTEXT_ID="uuid-social-context-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}/social-contexts/${SOCIAL_CONTEXT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "occupation": "Business Owner",
    "incomeRange": "HIGH"
  }'
```

### 22. Delete Social Context

```bash
CUSTOMER_ID="uuid-customer-id-here"
SOCIAL_CONTEXT_ID="uuid-social-context-id-here"

curl -X DELETE "${BASE_URL}/customers/${CUSTOMER_ID}/social-contexts/${SOCIAL_CONTEXT_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 📄 DOCUMENTS (KYC)

### 23. Get Documents

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/customers/${CUSTOMER_ID}/documents" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 24. Add Document

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X POST "${BASE_URL}/customers/${CUSTOMER_ID}/documents" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "aadharLast4": "1234",
    "aadharVerified": false
  }'
```

### 25. Update Document

```bash
CUSTOMER_ID="uuid-customer-id-here"
DOCUMENT_ID="uuid-document-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}/documents/${DOCUMENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "aadharVerified": true
  }'
```

### 26. Delete Document

```bash
CUSTOMER_ID="uuid-customer-id-here"
DOCUMENT_ID="uuid-document-id-here"

curl -X DELETE "${BASE_URL}/customers/${CUSTOMER_ID}/documents/${DOCUMENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 💰 ACCOUNTS

### 27. Get Accounts

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/customers/${CUSTOMER_ID}/accounts" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 28. Add Account

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X POST "${BASE_URL}/customers/${CUSTOMER_ID}/accounts" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "openingBalance": 5000.50,
    "openedAt": "2024-01-15T10:00:00.000Z",
    "status": "ACTIVE"
  }'
```

### 29. Update Account

```bash
CUSTOMER_ID="uuid-customer-id-here"
ACCOUNT_ID="uuid-account-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}/accounts/${ACCOUNT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "DORMANT"
  }'
```

### 30. Delete Account

```bash
CUSTOMER_ID="uuid-customer-id-here"
ACCOUNT_ID="uuid-account-id-here"

curl -X DELETE "${BASE_URL}/customers/${CUSTOMER_ID}/accounts/${ACCOUNT_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 📊 META TRACKING

### 31. Get Meta Trackings

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X GET "${BASE_URL}/customers/${CUSTOMER_ID}/meta-tracking" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 32. Add Meta Tracking

```bash
CUSTOMER_ID="uuid-customer-id-here"

curl -X POST "${BASE_URL}/customers/${CUSTOMER_ID}/meta-tracking" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "registeredOn": "2024-01-10T09:00:00.000Z",
    "notes": "Customer referred by Suresh from Chandpur village",
    "source": "REFERRAL"
  }'
```

### 33. Update Meta Tracking

```bash
CUSTOMER_ID="uuid-customer-id-here"
META_TRACKING_ID="uuid-meta-tracking-id-here"

curl -X PATCH "${BASE_URL}/customers/${CUSTOMER_ID}/meta-tracking/${META_TRACKING_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Updated: Customer is a regular and trusted borrower",
    "source": "WALK_IN"
  }'
```

### 34. Delete Meta Tracking

```bash
CUSTOMER_ID="uuid-customer-id-here"
META_TRACKING_ID="uuid-meta-tracking-id-here"

curl -X DELETE "${BASE_URL}/customers/${CUSTOMER_ID}/meta-tracking/${META_TRACKING_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 📋 API Summary

| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | POST | `/customers` | Create a new customer |
| 2 | GET | `/customers` | Get all customers |
| 3 | GET | `/customers/search` | Search customers with filters & pagination |
| 4 | GET | `/customers/stats` | Get customer statistics |
| 5 | GET | `/customers/code/:code` | Get customer by customer code |
| 6 | GET | `/customers/:id` | Get customer by ID |
| 7 | PATCH | `/customers/:id` | Update customer |
| 8 | DELETE | `/customers/:id` | Soft delete customer |
| 9 | PATCH | `/customers/:id/restore` | Restore deleted customer |
| 10 | PATCH | `/customers/bulk/status` | Bulk update customer status |
| 11 | GET | `/customers/:id/contact-details` | Get contact details |
| 12 | POST | `/customers/:id/contact-details` | Add contact detail |
| 13 | PATCH | `/customers/:id/contact-details/:cdId` | Update contact detail |
| 14 | DELETE | `/customers/:id/contact-details/:cdId` | Delete contact detail |
| 15 | GET | `/customers/:id/locations` | Get locations |
| 16 | POST | `/customers/:id/locations` | Add location |
| 17 | PATCH | `/customers/:id/locations/:locId` | Update location |
| 18 | DELETE | `/customers/:id/locations/:locId` | Delete location |
| 19 | GET | `/customers/:id/social-contexts` | Get social contexts |
| 20 | POST | `/customers/:id/social-contexts` | Add social context |
| 21 | PATCH | `/customers/:id/social-contexts/:scId` | Update social context |
| 22 | DELETE | `/customers/:id/social-contexts/:scId` | Delete social context |
| 23 | GET | `/customers/:id/documents` | Get documents |
| 24 | POST | `/customers/:id/documents` | Add document |
| 25 | PATCH | `/customers/:id/documents/:docId` | Update document |
| 26 | DELETE | `/customers/:id/documents/:docId` | Delete document |
| 27 | GET | `/customers/:id/accounts` | Get accounts |
| 28 | POST | `/customers/:id/accounts` | Add account |
| 29 | PATCH | `/customers/:id/accounts/:accId` | Update account |
| 30 | DELETE | `/customers/:id/accounts/:accId` | Delete account |
| 31 | GET | `/customers/:id/meta-tracking` | Get meta trackings |
| 32 | POST | `/customers/:id/meta-tracking` | Add meta tracking |
| 33 | PATCH | `/customers/:id/meta-tracking/:mtId` | Update meta tracking |
| 34 | DELETE | `/customers/:id/meta-tracking/:mtId` | Delete meta tracking |

---

## 🔑 Enum Values Reference

### CustomerStatus
- `ACTIVE`
- `INACTIVE`
- `CLOSED`
- `SUSPENDED`

### AccountStatus
- `ACTIVE`
- `CLOSED`
- `SUSPENDED`
- `DORMANT`

### Gender
- `MALE`
- `FEMALE`
- `OTHER`
- `PREFER_NOT_TO_SAY`

### PhoneOwnerType
- `SELF`
- `FAMILY`
- `NEIGHBOR`
- `OTHER`

### ContactMethod
- `CALL`
- `WHATSAPP`
- `SMS`
- `VISIT`
- `EMAIL`

### IncomeRange
- `LOW`
- `MEDIUM`
- `HIGH`
- `VERY_HIGH`
