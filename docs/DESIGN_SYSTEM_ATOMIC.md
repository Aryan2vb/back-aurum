# Udhar Management System - Atomic Design System

**Design Reference:** Attio CRM (clean, calm, insight-driven)  
**Methodology:** Atomic Design  
**Target Users:** Jewelry shop owners and staff

---

## Design Tokens (Foundation)

### Colors
```typescript
// Primary Palette
primary: {
  50: '#f0f9ff',   // Lightest blue
  100: '#e0f2fe',
  500: '#0ea5e9',  // Primary blue
  600: '#0284c7',
  900: '#0c4a6e'
}

// Status Colors (Calm, Non-Alarming)
status: {
  active: '#10b981',      // Green (subtle)
  overdue: '#f59e0b',     // Amber (not red)
  paid: '#6b7280',        // Gray
  cancelled: '#9ca3af'    // Light gray
}

// Risk Levels (Subtle Indicators)
risk: {
  low: '#10b981',         // Green
  medium: '#f59e0b',      // Amber
  high: '#ef4444',        // Red (but used sparingly)
  veryHigh: '#dc2626'     // Darker red (rare)
}

// Behavior Tags
behavior: {
  clear: '#10b981',       // Green
  regular: '#3b82f6',     // Blue
  delayed: '#f59e0b',     // Amber
  risky: '#ef4444'        // Red
}

// Neutral Palette
neutral: {
  50: '#f9fafb',
  100: '#f3f4f6',
  200: '#e5e7eb',
  300: '#d1d5db',
  400: '#9ca3af',
  500: '#6b7280',
  600: '#4b5563',
  700: '#374151',
  800: '#1f2937',
  900: '#111827'
}
```

### Typography
```typescript
fontFamily: {
  sans: ['Inter', 'system-ui', 'sans-serif'],
  mono: ['JetBrains Mono', 'monospace']
}

fontSize: {
  xs: '0.75rem',    // 12px
  sm: '0.875rem',   // 14px
  base: '1rem',     // 16px
  lg: '1.125rem',   // 18px
  xl: '1.25rem',    // 20px
  '2xl': '1.5rem',  // 24px
  '3xl': '1.875rem' // 30px
}

fontWeight: {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700
}
```

### Spacing
```typescript
spacing: {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem'    // 64px
}
```

### Shadows
```typescript
shadow: {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  none: 'none'
}
```

---

## 1. ATOMS

### 1.1 Amount Display
**Purpose:** Display money amounts in human-readable format

**Props:**
```typescript
interface AmountProps {
  value: number | string;      // Decimal amount
  size?: 'sm' | 'md' | 'lg';   // Visual size
  emphasis?: boolean;            // Bold/colored for emphasis
  showCurrency?: boolean;        // Show ₹ symbol
  variant?: 'default' | 'positive' | 'negative' | 'neutral';
}
```

**Variants:**
- `default`: Black/gray text
- `positive`: Green (for payments received)
- `negative`: Subtle red (for outstanding, not alarming)
- `neutral`: Gray (for paid/completed)

**Examples:**
- `₹50,000` (default, medium emphasis)
- `₹1,25,000` (large, bold for total outstanding)
- `+₹10,000` (positive, green for payment)
- `₹40,000` (neutral, gray for paid amount)

**Implementation Notes:**
- Always format with Indian number system (lakhs, crores)
- Use monospace font for alignment in tables
- Support both compact (₹50K) and full (₹50,000) formats

---

### 1.2 Date Display
**Purpose:** Show dates in human-readable, relative format

**Props:**
```typescript
interface DateDisplayProps {
  date: Date | string;
  format?: 'relative' | 'absolute' | 'both';
  showTime?: boolean;
  size?: 'sm' | 'md' | 'lg';
}
```

**Formats:**
- `relative`: "3 days ago", "in 2 days", "today", "yesterday"
- `absolute`: "15 Jan 2024"
- `both`: "15 Jan 2024 (3 days ago)"

