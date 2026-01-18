# Template for Adding New Organization-Scoped Tables

## Simple 2-Step Process

When you need to add a new table that should be organization-scoped (multi-tenant), follow this pattern:

---

## Step 1: Create Your New Model

Add your model anywhere in the schema file (after the Organization model). Use this template:

```prisma
model YourNewTable {
  id              String   @id @default(uuid())
  organizationId  String   // REQUIRED: For multi-tenant isolation
  
  // Your fields here
  field1          String
  field2          String?
  
  // REQUIRED: Relation to Organization
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  // Optional: Relations to other tables
  // relatedTable   RelatedTable?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // REQUIRED: Index for performance
  @@index([organizationId])
  
  // Optional: Additional indexes for common queries
  // @@index([organizationId, field1])
  // @@unique([organizationId, uniqueField])
}
```

---

## Step 2: Add Relation to Organization Model

In the `Organization` model, add one line in the organization-scoped section:

```prisma
model Organization {
  // ... existing code ...
  
  // Organization-scoped tables (multi-tenant)
  customers       Customer[]
  contactDetails  ContactDetail[]
  // ... other tables ...
  
  yourNewTables   YourNewTable[]  // <-- ADD THIS LINE
  
  // ... rest of code ...
}
```

**That's it!** Just add the plural form of your table name.

---

## Example: Adding a "Transactions" Table

### Step 1: Create the Model

```prisma
model Transaction {
  id              String   @id @default(uuid())
  organizationId  String   // Multi-tenant isolation
  accountId       String
  
  amount          Decimal  @db.Decimal(12, 2)
  type            String   // Credit, Debit
  description     String?
  
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  account         Account       @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([organizationId])
  @@index([organizationId, accountId])
  @@index([organizationId, createdAt])
}
```

### Step 2: Add to Organization

```prisma
model Organization {
  // ... existing code ...
  
  transactions    Transaction[]  // <-- ADD THIS LINE
  
  // ... rest of code ...
}
```

---

## Checklist

When adding a new organization-scoped table:

- [ ] Model has `organizationId String` field
- [ ] Model has `organization Organization @relation(...)` relation
- [ ] Model has `@@index([organizationId])` for performance
- [ ] Added relation to `Organization` model (plural form)
- [ ] Run `npm run prisma:migrate` to create migration
- [ ] Run `npm run prisma:generate` to update Prisma Client

---

## Important Notes

1. **Always include `organizationId`** - This is what makes it multi-tenant
2. **Always add the relation** - This enables type-safe queries
3. **Always index `organizationId`** - Critical for query performance
4. **Use `onDelete: Cascade`** - Ensures data cleanup when organization is deleted
5. **Plural form in Organization** - `transactions Transaction[]` not `transaction Transaction[]`

---

## Pattern Summary

```
New Table = organizationId + relation + index + add to Organization
```

Simple and consistent! 🎯

