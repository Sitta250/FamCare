# Feature 10 — Family Coordination — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Family Coordination feature is implemented (role-based access: OWNER, CAREGIVER, VIEWER; grant/revoke access; notification preferences). Run the specific test assertions listed below and fix any failures in the implementation. All 5 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/familyAccess.js` | REST route handlers |
| `famcare-backend/src/services/familyAccessService.js` | Grant, revoke, list access |
| `famcare-backend/src/services/accessService.js` | `assertCanReadMember`, `assertCanWriteMember` — role enforcement |
| `famcare-backend/src/tests/family_access.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | FamilyAccess model with roles OWNER/CAREGIVER/VIEWER |

## API Surface Being Tested

```
POST   /api/v1/family/:id/access          (grant access)
GET    /api/v1/family/:id/access          (list grantees)
DELETE /api/v1/family/:id/access/:userId  (revoke access)
```

## Roles

- `OWNER` — full read + write, always retains access
- `CAREGIVER` — read + write
- `VIEWER` — read only, no write operations

## Tasks

1. Run the family access tests:
   ```bash
   cd famcare-backend && npx jest family_access --verbose
   ```
   Also try:
   ```bash
   cd famcare-backend && npx jest familyAccess --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - Grant CAREGIVER → grantee can read + write resources for that family member
   - Grant VIEWER → grantee can read only; write attempts return 403
   - Revoke access → immediate loss of access (subsequent requests return 403)
   - Notification prefs: if a user disables reminders in their `notificationPrefs`, they don't receive LINE push
   - Owner always retains access regardless of any grant/revoke operations
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest family --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Grant CAREGIVER → grantee can read + write
- Grant VIEWER → grantee can read only, not write
- Revoke access → immediate loss of access
- Notification prefs: disabled reminder → user doesn't receive push
- Owner always retains access regardless
