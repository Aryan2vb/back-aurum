# Udhar Management System - Information Architecture & UX Design

## Design Philosophy

### Core Principles

1. **Memory-First, Not Math-First**
   - Show relationships and context before numbers
   - Use human language ("Ramesh owes ₹50,000" not "Outstanding: ₹50,000")
   - Prioritize "who" and "when" over "how much"

2. **Decision Support, Not Automation**
   - Present information clearly, let humans decide
   - No aggressive alerts or warnings
   - Gentle nudges, not demands

3. **Trust-Based, Not Financial**
   - Avoid banking/finance terminology
   - Use familiar terms: "Udhar" (credit), "Payment", "Reminder"
   - Focus on relationships and promises, not risk scores

4. **Calm & Minimal**
   - Attio/Linear-inspired clean interface
   - Generous whitespace
   - Subtle, non-intrusive status indicators
   - No red alerts or urgent banners

5. **Context-Rich**
   - Always show customer context when viewing credits
   - Link related information naturally
   - Support mental models of shop owners

---

## Primary Navigation Structure

### Top-Level Navigation (Horizontal Bar)

```
┌─────────────────────────────────────────────────────────────┐
│ [Logo]  Customers  |  Udhar  |  Reminders  |  Overview     │
│                      ↑                                        │
│                  Primary focus                               │
└─────────────────────────────────────────────────────────────┘
```

**Navigation Items:**

1. **Customers** (Primary entry point)
   - Customer list and profiles
   - Search and discovery
   - Customer detail views

2. **Udhar** (Credit management)
   - All credits list
   - Credit detail views
   - Payment tracking

3. **Reminders** (Follow-up management)
   - Due reminders list
   - Reminder scheduling
   - Follow-up history

4. **Overview** (Business health)
   - Statistics dashboard
   - Trends and insights
   - Owner review tools

### Secondary Navigation (Contextual Sidebar)

When viewing a Customer or Credit, a contextual sidebar appears:

```
┌─────────────────┐
│ Customer Info   │
│ - Contact       │
│ - Location      │
│ - History       │
│                 │
│ Quick Actions   │
│ - New Udhar     │
│ - Record Payment│
│ - Set Reminder  │
└─────────────────┘
```

---

## Core Screens & Purpose

### 1. Customers Screen

**Purpose:** Find and access customer information quickly

**Layout:**
- **Left Panel (30%):** Customer list with search
- **Right Panel (70%):** Selected customer detail view (or empty state)

**Key Information Visible:**
- Customer name, code, phone
- Total active Udhar amount (prominent but not alarming)
- Status indicator (subtle badge)
- Last interaction date

**Hidden Behind Interaction:**
- Full contact details
- Location details
- Social context
- Document/KYC info
- Complete credit history

**Search & Filters:**
- Quick search by name, phone, or code
- Filter by status, location, or credit status
- Recent customers (last 7 days)

---

### 2. Customer Detail Screen

**Purpose:** Complete view of customer relationship and history

**Layout:**
- **Header:** Customer name, code, primary contact
- **Tabs:** Overview | Udhar | History | Details
- **Sidebar:** Quick actions and summary

**Tab: Overview**
- Credit summary card (decision support data)
  - Total active Udhar
  - Number of open credits
  - Behavior tag (CLEAR, REGULAR, DELAYED, RISKY) - subtle indicator
  - Last payment date
  - Oldest unpaid days
- Recent activity timeline
- Quick stats (total ever given, total repaid)

**Tab: Udhar**
- List of all credits (active first)
- Each credit shows: amount, remaining, due date, status
- Click to view credit detail

**Tab: History**
- Chronological timeline of all interactions
- Credits created, payments received, reminders sent
- Filter by type or date range

**Tab: Details**
- Contact information
- Location(s)
- Social context
- Documents/KYC
- Meta tracking (notes, source, registration info)

---

### 3. Udhar List Screen

**Purpose:** View and manage all credits across customers