**Examples:**
- Due date: "Due in 3 days" or "Overdue by 5 days"
- Payment date: "Paid 2 days ago"
- Credit date: "15 Jan 2024"

**Implementation Notes:**
- Prefer relative for recent dates (< 7 days)
- Use absolute for older dates
- Highlight overdue dates subtly (amber, not red)

---

### 1.3 Status Badge
**Purpose:** Visual indicator of credit/customer status

**Props:**
```typescript
interface StatusBadgeProps {
  status: 'ACTIVE' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'INACTIVE';
  size?: 'sm' | 'md';
  variant?: 'solid' | 'outline' | 'subtle';
}
```

**Visual Design:**
- `ACTIVE`: Green dot + "Active" (subtle green background)
- `PAID`: Gray dot + "Paid" (neutral gray)
- `OVERDUE`: Amber dot + "Overdue" (amber, not red)
- `CANCELLED`: Light gray dot + "Cancelled"
- `INACTIVE`: Gray dot + "Inactive"

**Implementation Notes:**
- Use dot + text, not just color
- Subtle background, not bright
- Accessible (WCAG AA contrast)

---

### 1.4 Risk Indicator
**Purpose:** Show customer risk level subtly

**Props:**
```typescript
interface RiskIndicatorProps {
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  showLabel?: boolean;
  size?: 'sm' | 'md';
}
```

**Visual Design:**
- Small colored dot (green/amber/red)
- Optional text label: "Low Risk", "Medium Risk", etc.
- Never use alarming red banners
- Subtle, informational only

**Implementation Notes:**
- Tooltip on hover for more context
- Not blocking or warning
- Used in decision support panels

---

### 1.5 Behavior Tag
**Purpose:** Show customer payment behavior pattern

**Props:**
```typescript
interface BehaviorTagProps {
  behavior: 'CLEAR' | 'REGULAR' | 'DELAYED' | 'RISKY';
  size?: 'sm' | 'md';
}
```

**Visual Design:**
- Small badge with icon + text
- `CLEAR`: Green, "Clear" (no active credits)
- `REGULAR`: Blue, "Regular" (active, none overdue)
- `DELAYED`: Amber, "Delayed" (overdue < 30 days)
- `RISKY`: Red, "Risky" (overdue > 30 days)

**Implementation Notes:**
- Informational, not judgmental
- Used in customer summary cards
- Helps decision-making, doesn't block actions

---

### 1.6 Contact Icon
**Purpose:** Show preferred contact method

**Props:**
```typescript
interface ContactIconProps {
  method: 'CALL' | 'WHATSAPP' | 'SMS' | 'VISIT' | 'EMAIL';
  size?: 'sm' | 'md' | 'lg';
  clickable?: boolean;
}
```

**Visual Design:**
- Icon representing method (phone, WhatsApp, etc.)
- Clickable if `clickable={true}` (opens dialer/app)
- Hover state shows action

**Implementation Notes:**
- Use standard icons (Phone, Message, etc.)
- Support deep linking (tel:, whatsapp:)
- Show tooltip on hover

---

### 1.7 Payment Method Badge
**Purpose:** Display payment method used

**Props:**
```typescript
interface PaymentMethodBadgeProps {
  method: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' | 'OTHER';
  size?: 'sm' | 'md';
}
```

**Visual Design:**
- Small badge with icon + text
- Color-coded by method type
- Used in payment history rows

---

### 1.8 Progress Bar
**Purpose:** Show payment progress for credit

**Props:**
```typescript
interface ProgressBarProps {
  paid: number;
  total: number;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}
```

**Visual Design:**
- Horizontal bar showing paid/total
- Green for paid portion
- Gray for remaining
- Optional: "₹40,000 / ₹50,000" label

**Implementation Notes:**
- Smooth animation on update
- Accessible (ARIA labels)
- Used in credit cards

---

### 1.9 Avatar
**Purpose:** Show customer identity

**Props:**
```typescript
interface AvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  status?: 'online' | 'offline';
}
```

**Visual Design:**
- Initials if no image
- Circular with subtle border
- Optional status dot

---

