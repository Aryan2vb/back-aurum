# Jewellery Billing SaaS — Full Implementation Prompt

## Context

You are implementing the invoice creation and billing module for a gold/silver jewellery SaaS
product for the Indian market. The tech stack is NestJS + Prisma ORM + PostgreSQL on the backend,
TypeScript on the frontend. The existing codebase has a broken invoice flow where the frontend
calculated and posted a single opaque `unitPrice` field with no base metal rate stored, making
invoices non-reproducible. This prompt describes the correct, complete implementation to replace it.

---

## Absolute rules that govern the entire implementation

1. **The backend is the single source of truth for all financial calculations.** The frontend
   may show live previews as the user types, but those are display-only. Every derived field
   (`effectiveRate`, `makingChargesAmount`, `netWeight`, `hallmarkingCharge`, `itemAmount`,
   `subtotal`, GST amounts, `grandTotal`) must be computed on the backend and stored as explicit
   columns. Nothing is recomputed at read time.

2. **Use `decimal.js` for all arithmetic.** Native JavaScript/TypeScript floats must never be
   used for any monetary or weight calculation. All Prisma `Decimal` fields map to `decimal.js`
   `Decimal` objects. Never use `Number()` to convert Decimal values mid-calculation.

3. **All stored values are the values charged at invoice time.** Rates, charges, and fees are
   snapshotted into the invoice row at creation. Nothing references a live config at read time.
   This includes the hallmarking charge (₹45/item at time of writing — stored, not referenced).

4. **All calculations are backend-only, never frontend.** Do not send calculated fields from
   the frontend. The frontend DTOs contain only raw inputs. Reject requests that include
   calculated fields — or silently ignore them and recompute.

