# Family Coordination — Implementation Plan

## 1. Goal Summary

Extend the existing `FamilyAccess` system with per-user, per-event **notification preferences** so that each co-caregiver or viewer can independently opt in or out of appointment reminders, medication reminders, and missed-dose alerts. The invite/revoke API already exists; this plan layers `notificationPrefs` on top of it and filters dispatch accordingly.

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `prisma/schema.prisma` | `FamilyAccess` model — add `notificationPrefs String?` |
| `src/services/familyAccessService.js` | `grantAccess`, `listAccessForMember`, `revokeAccess` — update to handle prefs |
| `src/routes/familyAccess.js` | `POST/GET/DELETE /family-members/:memberId/access` — add PATCH |
| `src/services/reminderDispatchService.js` | Appointment reminder cron — filter recipients by prefs |
| `src/services/medicationReminderDispatchService.js` | Medication/missed-dose cron — `getRecipients` filters by prefs |
| `src/services/accessService.js` | `assertCanReadMember`, `assertCanWriteMember`, `assertOwnerForMember` — referenced but unchanged |
| `src/tests/family_coordination.test.js` | New test file |

### What already exists (do not re-implement):
- `FamilyAccess` model and migration — only need to add one nullable column
- `grantAccess` / `revokeAccess` / `listAccessForMember` in `familyAccessService.js`
- Route file `familyAccess.js` with `GET`, `POST`, `DELETE`
- `dispatchDueReminders` in `reminderDispatchService.js` — only add pref filtering
- `getRecipients` + `dispatchMedicationReminders` — only add pref filtering

---

## 3. Data Model Changes

### `FamilyAccess` — add one nullable JSON column

```prisma
model FamilyAccess {
  id              String     @id @default(cuid())
  grantedByUserId String
  grantedToUserId String
  familyMemberId  String
  role            AccessRole
  notificationPrefs String?  // ← NEW: JSON string, null = all enabled (default)
  createdAt       DateTime   @default(now())
  ...
}
```

**Prefs schema** (stored as JSON string, parsed in service layer):
```json
{
  "appointmentReminders": true,
  "medicationReminders":  true,
  "missedDoseAlerts":     true
}
```

- `null` / missing key = `true` (backward-compatible default — existing grants retain all notifications)
- Owner is never in `FamilyAccess`; owner always receives all notifications unconditionally

**Migration name:** `add_notification_prefs_to_family_access`

---

## 4. API Changes

### Existing endpoints (extend, not replace)

```
POST   /api/v1/family-members/:memberId/access
```
Body now accepts optional `notificationPrefs` object alongside existing `grantedToLineUserId` + `role`.

```
GET    /api/v1/family-members/:memberId/access
```
Response now includes `notificationPrefs` (parsed object, never raw string).

```
DELETE /api/v1/family-members/:memberId/access/:grantedToUserId
```
No change.

### New endpoint

```
PATCH  /api/v1/family-members/:memberId/access/:grantedToUserId
Body:  { notificationPrefs: { appointmentReminders: bool, medicationReminders: bool, missedDoseAlerts: bool } }
Auth:  OWNER only
200:   { data: updatedFamilyAccess }
404:   grant not found
```

> **Note on route paths in spec**: The feature spec shows `/api/v1/family/:id/access`. The existing codebase uses `/api/v1/family-members/:memberId/access`. Use the existing path to stay consistent with all other routes and the iOS app contract.

---

## 5. Frontend Changes

None — this is a backend-only repository.

---

## 6. Edge Cases

1. **Missing or partial `notificationPrefs`**: Treat each missing key as `true`. A completely `null` prefs field means all enabled.
2. **Owner is not in `FamilyAccess`**: Owner always receives all notifications. Never filter the owner through prefs logic.
3. **VIEWER granted pref update**: Owners can update prefs for VIEWERs too, not just CAREGIVERs (VIEWERs could receive appointment reminders in future).
4. **Granting access updates existing record**: `grantAccess` uses `upsert`. When updating an existing grant (e.g. role change), `notificationPrefs` should only be overwritten if explicitly provided; otherwise preserve existing value.
5. **Concurrent cron runs**: Pref checks are read-only queries inside dispatch; no new idempotency concern.
6. **Invalid JSON stored**: Parse with try/catch in service; fall back to all-enabled defaults to avoid silently blocking notifications.
7. **Revoked user immediately loses pushes**: Revoke deletes the `FamilyAccess` row — dispatch queries `accessList` live, so next cron tick the user is excluded naturally. No extra work needed.