### 1.10 Icon Button
**Purpose:** Action buttons with icons

**Props:**
```typescript
interface IconButtonProps {
  icon: ReactNode;
  label: string;              // For accessibility
  onClick: () => void;
  variant?: 'primary' | 'ghost' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
}
```

**Visual Design:**
- Icon only, label in tooltip
- Hover state shows background
- Accessible (ARIA labels)

---

## 2. MOLECULES

### 2.1 Credit Summary Card
**Purpose:** Compact view of a credit with key info

**Composition:**
- Avatar (customer)
- Customer name (link)
- Item summary
- Amount display (total + remaining)
- Progress bar
- Due date / status badge
- Quick actions (record payment, view details)

**Props:**
```typescript
interface CreditSummaryCardProps {
  credit: {
    id: string;
    customer: { id: string; name: string; avatar?: string };
    itemSummary?: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    expectedDueDate?: Date;
    status: 'ACTIVE' | 'PAID' | 'OVERDUE' | 'CANCELLED';
    daysOverdue?: number;
  };
  onClick?: () => void;
  onRecordPayment?: () => void;
  variant?: 'compact' | 'detailed';
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ [Avatar] Ramesh Kumar               │
│         Gold Necklace 22K, 45g      │
│         ₹50,000 / ₹40,000 remaining │
│         [Progress Bar: 80%]          │
│         Due in 3 days  [Status]      │
│         [Record Payment] [View]      │
└─────────────────────────────────────┘
```

**Variants:**
- `compact`: Minimal info, used in lists
- `detailed`: More context, used in detail views

---

### 2.2 Payment Row
**Purpose:** Display a single payment transaction

**Composition:**
- Date display
- Amount (positive, green)
- Payment method badge
- Collected by (optional)
- Reference number (optional, if UPI/bank)
- Notes (optional, expandable)

**Props:**
```typescript
interface PaymentRowProps {
  payment: {
    id: string;
    amount: number;
    transactionDate: Date;
    paymentMethod: string;
    referenceNumber?: string;
    collectedBy?: string;
    notes?: string;
  };
  variant?: 'compact' | 'detailed';
  showActions?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ 2 days ago    +₹10,000  [UPI]       │
│ Reference: UPI123456                │
│ Collected by: Rajesh                │
│ [Expand for notes]                  │
└─────────────────────────────────────┘
```

---

### 2.3 Reminder Chip
**Purpose:** Compact reminder indicator

**Composition:**
- Customer name (truncated)
- Contact icon (clickable)
- Remaining amount
- Days until due / days overdue
- Quick action (mark done, record payment)

**Props:**
```typescript
interface ReminderChipProps {
  reminder: {
    creditId: string;
    customer: { name: string; phone: string; preferredMethod: string };
    remainingAmount: number;
    expectedDueDate: Date;
    daysOverdue?: number;
    nextReminderDate: Date;
  };
  onContact?: () => void;
  onRecordPayment?: () => void;
  onMarkDone?: () => void;
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ Ramesh K.  [📞]  ₹40,000           │
│ Due in 2 days                       │
│ [Call] [Record Payment] [Done]      │
└─────────────────────────────────────┘
```

---

### 2.4 Risk Badge
**Purpose:** Show risk level with context

**Composition:**
- Risk indicator (atom)
- Risk level text
- Optional: Tooltip with explanation

**Props:**
```typescript
interface RiskBadgeProps {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  showDetails?: boolean;
  details?: {
    overdueCount: number;
    oldestUnpaidDays: number;
    totalActiveUdhar: number;
  };
}
```

**Visual Design:**
- Small badge with colored dot
- Text: "Low Risk", "Medium Risk", etc.
- Tooltip shows breakdown on hover

---

### 2.5 Customer Summary Card
**Purpose:** Quick view of customer credit status

**Composition:**
- Avatar + name
- Contact info (phone, preferred method)
- Total active Udhar (prominent)
- Behavior tag
- Risk indicator
- Quick stats (open credits, last payment)
- Quick actions

