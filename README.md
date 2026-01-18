# Back Aurum - NestJS Backend

A NestJS backend application with Supabase and Prisma ORM for a SaaS product.

## Features

- ✅ NestJS framework
- ✅ Prisma ORM with PostgreSQL (Supabase)
- ✅ User management
- ✅ Organization management (each user gets their own company)
- ✅ Multi-tenant ready structure

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Supabase account with database credentials

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` and add your Supabase credentials:
   - `DATABASE_URL`: Supabase Session Pooler URL (for Prisma Client)
   - `DIRECT_URL`: Supabase Direct Connection URL (for migrations)

3. **Generate Prisma Client:**
   ```bash
   npm run prisma:generate
   ```

4. **Run database migrations:**
   ```bash
   npm run prisma:migrate
   ```

5. **Start the development server:**
   ```bash
   npm run start:dev
   ```

The application will be available at `http://localhost:3000`

## API Endpoints

### Users
- `POST /users` - Create a new user
- `GET /users` - Get all users
- `GET /users/:id` - Get user by ID
- `GET /users/email/:email` - Get user by email

### Organizations
- `POST /organizations` - Create a new organization (automatically adds user as member)
- `GET /organizations` - Get all organizations
- `GET /organizations/:id` - Get organization by ID
- `GET /organizations/user/:userId` - Get all organizations for a user

## Database Schema

- **User**: Stores user information (linked to Supabase auth)
- **Organization**: Each organization represents a company
- **OrganizationMember**: Junction table linking users to organizations

## Development

- `npm run start:dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run prisma:studio` - Open Prisma Studio to view/edit database
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Notes

- Each user can belong to multiple organizations
- When creating an organization, the specified user is automatically added as a member
- Roles are not implemented yet (as per requirements)