**Layout:**
- **Top Bar:** Filters and search
- **Main Area:** Credit cards/list view
- **Sidebar:** Summary statistics (collapsible)

**Key Information Visible (per credit):**
- Customer name and photo/initial
- Item summary ("Gold Necklace 22K, 45g")
- Total amount and remaining balance
- Due date (with days overdue if applicable)
- Status indicator (subtle, not alarming)
- Progress bar (paid vs total)

**Hidden Behind Interaction:**
- Full payment history
- Detailed notes
- Reminder schedule
- Sale reference

**Filters:**
- Status (Active, Overdue, Paid, Cancelled)
- Customer
- Date range (credit date or due date)
- Search by item, customer name, or sale reference

**Sort Options:**
- Due date (default for staff)
- Credit date
- Amount
- Customer name

---

### 4. Credit Detail Screen

**Purpose:** Complete view of a single credit transaction

**Layout:**
- **Header:** Customer name (link), item summary, status
- **Main Content:** Two-column layout
  - Left: Credit details and timeline
  - Right: Payment history and actions

**Key Information Visible:**
- Customer card (name, contact, link to profile)
- Credit summary:
  - Total amount
  - Paid amount
  - Remaining balance (prominent)
  - Credit date
  - Expected due date
  - Days overdue (if applicable) - subtle
- Item details (summary, description, sale reference)
- Reminder info (frequency, next reminder date)

**Payment History Section:**
- List of all payments (newest first)
- Each payment shows: date, amount, method, collected by
- Total paid and remaining balance

**Actions Available:**
- Record new payment
- Update credit details
- Set/update reminder
- Add notes
- Mark as paid/cancelled

---

### 5. Reminders Screen

**Purpose:** Daily follow-up management for staff

**Layout:**
- **Top Bar:** Time range selector (7/14/30 days)
- **Main Area:** Reminder cards grouped by urgency
- **Sidebar:** Quick stats

**Key Information Visible (per reminder):**
- Customer name and contact (clickable to call/WhatsApp)
- Credit item summary
- Remaining balance
- Due date and days overdue (subtle indicator)
- Next reminder date
- Last payment date (if recent, shows "Paid 2 days ago")

**Grouping:**
- Today (prominent but calm)
- This week
- Next week
- Overdue (grouped by days: 0-30, 30-60, 60+)

**Actions:**
- Mark reminder as done
- Reschedule reminder
- Record payment (quick action)
- Contact customer (call/WhatsApp)

**Hidden Behind Interaction:**
- Full credit history
- Customer full profile
- Detailed payment timeline

---

### 6. Overview Screen

**Purpose:** Business health dashboard for owners

**Layout:**
- **Top Section:** Key metrics cards (calm, not alarming)
- **Middle Section:** Charts and trends
- **Bottom Section:** Top debtors and insights

**Key Metrics (Visible):**
- Total outstanding (active + overdue)
- Active credits count
- Overdue credits count (subtle, not red)
- Recovered this month
- Credits issued this month

**Charts:**
- Monthly trend (credits issued vs recovered)
- Overdue buckets (0-30, 30-60, 60+ days) - bar chart
- Top 10 customers by outstanding (list, not alarming)

**Insights Section:**
- Recent activity summary
- Notable patterns (e.g., "3 customers paid this week")
- Recovery rate trends

**Tone:**
- Informative, not alarming
- Focus on patterns, not problems
- Support decision-making, not create urgency

---

### 7. Create Credit Screen

**Purpose:** Record new Udhar with decision support

**Layout:**
- **Left Panel (40%):** Customer search/selection
- **Right Panel (60%):** Credit form with decision support

**Flow:**
1. Search/select customer
2. Customer summary appears (decision support):
   - Current active Udhar
   - Behavior tag and risk level (subtle indicators)
   - Last payment date
   - Number of open credits
3. Fill credit details:
   - Amount (required)
   - Item summary (optional but recommended)
   - Sale reference (optional)
   - Description/notes (optional)
   - Expected due date (optional)
   - Reminder frequency (optional, defaults to WEEKLY)
   - Initial payment (optional)