**Props:**
```typescript
interface CustomerSummaryCardProps {
  customer: {
    id: string;
    name: string;
    code: string;
    avatar?: string;
    phone: string;
    preferredContactMethod: string;
  };
  summary: {
    totalActiveUdhar: number;
    openCreditsCount: number;
    behaviorTag: string;
    riskLevel: string;
    lastPaymentDate?: Date;
    oldestUnpaidDays?: number;
  };
  onClick?: () => void;
  onRecordPayment?: () => void;
  onCreateCredit?: () => void;
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ [Avatar] Ramesh Kumar  C-000123     │
│         📞 9876543210                │
│         ₹75,000 active Udhar         │
│         [Regular] [Low Risk]         │
│         3 open credits               │
│         Last paid: 5 days ago        │
│         [New Udhar] [Record Payment] │
└─────────────────────────────────────┘
```

---

### 2.6 Metric Card
**Purpose:** Display a single metric with context

**Composition:**
- Label
- Value (large, prominent)
- Optional: Trend indicator (↑↓)
- Optional: Subtext

**Props:**
```typescript
interface MetricCardProps {
  label: string;
  value: number | string;
  format?: 'currency' | 'number' | 'percentage';
  trend?: {
    value: number;
    direction: 'up' | 'down';
    period: string;
  };
  subtext?: string;
  size?: 'sm' | 'md' | 'lg';
}
```

**Layout:**
```
┌─────────────────────┐
│ Total Outstanding    │
│ ₹12,50,000          │
│ ↑ 5% this month      │
│ 45 active credits    │
└─────────────────────┘
```

---

### 2.7 Search Bar
**Purpose:** Global search with filters

**Composition:**
- Search input
- Filter button (shows active filter count)
- Clear button (when search active)

**Props:**
```typescript
interface SearchBarProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onFilterClick?: () => void;
  activeFilterCount?: number;
  suggestions?: string[];
}
```

---

## 3. ORGANISMS

### 3.1 Customer Udhar Snapshot
**Purpose:** Complete credit overview for a customer (decision support)

**Composition:**
- Customer summary card (molecule)
- Risk badge (molecule)
- Behavior tag (molecule)
- Key metrics (total active, open credits, last payment)
- Recent credits list (compact)
- Quick actions panel

**Props:**
```typescript
interface CustomerUdharSnapshotProps {
  customerId: string;
  onNewCredit?: () => void;
  onViewAll?: () => void;
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ Customer Summary Card               │
│ ─────────────────────────────────── │
│ Risk: [Low]  Behavior: [Regular]   │
│ ─────────────────────────────────── │
│ ₹75,000 active Udhar                │
│ 3 open credits                      │
│ Last paid: 5 days ago               │
│ ─────────────────────────────────── │
│ Recent Credits:                     │
│ • Gold Necklace - ₹40,000 remaining │
│ • Gold Ring - ₹25,000 remaining     │
│ • Gold Chain - ₹10,000 remaining    │
│ ─────────────────────────────────── │
│ [New Udhar] [View All] [Record Pay]│
└─────────────────────────────────────┘
```

**Use Cases:**
- Shown when creating new credit (decision support)
- Customer detail page overview tab
- Quick reference in customer list

---

### 3.2 Credit Timeline
**Purpose:** Visual timeline of credit lifecycle

**Composition:**
- Credit creation event
- Payment events (chronological)
- Reminder events
- Status changes
- Notes/updates

**Props:**
```typescript
interface CreditTimelineProps {
  creditId: string;
  showPayments?: boolean;
  showReminders?: boolean;
  showNotes?: boolean;
  variant?: 'compact' | 'detailed';
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ Timeline                            │
│                                     │
│ ● Created                           │
│   15 Jan 2024                       │
│   ₹50,000 - Gold Necklace           │
│                                     │
│ ● Payment                           │
│   20 Jan 2024                       │
│   +₹10,000 (Cash)                   │
│                                     │
│ ● Payment                           │
│   25 Jan 2024                       │
│   +₹20,000 (UPI)                    │
│                                     │
│ ● Reminder Sent                     │
│   28 Jan 2024                       │
│   WhatsApp message                  │
│                                     │
│ ● Status: Overdue                   │
│   15 Feb 2024                       │
│   (5 days overdue)                 │
└─────────────────────────────────────┘
```