5. **GST treatment:** Gold and silver jewellery is taxed at 3% (HSN 7113/7114).
   Hallmarking charges are a composite supply ancillary to jewellery sale and are taxed at the
   same 3% rate — they are not exempt. There is no separate tax bucket for hallmarking.
   Intra-state: CGST 1.5% + SGST 1.5%. Inter-state: IGST 3%. Determined by comparing
   `placeOfSupply` (customer's state code) with the organisation's state code.

---

## Prisma schema

Replace the existing `InvoiceItem` and `Invoice` models with the following. Do not drop any
existing columns — add new ones as nullable where backward compatibility is needed, then backfill.

```prisma
enum MetalType {
  GOLD
  SILVER
  PLATINUM
}

enum MakingChargesType {
  PER_GRAM
  FLAT_PER_ITEM
  PERCENTAGE_ON_METAL
}

enum PaymentMode {
  CASH
  UPI
  NEFT
  RTGS
  IMPS
  CHEQUE
  CARD
  OLD_GOLD
  CREDIT
}

// Keep existing TaxType / InvoiceStatus enums unchanged.

model Invoice {
  id              String        @id @default(uuid())
  organizationId  String
  customerId      String
  invoiceNumber   String?
  status          InvoiceStatus @default(DRAFT)
  taxType         TaxType       @default(CGST_SGST)

  // GST classification
  placeOfSupply   String?       // customer state code e.g. "07" — drives taxType

  // Totals (all denormalised — never recomputed on read)
  subtotal              Decimal  @db.Decimal(14, 4)  // sum of all itemAmount
  totalHallmarkingCharges Decimal @db.Decimal(12, 2) @default(0)  // Σ items.hallmarkingCharge (breakout only)
  taxableAmount         Decimal  @db.Decimal(14, 4)  // = subtotal (hallmarking is inside subtotal)
  cgstRate              Decimal  @default(0) @db.Decimal(5, 2)
  sgstRate              Decimal  @default(0) @db.Decimal(5, 2)
  igstRate              Decimal  @default(0) @db.Decimal(5, 2)
  cgstAmount            Decimal  @default(0) @db.Decimal(12, 2)
  sgstAmount            Decimal  @default(0) @db.Decimal(12, 2)
  igstAmount            Decimal  @default(0) @db.Decimal(12, 2)
  roundOff              Decimal  @default(0) @db.Decimal(6, 2)   // can be negative
  totalAmount           Decimal  @db.Decimal(14, 2)              // grand total
  paidAmount            Decimal  @default(0) @db.Decimal(12, 2)

  // Metal rate provenance
  metalRateSource  String?    // "IBJA" | "MCX" | "MANUAL"
  metalRateDate    DateTime?  // date the rate pertains to

  // Negotiation audit trail
  isNegotiated          Boolean  @default(false)
  negotiatedBy          String?  // userId
  negotiationNote       String?
  originalSubtotal      Decimal? @db.Decimal(14, 4)
  originalTaxableAmount Decimal? @db.Decimal(14, 4)
  originalCgstAmount    Decimal? @db.Decimal(12, 2)
  originalSgstAmount    Decimal? @db.Decimal(12, 2)
  originalIgstAmount    Decimal? @db.Decimal(12, 2)
  originalGrandTotal    Decimal? @db.Decimal(14, 2)
  discountAmount        Decimal? @db.Decimal(12, 2)  // originalGrandTotal − grandTotal

  // Existing fields — keep unchanged
  companySnapshot  Json
  buyerSnapshot    Json?
  deliveryNote     String?
  dispatchDocNo    String?
  destination      String?
  termsOfDelivery  String?
  templateType     String   @default("standard")
  invoiceDate      DateTime @default(now())
  financialYear    String?
  notes            String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  createdById      String?
  deletedAt        DateTime?
  sequence         Int?

  createdBy    User?         @relation(fields: [createdById], references: [id])
  customer     Customer      @relation(fields: [customerId], references: [id])
  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  items        InvoiceItem[]
  payments     InvoicePayment[]
  udharEntries UdharEntry[]

  @@unique([organizationId, invoiceNumber])
  @@unique([organizationId, financialYear, sequence])
  @@index([organizationId])
  @@index([customerId])
  @@index([organizationId, status])
  @@index([organizationId, invoiceDate])
  @@index([organizationId, status, invoiceDate])
  @@index([createdById])
  @@index([deletedAt])
}

model InvoiceItem {
  id             String   @id @default(uuid())
  invoiceId      String
  organizationId String
  slNo           Int
  description    String
  hsnSac         String
  quantity       Decimal  @db.Decimal(10, 3)
  unit           String   @default("PCS")

  // Metal provenance — all must be stored at invoice time
  metalType     MetalType  @default(GOLD)
  metalRate     Decimal?   @db.Decimal(12, 4)  // ₹/gm at 24K (gold) or 999 fine (silver)
  purityLabel   String?    // "22K", "18K", "925" — display only
  purityValue   Decimal?   @db.Decimal(6, 3)   // 22.000, 18.000, 925.000
  purityBasis   Int?       // 24 for gold karats, 1000 for silver millesimal
  effectiveRate Decimal?   @db.Decimal(12, 4)  // metalRate × (purityValue / purityBasis)

  // Weight
  grossWeight  Decimal?  @db.Decimal(10, 3)
  stoneWeight  Decimal?  @db.Decimal(10, 3) @default(0)
  netWeight    Decimal?  @db.Decimal(10, 3)  // grossWeight − stoneWeight

  // Making charges
  makingCharges       Decimal?          @db.Decimal(10, 4)  // the rate
  makingChargesType   MakingChargesType? @default(PER_GRAM)
  makingChargesAmount Decimal?          @db.Decimal(12, 4)  // resolved ₹ actually charged

  // Stone and additional
  stoneCharges Decimal?  @db.Decimal(12, 4) @default(0)

  // Hallmarking
  huid              String?
  isHallmarked      Boolean  @default(false)
  hallmarkingCharge Decimal  @db.Decimal(8, 2) @default(0)  // ₹ charged at invoice time

  // Line total (pre-GST)
  // taxableAmount here means itemAmount — kept for backward compat
  // itemAmount = (effectiveRate × netWeight) + makingChargesAmount + stoneCharges + hallmarkingCharge
  taxableAmount Decimal  @db.Decimal(14, 4)
  totalAmount   Decimal  @db.Decimal(14, 4)  // = taxableAmount (keep for compat)

  // Backward compat — set equal to effectiveRate going forward
  unitPrice Decimal  @db.Decimal(12, 4)

  // Negotiation audit trail
  originalMakingCharges       Decimal?  @db.Decimal(10, 4)
  originalMakingChargesAmount Decimal?  @db.Decimal(12, 4)
  originalItemAmount          Decimal?  @db.Decimal(12, 4)

  invoice      Invoice      @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@index([organizationId])
  @@index([organizationId, metalType])
}

model InvoicePayment {
  id             String      @id @default(uuid())
  invoiceId      String
  organizationId String
  mode           PaymentMode
  amount         Decimal     @db.Decimal(12, 2)
  reference      String?     // cheque no, UPI txn ID, NEFT ref
  paidAt         DateTime    @default(now())
  notes          String?

  invoice      Invoice      @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@index([organizationId])
  @@index([organizationId, mode])
  @@index([organizationId, paidAt])
  @@index([organizationId, mode, paidAt])
}

model InvoiceSequence {
  id             String       @id @default(uuid())
  organizationId String
  financialYear  String
  nextSequence   Int          @default(1)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, financialYear])
  @@index([organizationId])
}
```

### Migration SQL (run after prisma migrate dev)

```sql
-- Backfill purityLabel from old purity column
UPDATE "InvoiceItem"
SET "purityLabel" = "purity"
WHERE "purity" IS NOT NULL AND "purityLabel" IS NULL;

-- Backfill isHallmarked from huid presence
UPDATE "InvoiceItem"
SET "isHallmarked" = true
WHERE "huid" IS NOT NULL AND "huid" != '' AND "isHallmarked" = false;

-- Backfill Invoice.taxableAmount = subtotal for existing rows
UPDATE "Invoice"
SET "taxableAmount" = "subtotal"
WHERE "taxableAmount" IS NULL;

-- Backfill totalHallmarkingCharges from items
UPDATE "Invoice" i
SET "totalHallmarkingCharges" = (
  SELECT COALESCE(SUM(ii."hallmarkingCharge"), 0)
  FROM "InvoiceItem" ii
  WHERE ii."invoiceId" = i.id
);
```

---

## SystemConfig table (if not already present)

```prisma
model SystemConfig {
  id    String @id @default(uuid())
  key   String @unique
  value String

  @@index([key])
}
```

Seed with:

```sql
INSERT INTO "SystemConfig" (id, key, value) VALUES
  (gen_random_uuid(), 'HALLMARKING_CHARGE_PER_ITEM', '45.00'),
  (gen_random_uuid(), 'GOLD_GST_RATE', '3.00'),
  (gen_random_uuid(), 'SILVER_GST_RATE', '3.00');
```

---

## DTOs

### CreateInvoiceItemDto

```typescript
export class CreateInvoiceItemDto {
  @IsString()
  description: string;

  @IsString()
  hsnSac: string;

  @IsEnum(MetalType)
  metalType: MetalType;

  @IsDecimal()
  metalRate: string;         // ₹/gm at 24K gold, or 999 fine silver

  @IsString()
  purityLabel: string;       // "22K", "18K", "925"

  @IsDecimal()
  purityValue: string;       // "22", "18", "925"

  @IsInt()
  @IsIn([24, 1000])
  purityBasis: number;       // 24 for gold, 1000 for silver

  @IsDecimal()
  grossWeight: string;       // grams

  @IsOptional()
  @IsDecimal()
  stoneWeight?: string;      // defaults to 0

  @IsDecimal()
  makingCharges: string;     // the rate: ₹/gm, flat ₹, or %

  @IsEnum(MakingChargesType)
  makingChargesType: MakingChargesType;

  @IsOptional()
  @IsDecimal()
  stoneCharges?: string;

  @IsOptional()
  @IsString()
  huid?: string;

  @IsInt()
  @Min(1)
  slNo: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsDecimal()
  @IsOptional()
  quantity?: string;

  // Fields the frontend must NOT send (backend derives these):
  // effectiveRate, netWeight, makingChargesAmount, hallmarkingCharge,
  // itemAmount, unitPrice, taxableAmount, totalAmount
}
```

### CreateInvoiceDto

```typescript
export class CreateInvoiceDto {
  @IsString()
  customerId: string;

  @IsString()
  @IsOptional()
  placeOfSupply?: string;    // customer state code — backend derives taxType from this

  @IsEnum(MetalRateSource)
  @IsOptional()
  metalRateSource?: string;  // "IBJA" | "MCX" | "MANUAL"

  @IsISO8601()
  @IsOptional()
  metalRateDate?: string;

  @IsISO8601()
  @IsOptional()
  invoiceDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  templateType?: string;
}
```

### AddPaymentDto

```typescript
export class AddPaymentDto {
  @IsEnum(PaymentMode)
  mode: PaymentMode;

  @IsDecimal()
  amount: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
```

---

## Calculation service

Create `src/invoice/invoice-calculation.service.ts`:

```typescript
import Decimal from 'decimal.js';

export type MakingChargesType = 'PER_GRAM' | 'FLAT_PER_ITEM' | 'PERCENTAGE_ON_METAL';
export type TaxType = 'CGST_SGST' | 'IGST';

// ── Item inputs (raw, from DTO) ────────────────────────────────────────────

export interface ItemInput {
  metalRate:            Decimal;
  purityValue:          Decimal;
  purityBasis:          number;
  purityLabel:          string;
  grossWeight:          Decimal;
  stoneWeight:          Decimal;
  makingCharges:        Decimal;
  makingChargesType:    MakingChargesType;
  stoneCharges:         Decimal;
  huid:                 string | null;
  hallmarkingRatePerItem: Decimal;  // read from SystemConfig
}

// ── Computed item (everything that gets stored as columns) ─────────────────

export interface ComputedItem {
  effectiveRate:        Decimal;
  netWeight:            Decimal;
  metalValue:           Decimal;
  makingChargesAmount:  Decimal;
  stoneCharges:         Decimal;
  isHallmarked:         boolean;
  hallmarkingCharge:    Decimal;
  itemAmount:           Decimal;  // pre-GST line total
  unitPrice:            Decimal;  // = effectiveRate (backward compat)
}

// ── Invoice totals ─────────────────────────────────────────────────────────

export interface InvoiceTotals {
  subtotal:               Decimal;
  totalHallmarkingCharges:Decimal;
  taxableAmount:          Decimal;
  cgstRate:               Decimal;
  sgstRate:               Decimal;
  igstRate:               Decimal;
  cgstAmount:             Decimal;
  sgstAmount:             Decimal;
  igstAmount:             Decimal;
  roundOff:               Decimal;
  grandTotal:             Decimal;
}

// ── Core functions ─────────────────────────────────────────────────────────

export function computeItem(input: ItemInput): ComputedItem {
  const effectiveRate = input.metalRate
    .mul(input.purityValue)
    .div(input.purityBasis)
    .toDecimalPlaces(4);

  const netWeight = input.grossWeight
    .minus(input.stoneWeight)
    .toDecimalPlaces(3);

  const metalValue = effectiveRate.mul(netWeight).toDecimalPlaces(4);

  const makingChargesAmount = resolveMakingCharges(
    input.makingCharges,
    input.makingChargesType,
    netWeight,
    metalValue,
  );

  const stoneCharges = input.stoneCharges.toDecimalPlaces(4);
  const isHallmarked = !!input.huid;
  const hallmarkingCharge = isHallmarked
    ? input.hallmarkingRatePerItem.toDecimalPlaces(2)
    : new Decimal(0);

  const itemAmount = metalValue
    .plus(makingChargesAmount)
    .plus(stoneCharges)
    .plus(hallmarkingCharge)
    .toDecimalPlaces(4);

  return {
    effectiveRate,
    netWeight,
    metalValue,
    makingChargesAmount,
    stoneCharges,
    isHallmarked,
    hallmarkingCharge,
    itemAmount,
    unitPrice: effectiveRate,
  };
}

function resolveMakingCharges(
  rate:       Decimal,
  type:       MakingChargesType,
  netWeight:  Decimal,
  metalValue: Decimal,
): Decimal {
  switch (type) {
    case 'PER_GRAM':
      return rate.mul(netWeight).toDecimalPlaces(4);
    case 'FLAT_PER_ITEM':
      return rate.toDecimalPlaces(4);
    case 'PERCENTAGE_ON_METAL':
      return metalValue.mul(rate).div(100).toDecimalPlaces(4);
  }
}

export function computeInvoiceTotals(
  items:   ComputedItem[],
  taxType: TaxType,
): InvoiceTotals {
  const subtotal = items
    .reduce((s, i) => s.plus(i.itemAmount), new Decimal(0))
    .toDecimalPlaces(2);

  const totalHallmarkingCharges = items
    .reduce((s, i) => s.plus(i.hallmarkingCharge), new Decimal(0))
    .toDecimalPlaces(2);

  // Hallmarking is composite supply — taxed at jewellery rate (3%)
  const taxableAmount = subtotal;

  const cgstRate = taxType === 'CGST_SGST' ? new Decimal('1.5') : new Decimal('0');
  const sgstRate = taxType === 'CGST_SGST' ? new Decimal('1.5') : new Decimal('0');
  const igstRate = taxType === 'IGST'      ? new Decimal('3.0') : new Decimal('0');

  const cgstAmount = taxableAmount.mul(cgstRate).div(100).toDecimalPlaces(2);
  const sgstAmount = taxableAmount.mul(sgstRate).div(100).toDecimalPlaces(2);
  const igstAmount = taxableAmount.mul(igstRate).div(100).toDecimalPlaces(2);

  const rawGrand = taxableAmount
    .plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

  const grandTotal = rawGrand.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const roundOff   = grandTotal.minus(rawGrand).toDecimalPlaces(2);

  return {
    subtotal, totalHallmarkingCharges, taxableAmount,
    cgstRate, sgstRate, igstRate,
    cgstAmount, sgstAmount, igstAmount,
    roundOff, grandTotal,
  };
}
```

---

## Invoice service — create flow

```typescript
// src/invoice/invoice.service.ts (create method)

async create(orgId: string, dto: CreateInvoiceDto, createdById: string) {
  // 1. Read hallmarking rate from SystemConfig (never hardcode)
  const cfg = await this.prisma.systemConfig.findUnique({
    where: { key: 'HALLMARKING_CHARGE_PER_ITEM' },
  });
  const hallmarkingRate = new Decimal(cfg?.value ?? '45.00');

  // 2. Determine taxType from placeOfSupply vs org state
  const org = await this.prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
  });
  const taxType: TaxType =
    dto.placeOfSupply && dto.placeOfSupply !== org.stateCode
      ? 'IGST'
      : 'CGST_SGST';

  // 3. Compute all items
  const computedItems = dto.items.map(item =>
    computeItem({
      metalRate:              new Decimal(item.metalRate),
      purityValue:            new Decimal(item.purityValue),
      purityBasis:            item.purityBasis,
      purityLabel:            item.purityLabel,
      grossWeight:            new Decimal(item.grossWeight),
      stoneWeight:            new Decimal(item.stoneWeight ?? '0'),
      makingCharges:          new Decimal(item.makingCharges),
      makingChargesType:      item.makingChargesType,
      stoneCharges:           new Decimal(item.stoneCharges ?? '0'),
      huid:                   item.huid ?? null,
      hallmarkingRatePerItem: hallmarkingRate,
    }),
  );

  // 4. Compute invoice totals
  const totals = computeInvoiceTotals(computedItems, taxType);

  // 5. Generate invoice number + sequence
  const { invoiceNumber, sequence, financialYear } =
    await this.sequenceService.next(orgId);

  // 6. Write everything in a single transaction
  return this.prisma.$transaction(async tx => {
    const invoice = await tx.invoice.create({
      data: {
        organizationId: orgId,
        customerId:     dto.customerId,
        createdById,
        invoiceNumber,
        sequence,
        financialYear,
        status:         'DRAFT',
        taxType,
        placeOfSupply:  dto.placeOfSupply,
        metalRateSource:dto.metalRateSource,
        metalRateDate:  dto.metalRateDate ? new Date(dto.metalRateDate) : null,
        invoiceDate:    dto.invoiceDate   ? new Date(dto.invoiceDate)   : new Date(),
        notes:          dto.notes,
        templateType:   dto.templateType ?? 'standard',
        companySnapshot: await this.snapshotService.org(orgId),
        buyerSnapshot:   await this.snapshotService.customer(dto.customerId),

        subtotal:               totals.subtotal,
        totalHallmarkingCharges:totals.totalHallmarkingCharges,
        taxableAmount:          totals.taxableAmount,
        cgstRate:               totals.cgstRate,
        sgstRate:               totals.sgstRate,
        igstRate:               totals.igstRate,
        cgstAmount:             totals.cgstAmount,
        sgstAmount:             totals.sgstAmount,
        igstAmount:             totals.igstAmount,
        roundOff:               totals.roundOff,
        totalAmount:            totals.grandTotal,
        paidAmount:             new Decimal(0),
      },
    });

    // Create items
    await tx.invoiceItem.createMany({
      data: dto.items.map((item, idx) => {
        const c = computedItems[idx];
        return {
          invoiceId:          invoice.id,
          organizationId:     orgId,
          slNo:               item.slNo,
          description:        item.description,
          hsnSac:             item.hsnSac,
          quantity:           new Decimal(item.quantity ?? '1'),
          unit:               item.unit ?? 'PCS',
          metalType:          item.metalType,
          metalRate:          new Decimal(item.metalRate),
          purityLabel:        item.purityLabel,
          purityValue:        new Decimal(item.purityValue),
          purityBasis:        item.purityBasis,
          effectiveRate:      c.effectiveRate,
          grossWeight:        new Decimal(item.grossWeight),
          stoneWeight:        new Decimal(item.stoneWeight ?? '0'),
          netWeight:          c.netWeight,
          makingCharges:      new Decimal(item.makingCharges),
          makingChargesType:  item.makingChargesType,
          makingChargesAmount:c.makingChargesAmount,
          stoneCharges:       c.stoneCharges,
          huid:               item.huid ?? null,
          isHallmarked:       c.isHallmarked,
          hallmarkingCharge:  c.hallmarkingCharge,
          unitPrice:          c.unitPrice,
          taxableAmount:      c.itemAmount,
          totalAmount:        c.itemAmount,
        };
      }),
    });

    return invoice;
  });
}
```

---

## Negotiation service (customer pays less — adjust making charges)

The customer refuses to pay ₹45,100 and offers ₹45,000. The correct approach is to back-solve
for the making charge rate that produces exactly that grand total. Do not create a credit note.
Do not create an udhar entry. Adjust the invoice in place (only valid while status = DRAFT).

```typescript
// src/invoice/invoice-negotiation.service.ts

import Decimal from 'decimal.js';

interface AdjustToAmountInput {
  invoiceId:    string;
  targetAmount: Decimal;
  note?:        string;
  approvedById: string;
}

interface AdjustmentPreview {
  targetAmount:            Decimal;
  requiredTaxableAmount:   Decimal;
  totalMakingReduction:    Decimal;
  newGrandTotal:           Decimal;
  roundOff:                Decimal;
  feasible:                boolean;
  reason?:                 string;
  minimumAchievableTotal?: Decimal;
  items: Array<{
    id:                       string;
    description:              string;
    originalMakingChargesAmt: Decimal;
    newMakingChargesAmt:      Decimal;
    newMakingChargesRate:     Decimal;
    newItemAmount:            Decimal;
  }>;
}

@Injectable()
export class InvoiceNegotiationService {
  constructor(private prisma: PrismaService) {}

  async preview(invoiceId: string, targetAmount: Decimal): Promise<AdjustmentPreview> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: true },
    });

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT invoices can be adjusted');
    }

    const currentGrand = new Decimal(invoice.totalAmount);

    if (targetAmount.gte(currentGrand)) {
      throw new BadRequestException(
        `Target ₹${targetAmount} must be less than current ₹${currentGrand}`,
      );
    }

    // Back-solve: targetAmount = taxableAmount × (1 + gstRate)
    const gstMultiplier = new Decimal(1).plus(
      new Decimal(invoice.cgstRate)
        .plus(invoice.sgstRate)
        .plus(invoice.igstRate)
        .div(100),
    );
    const requiredTaxableRaw  = targetAmount.div(gstMultiplier);
    const currentTaxable      = new Decimal(invoice.taxableAmount ?? invoice.subtotal);
    const totalReduction      = currentTaxable.minus(requiredTaxableRaw).toDecimalPlaces(4);

    // Only adjustable items are those with making charges > 0
    const adjustable = invoice.items.filter(
      i => i.makingChargesAmount && new Decimal(i.makingChargesAmount).gt(0),
    );

    const totalCurrentMaking = adjustable.reduce(
      (s, i) => s.plus(i.makingChargesAmount!),
      new Decimal(0),
    );

    // Floor check: can the reduction be absorbed?
    if (totalReduction.gt(totalCurrentMaking)) {
      // Compute minimum achievable total (all making charges = 0)
      const nonMakingSubtotal = invoice.items.reduce(
        (s, i) => s.plus(new Decimal(i.taxableAmount).minus(i.makingChargesAmount ?? 0)),
        new Decimal(0),
      );
      const minTaxable = nonMakingSubtotal.toDecimalPlaces(2);
      const minRaw     = minTaxable.mul(gstMultiplier);
      const minTotal   = minRaw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

      return {
        targetAmount, requiredTaxableAmount: requiredTaxableRaw.toDecimalPlaces(2),
        totalMakingReduction: totalReduction, newGrandTotal: currentGrand,
        roundOff: new Decimal(invoice.roundOff), feasible: false, items: [],
        minimumAchievableTotal: minTotal,
        reason: `Discount requires reducing making charges by ₹${totalReduction.toFixed(2)} ` +
                `but total making charges are only ₹${totalCurrentMaking.toFixed(2)}. ` +
                `Minimum achievable total is ₹${minTotal}.`,
      };
    }

    // Distribute reduction proportionally across items by makingChargesAmount
    const adjustedItems = adjustable.map(item => {
      const currentAmt = new Decimal(item.makingChargesAmount!);
      const share      = currentAmt.div(totalCurrentMaking);
      const reduction  = totalReduction.mul(share).toDecimalPlaces(4);
      const newAmt     = currentAmt.minus(reduction).toDecimalPlaces(4);

      const netWeight  = new Decimal(item.netWeight ?? item.grossWeight ?? 1);
      const newRate    = item.makingChargesType === 'PER_GRAM'
        ? newAmt.div(netWeight).toDecimalPlaces(4)
        : new Decimal(item.makingCharges ?? 0);

      const nonMaking  = new Decimal(item.taxableAmount).minus(currentAmt);
      const newItemAmt = nonMaking.plus(newAmt).toDecimalPlaces(4);

      return {
        id:                       item.id,
        description:              item.description,
        originalMakingChargesAmt: currentAmt,
        newMakingChargesAmt:      newAmt,
        newMakingChargesRate:     newRate,
        newItemAmount:            newItemAmt,
      };
    });

    // Recompute invoice totals with adjusted items
    const adjustedSubtotal = adjustedItems.reduce(
      (s, i) => s.plus(i.newItemAmount), new Decimal(0),
    );
    const unchangedSubtotal = invoice.items
      .filter(i => !i.makingChargesAmount || new Decimal(i.makingChargesAmount).eq(0))
      .reduce((s, i) => s.plus(i.taxableAmount), new Decimal(0));

    const newTaxable  = adjustedSubtotal.plus(unchangedSubtotal).toDecimalPlaces(2);
    const newCgst     = newTaxable.mul(invoice.cgstRate).div(100).toDecimalPlaces(2);
    const newSgst     = newTaxable.mul(invoice.sgstRate).div(100).toDecimalPlaces(2);
    const newIgst     = newTaxable.mul(invoice.igstRate).div(100).toDecimalPlaces(2);
    const rawGrand    = newTaxable.plus(newCgst).plus(newSgst).plus(newIgst);
    const newGrand    = rawGrand.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const newRoundOff = newGrand.minus(rawGrand).toDecimalPlaces(2);

    return {
      targetAmount,
      requiredTaxableAmount: newTaxable,
      totalMakingReduction:  totalReduction.toDecimalPlaces(2),
      newGrandTotal:         newGrand,
      roundOff:              newRoundOff,
      feasible:              true,
      items:                 adjustedItems,
    };
  }

  async commit(input: AdjustToAmountInput): Promise<void> {
    const preview = await this.preview(input.invoiceId, input.targetAmount);

    if (!preview.feasible) {
      throw new BadRequestException(preview.reason);
    }

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      include: { items: true },
    });

    await this.prisma.$transaction(async tx => {
      // Snapshot original totals on first negotiation only
      if (!invoice.isNegotiated) {
        await tx.invoice.update({
          where: { id: input.invoiceId },
          data: {
            isNegotiated:          true,
            negotiatedBy:          input.approvedById,
            negotiationNote:       input.note,
            originalSubtotal:      invoice.subtotal,
            originalTaxableAmount: invoice.taxableAmount ?? invoice.subtotal,
            originalCgstAmount:    invoice.cgstAmount,
            originalSgstAmount:    invoice.sgstAmount,
            originalIgstAmount:    invoice.igstAmount,
            originalGrandTotal:    invoice.totalAmount,
          },
        });
      }

      // Update each adjusted item
      for (const adj of preview.items) {
        const original = invoice.items.find(i => i.id === adj.id)!;
        await tx.invoiceItem.update({
          where: { id: adj.id },
          data: {
            // Snapshot originals (only first negotiation)
            originalMakingCharges:       original.originalMakingCharges ?? original.makingCharges,
            originalMakingChargesAmount: original.originalMakingChargesAmount ?? original.makingChargesAmount,
            originalItemAmount:          original.originalItemAmount ?? original.taxableAmount,
            // Apply adjusted values
            makingCharges:               adj.newMakingChargesRate,
            makingChargesAmount:         adj.newMakingChargesAmt,
            taxableAmount:               adj.newItemAmount,
            totalAmount:                 adj.newItemAmount,
          },
        });
      }

      // Update invoice totals
      const newCgst = preview.requiredTaxableAmount
        .mul(invoice.cgstRate).div(100).toDecimalPlaces(2);
      const newSgst = preview.requiredTaxableAmount
        .mul(invoice.sgstRate).div(100).toDecimalPlaces(2);
      const newIgst = preview.requiredTaxableAmount
        .mul(invoice.igstRate).div(100).toDecimalPlaces(2);

      await tx.invoice.update({
        where: { id: input.invoiceId },
        data: {
          subtotal:       preview.requiredTaxableAmount,
          taxableAmount:  preview.requiredTaxableAmount,
          cgstAmount:     newCgst,
          sgstAmount:     newSgst,
          igstAmount:     newIgst,
          roundOff:       preview.roundOff,
          totalAmount:    preview.newGrandTotal,
          discountAmount: new Decimal(invoice.totalAmount)
            .minus(preview.newGrandTotal).toDecimalPlaces(2),
        },
      });
    });
  }
}
```

---

## Reporting service

```typescript
// src/reporting/reporting.service.ts

interface ReportFilters {
  organizationId: string;
  from:           Date;
  to:             Date;
  status?:        'CONFIRMED' | 'DRAFT' | 'CANCELLED';
}

@Injectable()
export class ReportingService {
  constructor(private prisma: PrismaService) {}

  // GST summary
  async gstSummary(f: ReportFilters) {
    return this.prisma.invoice.aggregate({
      where: {
        organizationId: f.organizationId,
        status:         f.status ?? 'CONFIRMED',
        deletedAt:      null,
        invoiceDate:    { gte: f.from, lte: f.to },
      },
      _sum:   { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, totalAmount: true },
      _count: { id: true },
    });
  }

  // GST split: intra-state vs inter-state
  async gstByTaxType(f: ReportFilters) {
    return this.prisma.invoice.groupBy({
      by: ['taxType'],
      where: { organizationId: f.organizationId, status: f.status ?? 'CONFIRMED', deletedAt: null, invoiceDate: { gte: f.from, lte: f.to } },
      _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
      _count: { id: true },
    });
  }

  // Making charges collected — by metal type and charge type
  async makingChargesSummary(f: ReportFilters) {
    return this.prisma.$queryRaw<Array<{
      metalType: string; makingChargesType: string; total: string; weight: string;
    }>>`
      SELECT ii."metalType", ii."makingChargesType",
             SUM(ii."makingChargesAmount") AS total,
             SUM(ii."netWeight")           AS weight
      FROM "InvoiceItem" ii
      JOIN "Invoice" i ON i.id = ii."invoiceId"
      WHERE ii."organizationId" = ${f.organizationId}
        AND i.status = ${f.status ?? 'CONFIRMED'}
        AND i."deletedAt" IS NULL
        AND i."invoiceDate" >= ${f.from} AND i."invoiceDate" <= ${f.to}
      GROUP BY ii."metalType", ii."makingChargesType"
      ORDER BY ii."metalType", ii."makingChargesType"
    `;
  }

  // Metal weight sold — by metal + purity
  async metalWeightSummary(f: ReportFilters) {
    return this.prisma.$queryRaw<Array<{
      metalType: string; purityLabel: string; purityValue: string;
      grossWeight: string; netWeight: string; metalValue: string; itemCount: string;
    }>>`
      SELECT ii."metalType", ii."purityLabel", ii."purityValue",
             SUM(ii."grossWeight")                    AS "grossWeight",
             SUM(ii."netWeight")                      AS "netWeight",
             SUM(ii."effectiveRate" * ii."netWeight") AS "metalValue",
             COUNT(ii.id)                             AS "itemCount"
      FROM "InvoiceItem" ii
      JOIN "Invoice" i ON i.id = ii."invoiceId"
      WHERE ii."organizationId" = ${f.organizationId}
        AND i.status = ${f.status ?? 'CONFIRMED'}
        AND i."deletedAt" IS NULL
        AND i."invoiceDate" >= ${f.from} AND i."invoiceDate" <= ${f.to}
      GROUP BY ii."metalType", ii."purityLabel", ii."purityValue"
      ORDER BY ii."metalType", ii."purityValue" DESC
    `;
  }

  // Cash / bank / UPI collected — grouped by payment mode
  async paymentModeSummary(f: ReportFilters) {
    return this.prisma.invoicePayment.groupBy({
      by: ['mode'],
      where: {
        organizationId: f.organizationId,
        paidAt:         { gte: f.from, lte: f.to },
        invoice:        { status: f.status ?? 'CONFIRMED', deletedAt: null },
      },
      _sum:   { amount: true },
      _count: { id: true },
    });
  }

  // Hallmarking charges collected
  async hallmarkingSummary(f: ReportFilters) {
    const [totals, itemCount] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { organizationId: f.organizationId, status: f.status ?? 'CONFIRMED', deletedAt: null, invoiceDate: { gte: f.from, lte: f.to } },
        _sum: { totalHallmarkingCharges: true },
      }),
      this.prisma.invoiceItem.count({
        where: { organizationId: f.organizationId, isHallmarked: true, invoice: { status: f.status ?? 'CONFIRMED', deletedAt: null, invoiceDate: { gte: f.from, lte: f.to } } },
      }),
    ]);
    return { totalHallmarkingCharges: totals._sum.totalHallmarkingCharges, hallmarkedItemCount: itemCount };
  }

  // Daily dashboard — all five rolled up
  async dailySummary(f: ReportFilters) {
    return this.prisma.$queryRaw<Array<{
      date: Date; invoiceCount: string; subtotal: string;
      totalGST: string; grandTotal: string; cashCollected: string; bankCollected: string;
    }>>`
      SELECT
        DATE(i."invoiceDate")                                      AS date,
        COUNT(DISTINCT i.id)                                       AS "invoiceCount",
        SUM(i."subtotal")                                          AS subtotal,
        SUM(i."cgstAmount" + i."sgstAmount" + i."igstAmount")     AS "totalGST",
        SUM(i."totalAmount")                                       AS "grandTotal",
        COALESCE(SUM(CASE WHEN p.mode = 'CASH'   THEN p.amount ELSE 0 END), 0) AS "cashCollected",
        COALESCE(SUM(CASE WHEN p.mode NOT IN ('CASH','CREDIT') THEN p.amount ELSE 0 END), 0) AS "bankCollected"
      FROM "Invoice" i
      LEFT JOIN "InvoicePayment" p ON p."invoiceId" = i.id
      WHERE i."organizationId" = ${f.organizationId}
        AND i.status = ${f.status ?? 'CONFIRMED'}
        AND i."deletedAt" IS NULL
        AND i."invoiceDate" >= ${f.from} AND i."invoiceDate" <= ${f.to}
      GROUP BY DATE(i."invoiceDate")
      ORDER BY DATE(i."invoiceDate") ASC
    `;
  }
}
```

---

## Frontend: what to compute vs what to display

The frontend must never post a calculated field. What the frontend may do:

**Live preview (display only, not posted):**
```
User types: metalRate=7000, purity=22K, grossWeight=8.5, stoneWeight=0, making=180 PER_GRAM
Frontend shows:
  Effective rate:  7000 × (22/24) = ₹6,416.67/gm   ← shown, not posted
  Net weight:      8.5 − 0 = 8.5 gm                 ← shown, not posted
  Metal value:     6,416.67 × 8.5 = ₹54,541.67      ← shown, not posted
  Making charges:  180 × 8.5 = ₹1,530               ← shown, not posted
  Hallmarking:     ₹45 (if HUID entered)             ← shown, not posted
  Estimated total: ₹56,116.67                        ← shown, not posted
```

**What is actually posted:**
```json
{
  "metalType": "GOLD",
  "metalRate": "7000",
  "purityLabel": "22K",
  "purityValue": "22",
  "purityBasis": 24,
  "grossWeight": "8.500",
  "stoneWeight": "0",
  "makingCharges": "180",
  "makingChargesType": "PER_GRAM",
  "stoneCharges": "0",
  "huid": "AA112233",
  "description": "Gold chain 22K",
  "hsnSac": "7113",
  "slNo": 1
}
```

After the item is saved, the frontend updates its display from the backend response — not from its own calculation.

---

## Negotiation UX

Show "Adjust to customer price" button on the invoice review screen while status = DRAFT.

On click, open a modal:
1. User enters target amount (e.g. ₹45,000)
2. Call `GET /invoices/:id/negotiate/preview?targetAmount=45000`
3. Show breakdown: which items' making charges change, by how much, what the new line totals are, new GST, new grand total
4. If not feasible, show minimum achievable total and reason
5. User confirms → call `POST /invoices/:id/negotiate/commit`

The printed invoice shows the adjusted values only. Original values (the `original*` fields) are internal audit data and must never appear on any customer-facing document.

---

## Invoice status transitions

```
DRAFT → CONFIRMED   (on explicit confirm action, after payment recorded)
DRAFT → CANCELLED   (before confirmation)
CONFIRMED → CANCELLED  (not allowed — issue a credit note instead)
```

Only DRAFT invoices can be:
- Edited (items added, removed, updated)
- Negotiated (making charges adjusted)
- Deleted (soft delete: set deletedAt)

CONFIRMED invoices are immutable. If a confirmed invoice is wrong, cancel it and raise a new one.

---

## Old gold exchange

When a customer pays partly in old jewellery, record it as:

```typescript
{ mode: 'OLD_GOLD', amount: 12000, reference: '14K ring 5g @ ₹2400/gm', notes: '...' }
```

The valuation of the old gold (weight × purity × buyback rate) is computed outside the invoice
flow — either in a separate `OldGoldPurchase` screen or noted in the reference field. Do not
create an InvoiceItem for the old gold on the sale invoice.

---

## Silver items — purity basis

Silver uses millesimal fineness, not karats. Set `purityBasis = 1000`.

| Purity label | purityValue | purityBasis |
|---|---|---|
| 999 fine    | 999 | 1000 |
| 925 silver  | 925 | 1000 |
| 800 silver  | 800 | 1000 |

The formula `effectiveRate = metalRate × (purityValue / purityBasis)` works identically.
`metalRate` for silver is ₹/gm at 999 fine.

---

## Things that must never happen

- Frontend posts `effectiveRate`, `itemAmount`, `subtotal`, `cgstAmount`, or `grandTotal`
  (these are derived and stored by the backend only)
- Any monetary field stored as a JS `number` or `float` — always `Decimal` / `NUMERIC`
- Hallmarking charge hardcoded anywhere in application code — always read from `SystemConfig`
- A confirmed invoice mutated in place — cancel and replace
- Reporting queries that run without a `status = 'CONFIRMED'` filter (drafts and cancelled
  invoices must never appear in financial reports)
- `makingChargesAmount` left null on any new InvoiceItem — this field is required for the
  negotiation back-solver and for making charge reportss