---

## 7. Implementation Tasks

---

### Task 1 — Schema: Add `notificationPrefs` to `FamilyAccess`

**Purpose:** Introduce the new nullable column to the database without breaking existing data.

**Files affected:**
- `prisma/schema.prisma`

**Dependencies:** None

**Acceptance criteria:**
- `FamilyAccess` model has `notificationPrefs String?`
- All existing `FamilyAccess` rows have `notificationPrefs = null` after migration (backward-compatible)
- `npx prisma generate` succeeds
- Prisma client exposes `notificationPrefs` on `FamilyAccess` type

**Tests to add / run:** None for this task (schema only).

**Verification commands:**
```bash
npx prisma validate
npx prisma migrate dev --name add_notification_prefs_to_family_access
npx prisma generate
```

**Constraints:**
- Do not add a new model or enum — one nullable column only
- Do not set a `@default` in Prisma — `null` is the intentional default (means all-enabled)

**Risks:**
- Migration requires a live `DATABASE_URL`. If running in CI without a DB, use `npx prisma migrate deploy` instead of `dev`.

---

### Task 2 — Service: Update `familyAccessService.js`

**Purpose:** Make `grantAccess` persist `notificationPrefs`, add a `updateNotificationPrefs` function, and ensure `listAccessForMember` returns parsed prefs objects.

**Files affected:**
- `src/services/familyAccessService.js`

**Dependencies:** Task 1 (schema must have the column)

**Changes:**

1. **`grantAccess(ownerUserId, familyMemberId, { grantedToLineUserId, role, notificationPrefs })`**
   - Accept optional `notificationPrefs` (object or undefined)
   - In `upsert.create`: serialize as `JSON.stringify(notificationPrefs ?? null)`
   - In `upsert.update`: only overwrite `notificationPrefs` if the argument is explicitly provided (not `undefined`); if undefined, omit the field from the `update` payload so an existing value is preserved

2. **`updateNotificationPrefs(ownerUserId, familyMemberId, grantedToUserId, notificationPrefs)`**
   - Call `assertOwnerForMember(ownerUserId, familyMemberId)`
   - `prisma.familyAccess.updateMany({ where: { familyMemberId, grantedToUserId }, data: { notificationPrefs: JSON.stringify(notificationPrefs) } })`
   - If `count === 0`, throw `{ status: 404, code: 'NOT_FOUND' }`
   - Return updated record via `findFirst`

3. **`listAccessForMember`** (internal helper `parsePrefs`):
   - After querying, map each result: parse `notificationPrefs` string → object, replace field with parsed value
   - If parse fails or is `null`, return `{ appointmentReminders: true, medicationReminders: true, missedDoseAlerts: true }`

4. **Export `parseNotificationPrefs(prefsString)`** — pure helper for use in dispatch services:
   ```js
   export function parseNotificationPrefs(raw) {
     try {
       const p = raw ? JSON.parse(raw) : {}
       return {
         appointmentReminders: p.appointmentReminders ?? true,
         medicationReminders:  p.medicationReminders  ?? true,
         missedDoseAlerts:     p.missedDoseAlerts      ?? true,
       }
     } catch {
       return { appointmentReminders: true, medicationReminders: true, missedDoseAlerts: true }
     }
   }
   ```

**Acceptance criteria:**
- `grantAccess` with `notificationPrefs` stores JSON string in DB
- `grantAccess` without `notificationPrefs` leaves existing value unchanged on upsert (update path)
- `updateNotificationPrefs` throws 404 when grant doesn't exist
- `listAccessForMember` returns parsed objects, not raw strings
- `parseNotificationPrefs(null)` returns all-true defaults