4. Review and create

**Decision Support Display:**
- Shows customer's credit history context
- Non-intrusive, informational only
- No blocking or warnings
- Helps owner make informed decision

---

### 8. Record Payment Screen

**Purpose:** Quick payment entry

**Layout:**
- **Context:** Can be accessed from:
  - Credit detail screen
  - Customer detail screen
  - Reminder screen (quick action)
  - Udhar list (via credit card)

**Form Fields:**
- Amount (required)
- Payment method (CASH, UPI, BANK_TRANSFER, CHEQUE, CARD, OTHER)
- Date (defaults to today)
- Reference number (optional, for UPI/bank transfers)
- Collected by (optional, auto-fills current user)
- Notes (optional)

**After Payment:**
- Shows updated balance
- Updates credit status if fully paid
- Option to record another payment
- Returns to previous screen

---

## Key User Flows

### Flow 1: Daily Staff Flow (Payment Collection)

**Goal:** Staff member needs to follow up with customers and record payments

**Steps:**
1. **Start:** Open Reminders screen
2. **Review:** See reminders due today/this week
3. **Select:** Click on a reminder card
4. **Context:** View customer contact and credit details
5. **Action:** 
   - Option A: Contact customer (call/WhatsApp from app)
   - Option B: Record payment if customer came to shop
6. **Record Payment:**
   - Quick payment form appears
   - Enter amount and method
   - Save
7. **Update:** Reminder automatically reschedules or marks as done
8. **Continue:** Move to next reminder

