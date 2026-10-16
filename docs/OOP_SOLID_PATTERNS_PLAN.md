# OOP / SOLID / Design Patterns — Review & Refactor Plan

Scope: `back-aurum` (NestJS + Prisma + R2) and `aurum` (React 18 CRA).
Source: three parallel review agents (backend SOLID/OOP, backend patterns, frontend) plus a synthesis pass that re-read 4 of the top findings in the source to confirm them.
Line numbers reflect the code on 2026-10-16; re-check before editing.

## Already done well

| Concept | Where | Why it's a good example |
|---|---|---|
| Dependency Injection / DIP | `back-aurum/src/invoices/invoices.module.ts` | Constructor injection with explicit `providers`/`exports` |
| Decorator + Guard + Strategy | `back-aurum/src/auth/` | `@Roles()`/`@Public()` decorators, `jwt-auth.guard`/`roles.guard` pipeline, Passport `jwt.strategy` |
| Chain of Responsibility | `back-aurum/src/prisma/prisma.service.ts:55-96` | `$use` middleware enforces `organizationId` via `TENANT_SCOPED_MODELS` |
| Config-driven Factory | `back-aurum/src/uploads/asset-type.enum.ts` (`ASSET_CONFIG`) | Adding an asset type means adding one row |

## Top opportunities

Ranked by learning value × real benefit ÷ effort.

### 1. Strategy + Factory: invoice template dispatch (OCP), both repos — Effort S
- Backend: `src/invoices/invoices.service.ts:1245-1252` and duplicated at `:2242-2249`.
- Frontend: `src/utils/invoiceTemplates.js` + dispatch in `src/pages/CreateInvoicePage/CreateInvoicePage.js:532-540`.
- Problem: an if/else chooses between generators that already share the signature `(data) => html`. The backend copies are also inconsistent: one uses `normalizeTemplateType()`, the other `settings.defaultTemplate || 'default'`. That is a latent bug.
- Fix:
  ```ts
  const TEMPLATE_RENDERERS: Record<TemplateType, (data: InvoiceData) => string> = {
    default: generateInvoiceHtml,
    jewellery: generateJewelleryHtml,
    modern: generateModernHtml,
  };
  const render = TEMPLATE_RENDERERS[normalizeTemplateType(type)] ?? generateInvoiceHtml;
  ```
  Adding a template becomes one map entry, and both call sites share the same normalization.

### 2. DIP + Facade: single `apiClient`, frontend — Effort M
- Where: `src/services/invoicesService.js`, `advanceService.js`, `reportsService.js`, `uploadService.js`, `organizationService.js`, `footerLibraryService.js`.
- Problem: every service repeats `fetch` + `Bearer` header + `parseResponse`.
- Fix: one `apiClient` that owns the base URL, auth header, JSON encoding, and 401/error handling. Services become `api.post('/invoices', data)`.

### 3. Encapsulation: `session` module, frontend — Effort S
- Where: 68 raw `localStorage.getItem('authToken')` calls across 14 files; `userRole`/`userEmail` are also read raw.
- Problem: storage keys are plain strings scattered everywhere; only `clearSession()` is centralized.
- Fix: a `session` module (`getToken`, `getRole`, `authHeader`, `clear`) as the only gateway. `apiClient` consumes `session.authHeader()`. Do this together with #2.

### 4. OCP / Policy object: role permissions, frontend — Effort S–M
- Where: `src/hooks/usePermission.js:10-16`, `src/App.js` (lines 153/161/169/178/186), `ProtectedRoute.js`, `SettingsPage.js`.
- Problem: `['OWNER','ADMIN','STAFF']` is copy-pasted. `permissions.test.js` searches source strings instead of testing behavior.
- Fix: a `POLICIES` map + `can(role, action)` as the single source of truth, with behavior-based tests.

### 5. SRP: split `InvoicesService`, backend — Effort L
- Where: `src/invoices/invoices.service.ts:38-2348` (~2300 lines).
- Problem: one class handles settings, sequencing, CRUD, payments, tax math, number-to-words, HTML/PDF, HMAC signing, bill-book, and WhatsApp links.
- Fix: extract one cohesive piece at a time. Start with the self-contained `SignatureService` (HMAC) and number-to-words, then `InvoiceRenderService`.

### 6. SRP: extract hooks from `CreateInvoicePage`, frontend — Effort L
- Where: `src/pages/CreateInvoicePage/CreateInvoicePage.js` (74KB, 52 hook calls).
- Problem: one component owns customer search, sequence validation, advance ledger, preview, KYC, payments, and formatters.
- Fix: move pure helpers to `utils/invoiceFormat.js` first (trivial and testable), then extract `useCustomerSearch`, `useInvoiceSequence`, and `useInvoicePreview`. Prefer hooks and composition over classes; that is the idiomatic React form of SRP.

### 7. DIP / LSP: `uploads = undefined as any`, backend — Effort S
- Where: `src/invoices/invoices.service.ts:44`.
- Problem: the `as any` cast bypasses DI type safety, so `uploads` can be undefined at runtime.
- Fix: make `UploadService` a real constructor-injected dependency and wire it in the module.

### 8. DRY + small Strategy maps, backend — Effort S
- `src/advance/advance.service.ts:52-62` (and ~88): the credit/debit loop is duplicated and its `else` branch is an unsafe default. Use a `LEDGER_SIGN` map with a shared reducer that falls back to 0.
- `src/invoices/invoices.controller.ts`: the full `@Roles(...)` list is repeated on ~15 handlers. Add composite `ReadRoles()` / `WriteRoles()` decorators via `applyDecorators`.

## Don't over-apply

| Tempting refactor | Why not (yet) |
|---|---|
| Repository layer over Prisma everywhere | Prisma already acts as a repository/unit of work, so a blanket layer is boilerplate. Extracting only the heaviest transaction clusters is fine. |
| Strategy for the 3 making-charge formulas (`invoice-calculation.service.ts:62-76`) | Three one-line pure formulas; a `switch` is clearer. A good example of when not to use Strategy. |
| Observer / event bus for ledger & negotiation side effects | There are few side effects and they must stay transactional. Revisit at the 4th or 5th side effect. |
| Abstract Template Method class hierarchy for HTML generators; Builder for `invoiceData` | Extract shared HTML helper functions instead; the Builder would only have a single use. |

## Practice order

1. Backend template Strategy map (#1). Small, self-contained, fixes the normalization bug. Verify with `npm test`.
2. Backend `undefined as any` fix (#7). Tiny, and the compiler checks it. Verify with `npm run build`.
3. Frontend `session` module, then `apiClient` (#3 → #2). Migrate one service at a time and run `npm test` after each.
4. Frontend permission policy (#4).
5. Incremental splits of the two large classes/components (#5, #6), one extraction per PR.

Frontend counterpart: `aurum/docs/OOP_SOLID_PATTERNS_PLAN.md` points back to this file.