**Visual Design:**
- Vertical timeline with connecting line
- Icons for event types
- Expandable details
- Smooth scroll to latest

---

### 3.3 Reminder List
**Purpose:** Organized list of due reminders

**Composition:**
- Grouped by urgency (Today, This Week, Next Week, Overdue)
- Reminder chips (molecules)
- Empty states
- Bulk actions (mark all done, etc.)

**Props:**
```typescript
interface ReminderListProps {
  reminders: Reminder[];
  groupBy?: 'urgency' | 'customer' | 'date';
  onReminderClick?: (reminder: Reminder) => void;
  onBulkAction?: (action: string, reminderIds: string[]) => void;
  timeRange?: number; // days
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ Reminders (Next 7 Days)             │
│ ─────────────────────────────────── │
│ Today (2)                           │
│ [Reminder Chip]                     │
│ [Reminder Chip]                     │
│                                     │
│ This Week (5)                       │
│ [Reminder Chip]                     │
│ [Reminder Chip]                     │
│ ...                                 │
│                                     │
│ Overdue (3)                         │
│ [Reminder Chip]                     │
│ ...                                 │
└─────────────────────────────────────┘
```

**Grouping Logic:**
- Today: Due today
- This Week: Due in next 7 days
- Next Week: Due in 8-14 days
- Overdue: Past due date (grouped by days: 0-30, 30-60, 60+)

---

### 3.4 Create Credit Decision Panel
**Purpose:** Decision support when creating new credit

**Composition:**
- Customer search/selection
- Customer Udhar Snapshot (organism)
- Credit form
- Summary preview

**Props:**
```typescript
interface CreateCreditDecisionPanelProps {
  customerId?: string;
  onCustomerSelect?: (customerId: string) => void;
  onSubmit?: (creditData: CreditFormData) => void;
  onCancel?: () => void;
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ Create New Udhar                   │
│ ─────────────────────────────────── │
│ Customer: [Search...]               │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Customer Summary                │ │
│ │ ₹75,000 active                  │ │
│ │ [Regular] [Low Risk]            │ │
│ │ 3 open credits                  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Amount: [₹______]                   │
│ Item: [________________]            │
│ Due Date: [Date Picker]             │
│ Reminder: [Weekly ▼]                │
│ Notes: [________________]           │
│                                     │
│ [Cancel] [Create Udhar]             │
└─────────────────────────────────────┘
```

**UX Flow:**
1. Search/select customer
2. Customer snapshot appears (decision support)
3. Fill credit details
4. Preview summary
5. Create

**Key Principle:**
- Show information, don't block
- Support decision, don't automate it

---

### 3.5 Payment History Table
**Purpose:** List all payments for a credit

**Composition:**
- Payment rows (molecules)
- Sort/filter controls
- Total summary
- Empty state

**Props:**
```typescript
interface PaymentHistoryTableProps {
  creditId: string;
  payments: Payment[];
  onPaymentClick?: (payment: Payment) => void;
  onEdit?: (payment: Payment) => void;
  onDelete?: (payment: Payment) => void;
  showActions?: boolean;
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ Payment History                     │
│ ─────────────────────────────────── │
│ Date        Amount    Method        │
│ ─────────────────────────────────── │
│ [Payment Row]                       │
│ [Payment Row]                       │
│ [Payment Row]                       │
│ ─────────────────────────────────── │
│ Total Paid: ₹40,000                 │
│ Remaining: ₹10,000                  │
└─────────────────────────────────────┘
```

**Alternative (Card View):**
- Stack payment rows vertically
- More mobile-friendly
- Better for small screens

---

### 3.6 Credit Filters Panel
**Purpose:** Filter and sort credits list

**Composition:**
- Status filters (chips)
- Customer filter (search/select)
- Date range picker
- Sort dropdown
- Active filter tags
- Clear all button

