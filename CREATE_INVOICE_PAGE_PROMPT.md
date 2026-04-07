# Create Invoice Page Redesign Prompt

## Context
I need to redesign the Create Invoice page for a jewellery billing system. The current implementation is functional but needs a modern, intuitive UI that follows the existing design system and properly handles the complex jewellery-specific fields.

## Current Design Theme
- **Framework**: React with TailwindCSS
- **Design System**: Modern, clean interface with consistent spacing and typography
- **Color Scheme**: Professional blues/grays with accent colors for actions
- **Layout**: Responsive, mobile-friendly with proper form validation
- **Components**: Custom Input components, Icon components, consistent button styles
- **Styling Approach**: CSS modules with predictable class names (e.g., `styles.fieldGrid`, `styles.activeMetal`, `styles.itemRow3`)

## Frontend Requirements

### Page Structure
1. **Header Section**
   - Page title "Create Invoice"
   - Customer selection dropdown/search
   - Invoice date picker
   - Payment mode selector (CASH/CREDIT/UPI etc.)

2. **Buyer Information Section**
   - Auto-populated from selected customer
   - Editable fields: Address, State, State Code
   - Contact information display

3. **Items Section** (Most Critical)
   - Dynamic item list with add/remove functionality
   - Each item needs specialized jewellery fields:
     - Description (e.g., "22K Gold Chain")
     - Metal Type toggle (GOLD/SILVER/PLATINUM)
     - Purity (22K, 925, etc.)
     - Rate per gram
     - Gross Weight (g)
     - Stone Weight (g) 
     - Net Weight (calculated: Gross - Stone)
     - Making Charges with type selector:
       - FLAT_PER_ITEM (Flat amount)
       - PER_GRAM (Per gram)
       - PERCENTAGE_ON_METAL (% of metal value)
     - HUID (Hallmarking Unique ID)
     - HSN/SAC code
     - Stone charges (if applicable)
     - Hallmarking charges (auto-calculated)
     - Quantity (usually 1 for jewellery)

4. **Tax Configuration Section**
   - Tax Type selector (CGST_SGST/IGST/NONE)
   - CGST/SGST rates (typically 1.5% each for gold)
   - IGST rate (for inter-state)
   - Place of Supply (state code)

5. **Summary Section**
   - Real-time calculation display
   - Subtotal
   - Tax amounts (CGST/SGST/IGST)
   - Hallmarking charges total
   - Round-off amount
   - Grand Total
   - Paid Amount (input)
   - Balance amount

6. **Additional Fields**
   - Delivery Note
   - Dispatch Document Number
   - Destination
   - Terms of Delivery
   - Notes/Declaration

7. **Action Section**
   - Create Draft button
   - Create & Finalize button
   - Cancel button

## Backend API Integration

### Endpoint: `POST /invoices`
```javascript
const payload = {
  customerId: "uuid",
  placeOfSupply: "07",
  invoiceDate: "2026-04-05",
  templateType: "jewellery",
  modeOfPayment: "CASH",
  metalRateSource: "manual",
  metalRateDate: "2026-04-05T00:00:00.000Z",
  taxType: "CGST_SGST",
  cgstRate: 1.5,
  sgstRate: 1.5,
  igstRate: 0,
  buyerAddress: "Customer address",
  buyerState: "Madhya Pradesh",
  buyerStateCode: "07",
  autoCreateUdhar: true,
  paidAmount: 10000,
  notes: "Thank you for your purchase",
  deliveryNote: "",
  dispatchDocNo: "",
  destination: "",
  termsOfDelivery: "",
  items: [
    {
      slNo: 1,
      description: "Gold Ring 22K",
      hsnSac: "7113",
      quantity: "1",
      unit: "PCS",
      metalType: "GOLD",
      metalRate: "7200",
      purityLabel: "22K",
      purityValue: "22",
      purityBasis: 24,
      effectiveRate: "6600",
      grossWeight: "10.5",
      stoneWeight: "2",
      netWeight: "8.5",
      makingCharges: "500",
      makingChargesType: "PER_GRAM",
      makingChargesAmount: "4250",
      stoneCharges: "0",
      isHallmarked: true,
      hallmarkingCharge: "45",
      huid: "AB1234",
      taxableAmount: "60395",
      totalAmount: "60395",
      unitPrice: "6600"
    }
  ]
}
```

## Key UX Requirements

### 1. Intelligent Calculations
- **Net Weight** = Gross Weight - Stone Weight (auto-calculate)
- **Item Amount** = Net Weight × Rate + Making Charges + Stone Charges + Hallmarking Charges
- **Tax Calculations** based on item amounts and tax rates
- **Grand Total** with proper rounding

### 2. Jewellery-Specific Features
- **Metal Type Selection** with visual toggle buttons
- **Purity Input** supporting both Karat (22K) and percentage (925) formats
- **Making Charges Types** with clear labels and calculations
- **Hallmarking Integration** with HUID validation
- **Weight Management** with gross/stone/net weight fields

### 3. Form Validation
- Required field validation
- Numeric field validation (weights, rates, amounts)
- HSN/SAC code validation
- HUID format validation
- Customer selection requirement

### 4. User Experience
- **Auto-save** draft functionality
- **Real-time preview** of calculations
- **Keyboard navigation** between fields
- **Error handling** with clear messages
- **Loading states** for API calls
- **Success feedback** with invoice number display

### 5. Responsive Design
- Mobile-friendly layout
- Touch-friendly controls
- Proper field sizing for mobile input
- Collapsible sections for small screens

## Design Patterns to Follow

### 1. Item Entry Pattern
```
┌─────────────────────────────────────────┐
│ Item 1                    [× Remove]    │
├─────────────────────────────────────────┤
│ Description: [___________________]      │
│                                         │
│ [GOLD][SILVER][PLATINUM]  [22K] [₹7200] │
│                                         │
│ [10.5g] [2.0g] [7113]                   │
│                                         │
│ [Flat][/gm][%] [₹500] [AB1234]          │
└─────────────────────────────────────────┘
```

### 2. Summary Pattern
```
┌─────────────────────────────────────────┐
│ Subtotal: ₹60,350.00                    │
│ CGST (1.5%): ₹905.93                    │
│ SGST (1.5%): ₹905.93                    │
│ IGST (0%): ₹0.00                        │
│ Round Off: ₹0.14                        │
│ ─────────────────────────────────────── │
│ Grand Total: ₹62,207.00                 │
│ Paid Amount: [₹10,000.00]               │
│ Balance: ₹52,207.00                     │
└─────────────────────────────────────────┘
```

## Technical Considerations

### State Management
- Use React hooks for local state
- Implement debounced calculations
- Handle async customer search
- Manage item list operations efficiently

### Performance
- Optimize re-renders for item calculations
- Implement virtual scrolling for many items
- Cache customer data
- Lazy load heavy components

### Accessibility
- Proper ARIA labels
- Keyboard navigation
- Screen reader support
- High contrast mode support

## Success Criteria
1. **Complete item entry** with all jewellery-specific fields
2. **Real-time calculations** that match backend exactly
3. **Draft and final creation** workflows
4. **Mobile-responsive** design
5. **Error handling** for all edge cases
6. **Performance** with 50+ items
7. **Accessibility** compliance

## Reference Implementation
The current implementation in `CreateInvoicePage.js` serves as a reference for the data structure and basic functionality, but needs significant UX improvements and modern design patterns.

Please create a modern, intuitive Create Invoice page that handles the complexity of jewellery billing while maintaining simplicity for the user.