**Tests to add / run:** Covered in Task 6.

**Verification commands:**
```bash
npm test -- --testPathPattern=family_coordination
```

**Constraints:**
- No new npm dependencies
- Keep existing `grantAccess` signature backward-compatible — `notificationPrefs` is optional

---

### Task 3 — Route: Add PATCH to `familyAccess.js`

**Purpose:** Expose an HTTP endpoint for owners to update a grantee's notification preferences.

**Files affected:**
- `src/routes/familyAccess.js`

**Dependencies:** Task 2

**Changes:**

```js
// Add after existing DELETE handler
router.patch('/:grantedToUserId', async (req, res, next) => {
  try {
    const data = await updateNotificationPrefs(
      req.user.id,
      req.params.memberId,
      req.params.grantedToUserId,
      req.body.notificationPrefs,
    )
    res.json({ data })
  } catch (err) { next(err) }
})
```

Also update the `POST` handler to pass `req.body.notificationPrefs` to `grantAccess`.

**Acceptance criteria:**
- `PATCH /api/v1/family-members/:memberId/access/:grantedToUserId` with valid body → 200 + updated record
- `PATCH` with non-existent grant → 404
- Non-owner calling `PATCH` → 403 (enforced inside `updateNotificationPrefs` via `assertOwnerForMember`)
- `POST` body with `notificationPrefs` stores prefs correctly

**Tests to add / run:** Covered in Task 6.

**Verification commands:**
```bash
npm test -- --testPathPattern=family_coordination
```

**Constraints:**
- Thin route — no logic in the handler, only service call
- No changes to GET or DELETE handlers

---

### Task 4 — Dispatch: Filter appointment reminders by prefs

**Purpose:** Make `dispatchDueReminders` skip caregivers who have `appointmentReminders: false`.

**Files affected:**
- `src/services/reminderDispatchService.js`

**Dependencies:** Task 2 (`parseNotificationPrefs` must be exported)

**Change — inside `dispatchDueReminders`:**

1. Update the `include` for `accessList` to also select `notificationPrefs`:
   ```js
   accessList: {
     where: { role: 'CAREGIVER' },
     include: { grantedTo: true },
     // notificationPrefs is already on the FamilyAccess record
   },
   ```
   (Prisma includes all scalar fields by default when using `include`, so `notificationPrefs` is already there.)

2. Replace the current recipient-building loop:
   ```js
   // Before (no filtering):
   for (const access of familyMember.accessList) {
     recipients.set(access.grantedTo.id, access.grantedTo.lineUserId)
   }

   // After (filter by prefs):
   import { parseNotificationPrefs } from './familyAccessService.js'

   for (const access of familyMember.accessList) {
     const prefs = parseNotificationPrefs(access.notificationPrefs)
     if (prefs.appointmentReminders) {
       recipients.set(access.grantedTo.id, access.grantedTo.lineUserId)
     }
   }
   ```

**Acceptance criteria:**
- Caregiver with `appointmentReminders: false` is excluded from dispatch
- Caregiver with `notificationPrefs: null` (default) still receives reminders
- Owner always receives reminders (owner is added before the loop, unaffected)
- Existing test `appointment_reminder.test.js` continues to pass (accessList is `[]` in those fixtures)

**Tests to add / run:** Covered in Task 6 (notification prefs test case).

**Verification commands:**
```bash
npm test
```

**Constraints:**
- Do not change the Prisma query shape in a way that breaks the existing `appointment_reminder.test.js` mock structure
- Owner recipient logic is untouched (line before the loop)

**Risk:** The Prisma query already uses `include: { grantedTo: true }` for `accessList`. Since `notificationPrefs` is a scalar on `FamilyAccess`, it is automatically included. No query change needed — only the loop changes.

---

### Task 5 — Dispatch: Filter medication reminders by prefs

**Purpose:** Make `getRecipients` in `medicationReminderDispatchService.js` aware of notification prefs, filtering by `medicationReminders` and `missedDoseAlerts` event types.