**Props:**
```typescript
interface CreditFiltersPanelProps {
  filters: CreditFilters;
  onFiltersChange: (filters: CreditFilters) => void;
  onClear?: () => void;
}
```

**Layout:**
```
┌─────────────────────────────────────┐
│ Filters                             │
│ ─────────────────────────────────── │
│ Status: [Active] [Overdue] [Paid]   │
│ Customer: [Search...]               │
│ Date Range: [From] [To]             │
│ Sort: [Due Date ▼]                  │
│                                     │
│ Active: [Active] [Customer: Ramesh]  │
│ [Clear All]                          │
└─────────────────────────────────────┘
```

---

## 4. TEMPLATES

### 4.1 Customer Profile Template
**Purpose:** Layout for customer detail page

**Structure:**
```
┌─────────────────────────────────────────────┐
│ [Header: Name, Code, Contact]               │
│ ───────────────────────────────────────────│
│ [Tabs: Overview | Udhar | History | Details]│
│ ───────────────────────────────────────────│
│                                             │
│ [Main Content Area]                         │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │                  │ │ [Sidebar]        │  │
│ │ Tab Content     │ │ Quick Actions    │  │
│ │                 │ │ Summary          │  │
│ │                 │ │                  │  │
│ └──────────────────┘ └──────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

**Responsive:**
- Desktop: Sidebar on right (30% width)
- Tablet: Sidebar below content
- Mobile: Sidebar in drawer

**Tabs:**
- **Overview:** Customer Udhar Snapshot
- **Udhar:** List of all credits
- **History:** Timeline of all interactions
- **Details:** Contact, location, documents, etc.

---

### 4.2 Credit Detail Template
**Purpose:** Layout for single credit view

**Structure:**
```
┌─────────────────────────────────────────────┐
│ [Header: Customer Link, Item, Status]       │
│ ───────────────────────────────────────────│
│                                             │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │ Credit Details   │ │ Payment History  │  │
│ │                  │ │                  │  │
│ │ • Amounts        │ │ [Payment Rows]   │  │
│ │ • Dates          │ │                  │  │
│ │ • Item Info      │ │                  │  │
│ │ • Reminder       │ │                  │  │
│ │                  │ │                  │  │
│ │ [Timeline]       │ │ [Record Payment] │  │
│ │                  │ │                  │  │
│ └──────────────────┘ └──────────────────┘  │
│                                             │
│ [Actions Bar: Edit, Delete, etc.]           │
└─────────────────────────────────────────────┘
```

**Responsive:**
- Desktop: Two columns
- Mobile: Stacked vertically

---

### 4.3 Reminders View Template
**Purpose:** Layout for reminders management

**Structure:**
```
┌─────────────────────────────────────────────┐
│ [Header: Time Range Selector, Stats]        │
│ ───────────────────────────────────────────│
│                                             │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │ Reminder List    │ │ [Sidebar]        │  │
│ │                  │ │ Quick Stats      │  │
│ │ [Today Group]    │ │                  │  │
│ │ [This Week]      │ │ Filters          │  │
│ │ [Next Week]      │ │                  │  │
│ │ [Overdue]        │ │                  │  │
│ │                  │ │                  │  │
│ └──────────────────┘ └──────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

**Grouping:**
- Collapsible groups
- Count badges on group headers
- Empty states for each group

---

### 4.4 Insights / Dashboard Template
**Purpose:** Layout for owner overview/dashboard

**Structure:**
```
┌─────────────────────────────────────────────┐
│ [Header: Date Range, Export]                │
│ ───────────────────────────────────────────│
│                                             │
│ [Metric Cards Row]                          │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐      │
│ │Total │ │Active│ │Overdue│ │Recov.│      │
│ └──────┘ └──────┘ └──────┘ └──────┘      │
│                                             │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │ Trends Chart     │ │ Overdue Buckets   │  │
│ │                  │ │                  │  │
│ │ [Line/Bar Chart] │ │ [Bar Chart]      │  │
│ │                  │ │                  │  │
│ └──────────────────┘ └──────────────────┘  │
│                                             │
│ [Top Debtors List]                          │
│ [Recent Activity]                           │
│                                             │
└─────────────────────────────────────────────┘
```