**Key UX Principles:**
- Minimal clicks
- Quick actions always available
- Context preserved (don't lose place)
- Mobile-friendly (staff may use phone/tablet)

---

### Flow 2: Owner Review Flow (Business Health Check)

**Goal:** Owner wants to understand business health and make decisions

**Steps:**
1. **Start:** Open Overview screen
2. **Review Metrics:** Check total outstanding, overdue count, recovery rate
3. **Investigate:** Click on "Overdue credits" or "Top debtors"
4. **Drill Down:** 
   - View overdue credits list
   - Click on specific credit
   - View customer profile and history
5. **Decision:** 
   - Decide on follow-up strategy
   - Set reminders
   - Or mark for personal follow-up
6. **Review Trends:** Check monthly charts and patterns
7. **Action:** Make business decisions based on insights

**Key UX Principles:**
- High-level first, details on demand
- No alarming visuals
- Support decision-making with context
- Easy navigation between related items

---

### Flow 3: Create Credit Flow (New Sale with Udhar)

**Goal:** Record a new sale where customer takes Udhar

**Steps:**
1. **Start:** From Customers screen or Udhar screen
2. **Search Customer:** 
   - If existing: Search and select
   - If new: Create customer first (quick flow)
3. **Decision Support:** Customer summary appears showing:
   - Current active Udhar
   - Payment history
   - Behavior tag (REGULAR, DELAYED, RISKY)
   - Risk level (subtle indicator)
4. **Fill Details:**
   - Enter amount
   - Add item summary (what was sold)
   - Set expected due date (customer's promise)
   - Set reminder frequency
   - Optional: Record initial payment
5. **Review:** See summary of credit being created
6. **Create:** Save credit
7. **Confirmation:** Credit created, shows updated customer summary

**Key UX Principles:**
- Decision support, not blocking
- Show context, let owner decide
- Quick entry (minimal required fields)
- Clear confirmation

---

### Flow 4: Customer Discovery Flow (Find Customer Info)

**Goal:** Staff needs to find customer information quickly

**Steps:**
1. **Start:** Customers screen
2. **Search:** Type name, phone, or customer code
3. **Select:** Click on customer from results
4. **View:** Customer detail screen opens
5. **Navigate:** 
   - Check Overview tab for credit summary
   - Check Udhar tab for all credits
   - Check Details tab for contact/location
6. **Action:** 
   - Record payment
   - Create new credit
   - Contact customer
   - Set reminder

**Key UX Principles:**
- Fast search
- Rich results (show key info in list)
- Quick access to common actions
- Context preserved

---

## Information Visibility Hierarchy

### Always Visible (Glance Level)

**Customer List:**
- Name
- Customer code
- Primary phone
- Total active Udhar (if any)
- Last interaction indicator

**Credit List:**
- Customer name
- Item summary
- Remaining balance
- Due date
- Status (visual indicator, not text)

**Reminder List:**
- Customer name
- Contact method (phone icon)
- Remaining balance
- Days until due / days overdue
- Last payment indicator

**Overview Dashboard:**
- Total outstanding
- Active credits count
- Overdue count
- Recovery this month

---

### Visible on Hover/Interaction (One Click)

**Customer Card:**
- Full contact details
- Location summary
- Credit summary breakdown
- Quick action buttons

**Credit Card:**
- Full payment history
- Detailed notes
- Reminder schedule
- Sale reference

**Reminder Card:**
- Full credit details
- Customer full profile link
- Payment history
- Reminder history

---

### Hidden Behind Navigation (Two+ Clicks)

**Deep Details:**
- Complete customer profile (all tabs)
- Full credit timeline
- All payment transactions
- Reminder history
- Social context and documents
- Audit logs

**Advanced Features:**
- Bulk operations
- Advanced filters
- Export functions
- Settings and configuration

---

## UX Principles for All Components

### 1. Calm & Trustworthy

**Visual Language:**
- Soft colors, no harsh reds for overdue
- Subtle status indicators (badges, not banners)
- Generous whitespace
- Gentle shadows and borders

**Tone:**
- Informative, not alarming
- Supportive, not demanding
- Professional, not corporate

**Examples:**
- Overdue indicator: Subtle orange/yellow, not red
- Risk level: Small badge, not warning banner
- Reminders: Gentle highlight, not urgent alert

---

### 2. Memory-First Design

**Prioritize:**
- Customer name over customer ID
- Item description over invoice number
- "Ramesh owes ₹50,000" over "Outstanding: ₹50,000"
- "Due in 3 days" over "Due date: 2024-01-20"

**Context:**
- Always show customer context with credit
- Link related information naturally
- Support mental models (who, what, when)

**Language:**
- Use familiar terms (Udhar, Payment, Reminder)
- Avoid financial jargon (AR, AP, DSO, etc.)
- Human-readable dates and amounts

---

### 3. Decision Support, Not Automation

**Information Display:**
- Show relevant context clearly
- Present options, don't prescribe actions
- Support informed decisions

**No Blocking:**
- Don't prevent actions based on risk
- Show warnings subtly, don't block
- Let humans decide

**Examples:**
- Customer summary shows risk level, but doesn't block credit creation
- Overdue indicator is visible but not alarming
- Reminders are suggestions, not demands

---

### 4. Progressive Disclosure

**Layer Information:**
- Most important info visible immediately
- Secondary info on hover/interaction
- Detailed info in dedicated views

**Reduce Cognitive Load:**
- Don't show everything at once
- Group related information
- Use tabs, accordions, and modals appropriately

**Examples:**
- Customer list shows summary, detail view shows everything
- Credit card shows basics, detail view shows full history
- Overview shows key metrics, drill down for details

---

### 5. Quick Actions Everywhere

**Contextual Actions:**
- Always available where needed
- Don't require navigation
- Support common workflows

**Examples:**
- Record payment from credit view, customer view, reminder view
- Contact customer from any customer context
- Create credit from customer view or main Udhar screen

---

### 6. Mobile-First Considerations

**Touch Targets:**
- Large enough for fingers
- Adequate spacing
- Easy to tap

**Layout:**
- Stack on mobile, side-by-side on desktop
- Bottom navigation on mobile
- Swipe gestures where appropriate

**Performance:**
- Fast loading
- Offline capability where possible
- Optimized for slower connections

---

### 7. Search & Discovery

**Fast Search:**
- Global search available
- Search by name, phone, code
- Recent/frequent customers prioritized

**Smart Filters:**
- Common filters easily accessible
- Advanced filters hidden but available
- Filter state preserved

**Examples:**
- Quick search in customer list
- Filter credits by status, customer, date
- Search reminders by customer or item

---

### 8. Feedback & Confirmation

**Subtle Feedback:**
- Confirm actions without interrupting
- Show success states clearly
- Error messages helpful, not technical

**Loading States:**
- Show progress for long operations
- Optimistic updates where possible
- Clear loading indicators

**Examples:**
- Payment recorded: Subtle toast notification
- Credit created: Brief confirmation, then redirect
- Error: Clear message in human language

---

## Component Hierarchy (Atomic Design)

### Atoms
- Buttons (primary, secondary, ghost)
- Input fields (text, number, date, select)
- Badges (status, risk level, behavior tag)
- Icons (contact methods, payment methods, actions)
- Typography (headings, body, labels)

### Molecules
- Customer card (name, contact, summary)
- Credit card (customer, item, amount, status)
- Reminder card (customer, credit, due date)
- Payment row (date, amount, method)
- Search bar with filters
- Metric card (label, value, trend)

### Organisms
- Customer list with search
- Credit list with filters
- Reminder list grouped by urgency
- Payment history table
- Customer detail tabs
- Credit detail view
- Overview dashboard

### Templates
- Two-column layout (list + detail)
- Single column layout (full detail)
- Dashboard layout (metrics + charts)
- Modal overlay (forms, confirmations)

### Pages
- Customers screen
- Customer detail screen
- Udhar list screen
- Credit detail screen
- Reminders screen
- Overview screen
- Create credit screen
- Record payment screen

---

## Navigation Patterns

### Primary Navigation
- Horizontal top bar (desktop)
- Bottom tab bar (mobile)
- Always visible
- Current section highlighted

### Secondary Navigation
- Contextual sidebar (desktop)
- Slide-out drawer (mobile)
- Appears when viewing detail screens
- Shows related information and actions

### Breadcrumbs
- Show current location
- Support deep navigation
- Click to go back
- Format: Customers > Ramesh Kumar > Udhar > Gold Necklace

### Quick Actions
- Floating action button (mobile)
- Action bar (desktop)
- Context-aware
- Most common action prominent

---

## Responsive Breakpoints

### Mobile (< 768px)
- Single column layout
- Bottom navigation
- Stacked cards
- Full-screen modals

### Tablet (768px - 1024px)
- Two-column where appropriate
- Side navigation
- Larger touch targets

### Desktop (> 1024px)
- Multi-column layouts
- Persistent sidebars
- Hover states
- Keyboard shortcuts

---

## Accessibility Considerations

### Keyboard Navigation
- All actions keyboard accessible
- Tab order logical
- Focus indicators visible
- Shortcuts for common actions

### Screen Readers
- Semantic HTML
- ARIA labels where needed
- Alt text for icons
- Status announcements

### Visual
- Sufficient color contrast
- Not color-dependent (use icons + color)
- Scalable text
- Clear focus states

---

## Performance Principles

### Fast Initial Load
- Critical content first
- Lazy load below fold
- Optimize images
- Code splitting

### Smooth Interactions
- Optimistic updates
- Skeleton screens for loading
- Debounce search
- Cache frequently accessed data

### Offline Support
- Cache recent data
- Queue actions when offline
- Sync when online
- Clear offline indicators

---

## Next Steps

1. **Visual Design:** Create design system with colors, typography, spacing
2. **Component Library:** Build reusable components following atomic design
3. **Prototyping:** Create interactive prototypes for key flows
4. **User Testing:** Test with actual jewelry shop owners and staff
5. **Iteration:** Refine based on feedback and usage patterns

---

## Notes

- This architecture prioritizes trust and relationships over financial metrics
- Design should feel like a helpful assistant, not a strict system
- Always show context - users think in terms of people and stories
- Support memory and decision-making, don't replace human judgment
- Keep it calm and minimal - no aggressive alerts or urgent warnings
