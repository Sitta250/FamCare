# Feature 8 — Emergency Info Card — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Emergency Info Card feature is implemented. Run the specific test assertions listed below and fix any failures in the implementation. All 4 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/index.js` | Route registration for emergency endpoints |
| `famcare-backend/src/services/emergencyCardService.js` | Aggregates allergies, conditions, active medications, emergency contacts, blood type, preferred hospital |
| `famcare-backend/src/services/emergencyContactService.js` | CRUD for emergency contacts |
| `famcare-backend/src/services/emergencyInfoService.js` | Emergency info fields |
| `famcare-backend/src/tests/emergencyCard.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | FamilyMember, EmergencyContact models |

## API Surface Being Tested

```
GET    /api/v1/family/:id/emergency-card
POST   /api/v1/family/:id/emergency-contacts
PATCH  /api/v1/family/:id/emergency-contacts/:contactId
DELETE /api/v1/family/:id/emergency-contacts/:contactId
```

## Tasks

1. Run the emergency card tests:
   ```bash
   cd famcare-backend && npx jest emergency --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - GET emergency card returns all fields: allergies, conditions, active medications, emergency contacts, blood type, preferred hospital
   - Only active (non-ended, non-cancelled) medications appear on the card
   - No medications → `medications: []` (empty array, not error or null)
   - Emergency contacts CRUD: create, update, delete all work correctly
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest emergency --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Returns all fields populated correctly
- Only active (non-ended) medications appear
- No medications → empty array, not error
- Emergency contacts CRUD works correctly