**Sections:**
1. Key metrics (cards)
2. Charts (trends, distributions)
3. Lists (top debtors, recent activity)
4. Insights (patterns, recommendations)

---

### 4.5 List + Detail Template
**Purpose:** Master-detail layout (Customers, Credits)

**Structure:**
```
┌─────────────────────────────────────────────┐
│ [Header: Search, Filters, Actions]          │
│ ───────────────────────────────────────────│
│                                             │
│ ┌──────────────┐ ┌──────────────────────┐ │
│ │ List Panel   │ │ Detail Panel         │ │
│ │ (30%)        │ │ (70%)                │ │
│ │              │ │                      │ │
│ │ [Item]       │ │ [Selected Item View]  │ │
│ │ [Item]       │ │                      │ │
│ │ [Item]       │ │                      │ │
│ │              │ │                      │ │
│ └──────────────┘ └──────────────────────┘ │
│                                             │
└─────────────────────────────────────────────┘
```

**Responsive:**
- Desktop: Side-by-side
- Tablet: Stacked, detail below
- Mobile: Full-screen detail, back button

**Empty States:**
- No selection: Show placeholder in detail panel
- No items: Show empty state in list panel

---

## 5. PAGES

### 5.1 Customer List Page
**Purpose:** Find and access customers

**Composition:**
- List + Detail Template
- Search bar (molecule)
- Customer summary cards (molecules) in list
- Customer detail view in detail panel
- Filters panel (organism)

**Key Features:**
- Quick search (name, phone, code)
- Filter by status, location, credit status
- Recent customers highlighted
- Click customer to view detail
- Quick actions (new Udhar, record payment)

**Empty States:**
- No customers: "Add your first customer"
- No search results: "No customers found"

**Responsive:**
- Desktop: Split view
- Mobile: Full list, tap to view detail

---

### 5.2 Customer Profile Page
**Purpose:** Complete customer view

**Composition:**
- Customer Profile Template
- Customer Udhar Snapshot (organism) in Overview tab
- Credit list in Udhar tab
- Timeline (organism) in History tab
- Detail forms in Details tab
- Sidebar with quick actions

**Key Features:**
- Tab navigation
- Customer summary always visible
- Quick actions in sidebar
- Deep linking to specific tabs

**User Questions Answered:**
- "What does this customer owe?"
- "How many credits do they have?"
- "When did they last pay?"
- "What's their payment history?"

---

### 5.3 Create Credit Page
**Purpose:** Record new Udhar with decision support

**Composition:**
- Create Credit Decision Panel (organism)
- Customer search
- Credit form
- Preview summary

**Key Features:**
- Customer search/selection
- Decision support panel (shows customer history)
- Simple form (minimal required fields)
- Preview before create
- Success confirmation

**User Questions Answered:**
- "Should I give this customer credit?"
- "How much do they already owe?"
- "What's their payment history?"

**UX Flow:**
1. Search customer
2. Review decision support panel
3. Fill credit details
4. Preview
5. Create

---

### 5.4 Record Payment Page
**Purpose:** Quick payment entry

**Composition:**
- Modal or slide-over
- Payment form
- Credit context (customer, item, remaining)
- Success confirmation

**Key Features:**
- Can be accessed from multiple places
- Pre-fills credit context
- Simple form (amount, method, date)
- Updates credit automatically
- Option to record another payment

**User Questions Answered:**
- "How much is remaining?"
- "What's the payment method?"
- "Who collected it?"

**Access Points:**
- Credit detail page
- Customer profile page
- Reminder list
- Credit list (via credit card)

---

### 5.5 Due Reminders Page
**Purpose:** Daily follow-up management

**Composition:**
- Reminders View Template
- Reminder List (organism)
- Time range selector
- Quick stats sidebar

