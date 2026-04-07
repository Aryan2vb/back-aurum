# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Development
- Build: `npm run build`
- Start Dev: `npm run start:dev`
- Start Prod: `npm run start:prod`
- Lint: `npm run lint`
- Format: `npm run format`

### Database (Prisma/Supabase)
- Generate Client: `npm run prisma:generate`
- Run Migrations: `npm run prisma:migrate`
- Studio: `npm run prisma:studio`
- Seed: `npm run prisma:seed`

### Testing
- All Tests: `npm run test`
- Single Test: `npx jest src/path/to/file.spec.ts`
- Watch Mode: `npm run test:watch`
- Coverage: `npm run test:cov`
- E2E Tests: `npm run test:e2e`

## Architecture & Structure

### High-Level Architecture
The project is a multi-tenant SaaS backend built with **NestJS**, using **Prisma ORM** connected to a **Supabase (PostgreSQL)** database.

### Core Modules (`src/`)
- `auth/`: Handles authentication and JWT management.
- `organizations/`: Manages companies/organizations. The system is multi-tenant where users are linked to organizations via `OrganizationMember`.
- `customers/`: Management of client data for the organizations.
- `invoices/`: Core billing logic, invoice generation, and finalization.
- `credits/`: Manages credit transactions and balances.
- `reports/`: Handles report generation.
- `prisma/`: Centralized Prisma client module for database access.

### Multi-Tenancy Pattern
The system implements a multi-tenant structure where each user belongs to one or more organizations. Most data (customers, invoices, credits) is scoped to an `organizationId` to ensure data isolation between different companies.

### Key Tech Stack
- **Framework**: NestJS (TypeScript)
- **ORM**: Prisma
- **Database**: PostgreSQL (via Supabase)
- **Auth**: Passport JWT
- **PDF Generation**: `pdfmake` / `html-to-pdfmake`
- **Precision Math**: `decimal.js` for financial calculations