**Files affected:**
- `src/services/medicationReminderDispatchService.js`

**Dependencies:** Task 2 (`parseNotificationPrefs`)

**Changes:**

1. Update `getRecipients` signature: `getRecipients(familyMemberId, eventType)` where `eventType` is `'medicationReminders'` or `'missedDoseAlerts'`.

2. In the Prisma query, select `notificationPrefs` on each access entry:
   ```js
   accessList: {
     where: { role: 'CAREGIVER' },
     select: {
       notificationPrefs: true,          // ← add
       grantedTo: { select: { lineUserId: true } },
     },
   },
   ```

3. Filter caregivers in the recipient builder:
   ```js
   import { parseNotificationPrefs } from './familyAccessService.js'

   for (const a of member.accessList) {
     const prefs = parseNotificationPrefs(a.notificationPrefs)
     if (prefs[eventType]) {
       recipients.push(a.grantedTo.lineUserId)
     }
   }
   ```

4. Call sites:
   - `dispatchMedicationReminders` — reminder pass: `await getRecipients(med.familyMemberId, 'medicationReminders')`
   - `dispatchMedicationReminders` — missed-dose pass: `await getRecipients(med.familyMemberId, 'missedDoseAlerts')`

**Acceptance criteria:**
- Caregiver with `medicationReminders: false` does not receive medication reminder pushes
- Caregiver with `missedDoseAlerts: false` does not receive missed-dose alert pushes
- Null prefs defaults to both enabled
- Owner always receives both (owner `lineUserId` is pushed before the filtering loop)

**Tests to add / run:** Covered in Task 6.

**Verification commands:**
```bash
npm test
```

**Constraints:**
- `getRecipients` is exported and used by tests — the new `eventType` param must have a default value of `'medicationReminders'` to avoid breaking any existing callers

---

### Task 6 — Tests: `src/tests/family_coordination.test.js`

**Purpose:** Verify all five acceptance criteria from the feature spec using the established Jest + supertest + ESM mock pattern.

**Files affected:**
- `src/tests/family_coordination.test.js` (new file)

**Dependencies:** Tasks 2, 3, 4, 5

**Test structure:**

Mock modules (following `appointment_reminder.test.js` pattern):
```js
jest.unstable_mockModule('../lib/prisma.js', () => ({ prisma: { familyAccess: { ... } } }))
jest.unstable_mockModule('../services/linePushService.js', ...)
jest.unstable_mockModule('../services/accessService.js', ...)
jest.unstable_mockModule('../services/userService.js', ...)
```

**Test cases to implement:**

#### 1. Grant CAREGIVER access → grantee can read + write
```js
describe('POST /api/v1/family-members/:memberId/access — grant CAREGIVER', () => {
  test('201 + access record returned when owner grants CAREGIVER', async () => {
    // mockFamilyAccessUpsert returns a grant with role: 'CAREGIVER'
    // POST body: { grantedToLineUserId, role: 'CAREGIVER' }
    // expect res.status === 201, res.body.data.role === 'CAREGIVER'
  })

  test('assertOwnerForMember called before upsert', async () => {
    // verify mockAssertOwnerForMember was called with (userId, memberId)
  })
})
```

#### 2. Grant VIEWER access → grantee can read but not write (middleware enforces)
```js
describe('POST /api/v1/family-members/:memberId/access — grant VIEWER', () => {
  test('201 + role is VIEWER', async () => {
    // POST body: { grantedToLineUserId, role: 'VIEWER' }
    // expect res.body.data.role === 'VIEWER'
  })

  test('assertCanWriteMember rejects VIEWER role', async () => {
    // mockAssertCanWriteMember throws 403
    // attempt to write a resource → expect 403
  })
})
```

#### 3. Revoke access → grantee loses access
```js
describe('DELETE /api/v1/family-members/:memberId/access/:grantedToUserId — revoke', () => {
  test('204 when owner revokes existing grant', async () => {
    // mockFamilyAccessDeleteMany returns { count: 1 }
    // expect res.status === 204
  })

  test('404 when grant does not exist', async () => {
    // mockFamilyAccessDeleteMany returns { count: 0 }
    // expect res.status === 404, res.body.code === 'NOT_FOUND'
  })
})
```

