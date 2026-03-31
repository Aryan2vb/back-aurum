# Implementation Guide: Roles & Invitations (Frontend)

This guide outlines how to implement Role-Based Access Control (RBAC) and the Invitation flow in your React frontend.

## 1. Role-Based Access Control (RBAC)

The backend now enforces roles using `RolesGuard` on `CustomersController` and `CreditsController`.

### Determining the User's Role
Your user object (from login or `/auth/whoami`) contains the `role`:
```json
{
  "userId": "...",
  "role": "ADMIN",
  "organization": { "id": "...", "name": "..." }
}
```

### Authorization Hook
Create a hook to check permissions easily:

```javascript
// src/hooks/usePermission.js
import { useAuth } from './useAuth'; // Replace with your auth context/store

export const usePermission = () => {
  const { user } = useAuth();
  const role = user?.role;

  const can = (action) => {
    switch (action) {
      case 'read': return true; // Everyone logged in can read
      case 'write': return ['OWNER', 'ADMIN', 'STAFF'].includes(role);
      case 'delete': return ['OWNER', 'ADMIN'].includes(role);
      case 'admin': return ['OWNER', 'ADMIN'].includes(role);
      default: return false;
    }
  };

  return { can, role };
};
```

---

## 2. Invitation Flow

### A. Sending Invitations (Admin Side)
1. **API Call**: `POST /organizations/invitations`
2. **UI Implementation**:
   - Create a "Team Management" page.
   - Use a modal with an email field and a dropdown for roles.

### B. Accepting Invitations (User Side)
The user receives a link: `https://app.aurum.com/accept-invite?token=UUID_HERE`

1. **Invitation Pre-check**:
   - On page load, call `GET /auth/invitations/{token}`.
   - This returns the organization name and the invited role.

2. **Acceptance Form**:
   - Fields: Full Name, Password. (Email is pre-filled).
   - Action: `POST /auth/accept-invite`
     ```json
     {
       "token": "UUID_FROM_URL",
       "email": "user@example.com",
       "fullName": "John Doe",
       "password": "secure-password"
     }
     ```

---

## Backend Changes Summary
- **Roles Guard Applied**: Added to `CustomersController` and `CreditsController`.
- **New Public Endpoint**: `GET /auth/invitations/:token` added.
- **Improved Accept Endpoint**: `POST /auth/accept-invite` refined to handle invitation acceptance and user creation.
