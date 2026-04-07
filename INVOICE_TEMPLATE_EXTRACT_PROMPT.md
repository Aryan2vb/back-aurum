### Prompt for Extraction (Other Repository)

Hey! I am adding an **Invoice Module** to the `back-aurum` (NestJS backend). I already have a "Udhar" (Credit) system, and I want to build a service that wraps around our existing invoice HTML template and matches its feature set. 

Please analyze this repository and provide the following for the Invoice feature:

1. **The HTML Template**: Extract the core HTML structure and any CSS used for rendering invoices.
2. **Dynamic Fields**: List every dynamic placeholder (e.g., `{{customerName}}`, `{{taxRate}}`) used in that template so I can map them to the new backend DTOs.
3. **Current Invoice Logic**: How are invoice numbers calculated? Is there any special logic for taxes, subtotals, or discount calculation?
4. **Sending/Dispatch**: How does the current system "send" the invoice? (e.g., PDF generation, direct link sharing via WhatsApp/Email).
5. **Existing UI components**: Any React/JS components for "Create Invoice" or "Invoice Settings" that I should be aware of to ensure parity in the new backend?

Please provide a concise summary that I can give to my coding assistant to build the backend service layer.