**Key Features:**
- Grouped by urgency
- Contact actions (call, WhatsApp)
- Quick payment recording
- Mark as done
- Filter by customer, date range

**User Questions Answered:**
- "Who do I need to follow up with today?"
- "What's their contact info?"
- "How much do they owe?"
- "When did they last pay?"

**Daily Workflow:**
1. Open reminders page
2. Review today's reminders
3. Contact customers or record payments
4. Mark reminders as done
5. Move to next day's reminders

---

### 5.6 Owner Insights Page
**Purpose:** Business health dashboard

**Composition:**
- Insights / Dashboard Template
- Metric cards (molecules)
- Charts (trends, distributions)
- Top debtors list
- Recent activity feed

**Key Features:**
- High-level metrics
- Trend visualization
- Overdue analysis
- Recovery tracking
- Top customers by outstanding

**User Questions Answered:**
- "How is the business doing?"
- "How much is outstanding?"
- "Are we recovering well?"
- "Who are the top debtors?"
- "What are the trends?"

**Tone:**
- Informative, not alarming
- Support decision-making
- Focus on patterns, not problems

---

## Implementation Guidelines

### Component Naming
- Atoms: `AmountDisplay`, `DateDisplay`, `StatusBadge`
- Molecules: `CreditSummaryCard`, `PaymentRow`, `ReminderChip`
- Organisms: `CustomerUdharSnapshot`, `CreditTimeline`, `ReminderList`
- Templates: `CustomerProfileTemplate`, `CreditDetailTemplate`
- Pages: `CustomerListPage`, `CustomerProfilePage`

### File Structure
```
src/
  components/
    atoms/
      AmountDisplay/
      DateDisplay/
      StatusBadge/
      ...
    molecules/
      CreditSummaryCard/
      PaymentRow/
      ReminderChip/
      ...
    organisms/
      CustomerUdharSnapshot/
      CreditTimeline/
      ReminderList/
      ...
    templates/
      CustomerProfileTemplate/
      CreditDetailTemplate/
      ...
  pages/
    CustomerListPage/
    CustomerProfilePage/
    CreateCreditPage/
    ...
```

### State Management
- Use React Context for global state (user, organization)
- Local state for component-specific data
- Server state with React Query / SWR
- Optimistic updates for payments

### Data Fetching
- Fetch on mount for list pages
- Lazy load detail views
- Cache customer summaries
- Prefetch on hover where appropriate

### Performance
- Virtualize long lists
- Lazy load images
- Code split by route
- Memoize expensive computations

### Accessibility
- Semantic HTML
- ARIA labels for icons
- Keyboard navigation
- Focus management
- Screen reader support

### Responsive Breakpoints
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

---

## Design Principles Summary

1. **Calm & Trustworthy**
   - No alarming reds
   - Subtle status indicators
   - Gentle, supportive tone

2. **Memory-First**
   - Human language
   - Context-rich
   - Relationship-focused

3. **Decision Support**
   - Show information clearly
   - Don't block actions
   - Support, don't automate

4. **Progressive Disclosure**
   - Layer information
   - Show most important first
   - Details on demand

5. **Quick Actions**
   - Contextual actions
   - Minimal clicks
   - Support workflows

---

## Next Steps for Developers

1. **Set up design tokens** (colors, typography, spacing)
2. **Build atoms** (start with AmountDisplay, DateDisplay, StatusBadge)
3. **Build molecules** (CreditSummaryCard, PaymentRow)
4. **Build organisms** (CustomerUdharSnapshot, CreditTimeline)
5. **Build templates** (layout structures)
6. **Build pages** (compose templates and organisms)
7. **Add interactions** (animations, transitions)
8. **Test responsive** (mobile, tablet, desktop)
9. **Accessibility audit** (WCAG AA compliance)
10. **Performance optimization** (lazy loading, code splitting)

---

## Notes

- All components should be reusable and composable
- Follow consistent spacing and typography
- Use design tokens, not hardcoded values
- Support both light and dark themes (future)
- Mobile-first approach
- Test with real users (jewelry shop owners and staff)