#### 4. Notification prefs: disable appointment reminders → no push sent
```js
describe('dispatchDueReminders — notification prefs filtering', () => {
  test('caregiver with appointmentReminders:false does NOT receive push', async () => {
    // fakeReminder with accessList containing one caregiver with
    //   notificationPrefs: JSON.stringify({ appointmentReminders: false, ... })
    // mockReminderFindMany returns [fakeReminder()]
    // await dispatchDueReminders()
    // expect mockSendLinePush called once (owner only), not twice
    // expect mockSendLinePush not called with caregiver lineUserId
  })

  test('caregiver with null notificationPrefs (default) DOES receive push', async () => {
    // fakeReminder with accessList caregiver notificationPrefs: null
    // expect mockSendLinePush called twice (owner + caregiver)
  })
})
```

#### 5. Owner always retains access regardless of `FamilyAccess` table
```js
describe('owner access — always retained', () => {
  test('accessService returns OWNER role for member owner regardless of FamilyAccess', async () => {
    // mock getAccessRoleForMember to check it checks ownerId first
    // OR: test assertCanReadMember does not throw when called with ownerId
    // mock prisma.familyMember.findUnique returning { ownerId: USER_ID, accessList: [] }
    // call assertCanReadMember(USER_ID, MEMBER_ID) — should not throw
  })

  test('dispatchDueReminders always sends to owner even if no accessList entries', async () => {
    // fakeReminder with accessList: []
    // owner lineUserId added unconditionally before the loop
    // expect mockSendLinePush called exactly once with owner lineUserId
  })
})
```

**Verification commands:**
```bash
npm test -- --testPathPattern=family_coordination
npm test   # full suite must pass
```

**Constraints:**
- Follow ESM mock pattern from `appointment_reminder.test.js` exactly
- Mock `linePushService.js` to prevent real LINE calls
- `jest.clearAllMocks()` in `beforeEach`
- No real DB calls — all Prisma interactions mocked

---

## 8. Safest Implementation Order

```
Task 1 (schema)
  └─▶ Task 2 (service)
        ├─▶ Task 3 (route)
        ├─▶ Task 4 (reminder dispatch)
        └─▶ Task 5 (medication dispatch)
              └─▶ Task 6 (tests) ← runs after all implementation
```

Each task is independently testable. Tasks 3, 4, and 5 can be done in parallel once Task 2 is complete. Task 6 should be written and run last to validate the full chain.

---

## 9. Global Risks & Ambiguities

1. **Route path mismatch**: The feature spec uses `/api/v1/family/:id/access` but the codebase consistently uses `/api/v1/family-members/:memberId/access`. This plan uses the existing path. If the iOS client expects the spec path, a note to the mobile team is needed — do not silently add a duplicate route.

2. **No `Task` model exists**: The spec mentions "Volunteer or assign caregiving tasks." No tasks model or table exists in the schema. This plan treats that as a future feature and does not include it.

3. **Shared family calendar**: The spec mentions it, but appointments are already queryable by `familyMemberId` via `GET /api/v1/appointments?familyMemberId=...`. No new endpoint needed — this is a client-side composition.

4. **Who can call `PATCH` on notification prefs**: Plan assigns this to `OWNER only` (consistent with all other access management operations). If the grantee should be able to update their own prefs, that is a design change requiring a separate decision.

5. **VIEWER role and notifications**: The existing dispatch only sends to `CAREGIVER` role. If VIEWERs should also receive notifications, the dispatch `where: { role: 'CAREGIVER' }` filter must be changed. This plan leaves that filter unchanged to avoid scope creep.

6. **`grantAccess` upsert and prefs preservation**: On a role-update upsert (same user, same member), if `notificationPrefs` is not passed, the existing prefs should be preserved. The plan handles this by omitting the field from the `update` payload when `notificationPrefs === undefined`. Confirm this intent before implementing.
