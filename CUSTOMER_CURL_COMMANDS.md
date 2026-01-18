# Customer Service cURL Examples

Use these examples with an authenticated Bearer token (`ACCESS_TOKEN`) obtained from the auth service. Set a base URL (e.g., `http://localhost:3000` in dev or your deployed API host).

```bash
BASE_URL="http://localhost:3000"
ACCESS_TOKEN="ey..."
```

## Create Customer (with all fields)

```bash
curl -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Ram Kumar Sharma",
    "fatherName": "Sohan Lal Sharma",
    "motherName": "Kamla Devi",
    "spouseName": "Sita Devi",
    "gender": "MALE",
    "dateOfBirth": "1985-06-10",
    "isDobEstimated": false,
    "contactDetails": {
      "primaryPhone": "9876543210",
      "secondaryPhone": "9876543211",
      "phoneOwnerType": "SELF",
      "preferredContactMethod": "CALL"
    }
  }'
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fullName` | string | ✅ Yes | Customer's full name |
| `fatherName` | string | No | Father's name |
| `motherName` | string | No | Mother's name |
| `spouseName` | string | No | Spouse's name |
| `gender` | enum | No | `MALE`, `FEMALE`, `OTHER`, `PREFER_NOT_TO_SAY` |
| `dateOfBirth` | date | No | Format: `YYYY-MM-DD` |
| `isDobEstimated` | boolean | No | `true` if DOB is estimated |
| `contactDetails` | object | No | Nested contact details (see below) |

### Contact Details Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `primaryPhone` | string | ✅ Yes | Primary phone number |
| `secondaryPhone` | string | No | Secondary phone number |
| `phoneOwnerType` | enum | No | `SELF`, `FAMILY`, `NEIGHBOR`, `OTHER` |
| `preferredContactMethod` | enum | No | `CALL`, `WHATSAPP`, `SMS`, `VISIT`, `EMAIL` |

## List Customers (current organization)

```bash
curl -X GET "$BASE_URL/customers" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Get Customer by Code

```bash
curl -X GET "$BASE_URL/customers/code/CUST-0001" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Get Customer by ID

```bash
curl -X GET "$BASE_URL/customers/<customer-id>" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Update Customer

```bash
curl -X PATCH "$BASE_URL/customers/<customer-id>" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Ram Kumar Updated",
    "gender": "MALE",
    "isDobEstimated": true
  }'
```

## Add Contact Detail

```bash
curl -X POST "$BASE_URL/customers/<customer-id>/contact-details" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "primaryPhone": "9998887776",
    "phoneOwnerType": "SELF",
    "preferredContactMethod": "WHATSAPP"
  }'
```

## Update Contact Detail

```bash
curl -X PATCH "$BASE_URL/customers/<customer-id>/contact-details/<contact-detail-id>" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secondaryPhone": "9998887775",
    "preferredContactMethod": "SMS"
  }'
```

## Add Location

```bash
curl -X POST "$BASE_URL/customers/<customer-id>/locations" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "village": "Rampur",
    "district": "Jaipur",
    "state": "Rajasthan",
    "pincode": "302001",
    "landmark": "Near Market"
  }'
```

## Update Location

```bash
curl -X PATCH "$BASE_URL/customers/<customer-id>/locations/<location-id>" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "village": "Rampur Kalan",
    "landmark": "Opp. School"
  }'
```
