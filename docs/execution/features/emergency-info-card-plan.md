# Emergency Info Card — Implementation Plan

## 1. Goal Summary

Add a read-only **Emergency Info Card** endpoint that aggregates all safety-critical data for a family member into a single structured JSON response, plus full **Emergency Contacts CRUD** sub-routes. The card endpoint is intended to be called by the LINE app's "share as image" flow; the backend only provides the data — rendering is a frontend concern.

**New routes:**
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/family-members/:memberId/emergency-card` | Aggregate card data |
| `GET` | `/api/v1/family-members/:memberId/emergency-contacts` | List contacts |
| `POST` | `/api/v1/family-members/:memberId/emergency-contacts` | Create contact |
| `PATCH` | `/api/v1/family-members/:memberId/emergency-contacts/:contactId` | Update contact |
| `DELETE` | `/api/v1/family-members/:memberId/emergency-contacts/:contactId` | Delete contact |

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | EmergencyContact model (already defined, may need migration) |
| `famcare-backend/prisma/migrations/` | Migration history; need to check if EmergencyContact is migrated |
| `famcare-backend/src/routes/familyMembers.js` | Will receive new sub-routes |
| `famcare-backend/src/routes/index.js` | No change needed (familyMembersRouter already registered) |
| `famcare-backend/src/services/accessService.js` | `assertCanReadMember`, `assertCanWriteMember` — reuse for auth |
| `famcare-backend/src/services/familyMemberService.js` | FamilyMember fetch patterns to mirror |
| `famcare-backend/src/services/medicationService.js` | Medication query patterns (active flag) |
| `famcare-backend/src/middleware/auth.js` | `requireLineUser` — applied by all routers |
| `famcare-backend/src/middleware/errorHandler.js` | Global error handler |
| `famcare-backend/src/utils/datetime.js` | `toBangkokISO()` — used in formatters |
| `famcare-backend/src/lib/prisma.js` | Prisma client singleton |
| `famcare-backend/src/tests/symptom_and_note_log.test.js` | Reference test pattern to follow exactly |

---

## 3. Data Model Changes

### EmergencyContact (Already in Schema)
```prisma
model EmergencyContact {
  id             String   @id @default(cuid())
  familyMemberId String
  name           String
  phone          String?
  relation       String?
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id], onDelete: Cascade)
}
```

The model is defined. **A Prisma migration must be run if one does not already exist.**

### FamilyMember (Existing Fields Used)
Fields already present and used by the card endpoint — no schema changes:
- `bloodType String?`
- `allergies String?`
- `conditions String?`
- `preferredHospital String?`

### Medication (Existing Field Used)
- `active Boolean @default(true)` — filter by `active: true` to return only current medications.

---

## 4. API Changes

### `GET /api/v1/family-members/:memberId/emergency-card`

**Auth:** Any user with at least `VIEWER` access (`assertCanReadMember`).

**Response 200:**
```json
{
  "data": {
    "memberId": "clxxx",
    "name": "Somchai Jaidee",
    "bloodType": "O+",
    "allergies": "Penicillin, Shellfish",
    "conditions": "Type 2 Diabetes, Hypertension",
    "preferredHospital": "Bangkok Hospital",
    "medications": [
      { "id": "clyyy", "name": "Metformin", "dosage": "500mg", "frequency": "2x daily" }
    ],
    "emergencyContacts": [
      { "id": "clzzz", "name": "Napa Jaidee", "phone": "0812345678", "relation": "Daughter", "sortOrder": 0 }
    ]
  }
}
```

**Edge cases:**
- `medications: []` when no active medications (never error).
- `emergencyContacts: []` when none added.
- Nullable fields (`bloodType`, `allergies`, etc.) returned as `null`.
- 404 if member does not exist or is soft-deleted.
- 403 if caller has no access.

---

### Emergency Contact CRUD

**`GET /:memberId/emergency-contacts`** — requires read access; returns ordered by `sortOrder ASC, createdAt ASC`.

**`POST /:memberId/emergency-contacts`** — requires write access; body: `{ name, phone?, relation?, sortOrder? }`.

**`PATCH /:memberId/emergency-contacts/:contactId`** — requires write access; partial update of any field.

**`DELETE /:memberId/emergency-contacts/:contactId`** — requires write access; returns 204.

**All contact endpoints:**
- Verify the contact belongs to the specified `memberId` before update/delete (prevent cross-member tampering).
- 404 if contact not found or belongs to a different member.

---

## 5. Frontend Changes

None. The backend returns structured JSON. Rendering, image generation, and LINE sharing are handled by the existing frontend/LINE miniapp.

---

## 6. Edge Cases

| Scenario | Expected Behaviour |
|----------|--------------------|
| Member has no active medications | `medications: []` — not an error |
| Member has no emergency contacts | `emergencyContacts: []` — not an error |
| Member's nullable fields are empty | Return `null`, not omit the key |
| Member is soft-deleted (`isDeleted: true`) | 404 |
| Caller is VIEWER trying to create a contact | 403 |
| PATCH contact belonging to different member | 404 |
| DELETE non-existent contact | 404 |
| Medication `active: false` | Excluded from card |
| `sortOrder` not provided on POST | Default to `0` |

---

## 7. Atomic Implementation Tasks

---

### Task 1 — Verify and Apply Prisma Migration

**Purpose:** Ensure the `EmergencyContact` table exists in the database before any other code runs.

**Files Affected:**
- `famcare-backend/prisma/migrations/` (new migration folder if needed)
- `famcare-backend/prisma/schema.prisma` (read-only check)

**Dependencies:** None.

**Acceptance Criteria:**
- Running `npx prisma migrate status` shows all migrations applied.
- `EmergencyContact` table exists in the DB.
- No changes to schema.prisma content (model is already correct).

**Steps:**
1. Check migration history: `ls famcare-backend/prisma/migrations/`
2. If no migration references `emergency_contact`, run:
   ```bash
   cd famcare-backend && npx prisma migrate dev --name add_emergency_contact
   ```
3. Commit the generated migration file.

**Verification Commands:**
```bash
cd famcare-backend && npx prisma migrate status
cd famcare-backend && npx prisma studio  # visually confirm table
```

**Constraints:** Do not modify schema.prisma.

**Risks:** If migrations are out of sync (shadow database issues), run `npx prisma migrate resolve` or reset dev DB. Do not run `migrate reset` in production.

---

### Task 2 — Emergency Contact Service

**Purpose:** Implement CRUD business logic for emergency contacts in a dedicated service file.

**Files Affected:**
- `famcare-backend/src/services/emergencyContactService.js` ← **new file**

**Dependencies:** Task 1 (table must exist to test manually; mocked in unit tests).

**Acceptance Criteria:**
- Exports: `listEmergencyContacts`, `createEmergencyContact`, `updateEmergencyContact`, `deleteEmergencyContact`.
- `createEmergencyContact` validates `name` is non-empty string; throws `{ status: 400, code: 'BAD_REQUEST' }` if missing.
- `updateEmergencyContact` / `deleteEmergencyContact` verify contact belongs to `familyMemberId`; throws `{ status: 404, code: 'NOT_FOUND' }` if not.
- All functions call `assertCanReadMember` or `assertCanWriteMember` first.
- Returned records formatted with `toBangkokISO()` for `createdAt` / `updatedAt`.
- No new npm dependencies.

**Implementation Sketch:**
```js
// src/services/emergencyContactService.js
import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

function formatContact(c) {
  return { ...c, createdAt: toBangkokISO(c.createdAt), updatedAt: toBangkokISO(c.updatedAt) }
}

export async function listEmergencyContacts(actorUserId, familyMemberId) {
  await assertCanReadMember(actorUserId, familyMemberId)
  const contacts = await prisma.emergencyContact.findMany({
    where: { familyMemberId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return contacts.map(formatContact)
}

export async function createEmergencyContact(actorUserId, familyMemberId, body) {
  await assertCanWriteMember(actorUserId, familyMemberId)
  const { name, phone, relation, sortOrder = 0 } = body
  if (!name?.trim()) throw Object.assign(new Error('name is required'), { status: 400, code: 'BAD_REQUEST' })
  const contact = await prisma.emergencyContact.create({
    data: { familyMemberId, name: name.trim(), phone, relation, sortOrder },
  })
  return formatContact(contact)
}

export async function updateEmergencyContact(actorUserId, familyMemberId, contactId, body) {
  await assertCanWriteMember(actorUserId, familyMemberId)
  const existing = await prisma.emergencyContact.findFirst({ where: { id: contactId, familyMemberId } })
  if (!existing) throw Object.assign(new Error('Contact not found'), { status: 404, code: 'NOT_FOUND' })
  const { name, phone, relation, sortOrder } = body
  const contact = await prisma.emergencyContact.update({
    where: { id: contactId },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(phone !== undefined && { phone }),
      ...(relation !== undefined && { relation }),
      ...(sortOrder !== undefined && { sortOrder }),
    },
  })
  return formatContact(contact)
}

export async function deleteEmergencyContact(actorUserId, familyMemberId, contactId) {
  await assertCanWriteMember(actorUserId, familyMemberId)
  const existing = await prisma.emergencyContact.findFirst({ where: { id: contactId, familyMemberId } })
  if (!existing) throw Object.assign(new Error('Contact not found'), { status: 404, code: 'NOT_FOUND' })
  await prisma.emergencyContact.delete({ where: { id: contactId } })
}
```

**Constraints:** Follow existing service patterns exactly. No new dependencies.

**Risks:** `updateEmergencyContact` with empty `name: ""` — validate trimmed name is non-empty if provided.

---

### Task 3 — Emergency Card Aggregate Service

**Purpose:** Implement the read-only aggregate endpoint that collects member info, active medications, and emergency contacts into a single response.

**Files Affected:**
- `famcare-backend/src/services/emergencyCardService.js` ← **new file**

**Dependencies:** Task 1, Task 2 (conceptually; can be written in parallel).

**Acceptance Criteria:**
- Exports single function `getEmergencyCard(actorUserId, familyMemberId)`.
- Fetches member, verifies not soft-deleted (throws 404 if `isDeleted: true`).
- Returns active medications only (`active: true`).
- Returns emergency contacts ordered by `sortOrder ASC, createdAt ASC`.
- Nullable member fields (`bloodType`, etc.) returned as `null`, never omitted.
- Calls `assertCanReadMember` first.
- No new dependencies.

**Implementation Sketch:**
```js
// src/services/emergencyCardService.js
import { prisma } from '../lib/prisma.js'
import { assertCanReadMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

export async function getEmergencyCard(actorUserId, familyMemberId) {
  await assertCanReadMember(actorUserId, familyMemberId)

  const member = await prisma.familyMember.findFirst({
    where: { id: familyMemberId, isDeleted: false },
    include: {
      medications: {
        where: { active: true },
        select: { id: true, name: true, dosage: true, frequency: true },
      },
      emergencyContacts: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })

  if (!member) throw Object.assign(new Error('Member not found'), { status: 404, code: 'NOT_FOUND' })

  return {
    memberId: member.id,
    name: member.name,
    bloodType: member.bloodType ?? null,
    allergies: member.allergies ?? null,
    conditions: member.conditions ?? null,
    preferredHospital: member.preferredHospital ?? null,
    medications: member.medications,
    emergencyContacts: member.emergencyContacts.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      relation: c.relation ?? null,
      sortOrder: c.sortOrder,
      createdAt: toBangkokISO(c.createdAt),
      updatedAt: toBangkokISO(c.updatedAt),
    })),
  }
}
```

**Constraints:** No new dependencies. Keep as a single Prisma query with `include` for performance.

**Risks:** If Medication model adds more fields later, the `select` may need updating. Keep the selected fields minimal and intentional.

---

### Task 4 — Routes (familyMembers.js additions)

**Purpose:** Wire the service functions to HTTP routes following existing patterns.

**Files Affected:**
- `famcare-backend/src/routes/familyMembers.js` ← **modify**

**Dependencies:** Tasks 2 and 3 (services must exist before routes import them).

**Acceptance Criteria:**
- `GET /:memberId/emergency-card` → 200 `{ data: ... }`
- `GET /:memberId/emergency-contacts` → 200 `{ data: [...] }`
- `POST /:memberId/emergency-contacts` → 201 `{ data: ... }`
- `PATCH /:memberId/emergency-contacts/:contactId` → 200 `{ data: ... }`
- `DELETE /:memberId/emergency-contacts/:contactId` → 204 (no body)
- All routes protected by `requireLineUser` (already applied at top of router).
- All errors forwarded to `next(err)`.

**Implementation Snippet (append to familyMembers.js):**
```js
import { getEmergencyCard } from '../services/emergencyCardService.js'
import {
  listEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
} from '../services/emergencyContactService.js'

// Emergency card
router.get('/:memberId/emergency-card', async (req, res, next) => {
  try {
    const data = await getEmergencyCard(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

// Emergency contacts CRUD
router.get('/:memberId/emergency-contacts', async (req, res, next) => {
  try {
    const data = await listEmergencyContacts(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/:memberId/emergency-contacts', async (req, res, next) => {
  try {
    const data = await createEmergencyContact(req.user.id, req.params.memberId, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.patch('/:memberId/emergency-contacts/:contactId', async (req, res, next) => {
  try {
    const data = await updateEmergencyContact(req.user.id, req.params.memberId, req.params.contactId, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:memberId/emergency-contacts/:contactId', async (req, res, next) => {
  try {
    await deleteEmergencyContact(req.user.id, req.params.memberId, req.params.contactId)
    res.status(204).send()
  } catch (err) { next(err) }
})
```

**Constraints:** Do not modify `src/routes/index.js` — `familyMembersRouter` is already registered. Keep try/catch + `next(err)` pattern.

**Risks:** Order of route declarations matters. These routes must not conflict with existing `/:memberId` GET/PATCH/DELETE routes already in the file.

---

### Task 5 — Tests

**Purpose:** Write and run all tests for the emergency info card feature.

**Files Affected:**
- `famcare-backend/src/tests/emergency_info_card.test.js` ← **new file**

**Dependencies:** Tasks 2, 3, 4 (all services and routes must exist to import them in tests).

**Acceptance Criteria (test cases):**
- `GET /emergency-card` → 200 with all fields populated correctly
- `GET /emergency-card` → 200 with `medications: []` when none active
- `GET /emergency-card` → 200 with `emergencyContacts: []` when none
- `GET /emergency-card` → 404 when member not found or soft-deleted
- `GET /emergency-card` → 403 when caller lacks access
- `GET /emergency-card` → 401 when `x-line-userid` header missing
- `GET /emergency-contacts` → 200 with contact list
- `POST /emergency-contacts` → 201 creates contact
- `POST /emergency-contacts` → 400 when `name` missing
- `PATCH /emergency-contacts/:contactId` → 200 updates contact
- `PATCH /emergency-contacts/:contactId` → 404 for wrong member
- `DELETE /emergency-contacts/:contactId` → 204 success
- `DELETE /emergency-contacts/:contactId` → 404 for non-existent contact

**Test pattern to follow exactly** (from `symptom_and_note_log.test.js`):
```js
import { jest } from '@jest/globals'

const MEMBER_ID = 'member-1'
const USER_ID = 'user-1'
const LINE_ID = 'Uabc123'
const AUTH = { 'x-line-userid': LINE_ID }

const mockGetEmergencyCard = jest.fn()
const mockListEmergencyContacts = jest.fn()
const mockCreateEmergencyContact = jest.fn()
const mockUpdateEmergencyContact = jest.fn()
const mockDeleteEmergencyContact = jest.fn()
const mockFindOrCreate = jest.fn()

jest.unstable_mockModule('../services/emergencyCardService.js', () => ({
  getEmergencyCard: mockGetEmergencyCard,
}))
jest.unstable_mockModule('../services/emergencyContactService.js', () => ({
  listEmergencyContacts: mockListEmergencyContacts,
  createEmergencyContact: mockCreateEmergencyContact,
  updateEmergencyContact: mockUpdateEmergencyContact,
  deleteEmergencyContact: mockDeleteEmergencyContact,
}))
jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

// Dynamic imports AFTER mock registration
const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: router } = await import('../routes/familyMembers.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/family-members', router)
app.use(errorHandler)

const request = supertest(app)

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID })
})
```

**Verification Commands:**
```bash
cd famcare-backend && npm test -- --testPathPattern=emergency_info_card
cd famcare-backend && npm test
```

**Constraints:** Follow ESM mocking pattern exactly. No real DB calls. No new test dependencies.

**Risks:**
- `familyMembers.js` router also has existing routes — the test app will mount the full router, so existing route mocks may need to be included. Only mock what the new tests exercise.
- If `userService.js` is named differently (e.g., `lineUserService.js`), check the actual import name used by `auth.js`.

---

## 9. Safest Implementation Order

```
Task 1 (Migration)
    ↓
Task 2 (Contact Service) ──┐
Task 3 (Card Service)     ─┤ (can be written in parallel)
    ↓                      │
Task 4 (Routes) ←──────────┘
    ↓
Task 5 (Tests)
```

Tasks 2 and 3 are independent of each other and can be written simultaneously. Task 4 depends on both. Task 5 must come last.

---

## 10. Global Risks and Ambiguities

| Risk | Detail | Mitigation |
|------|--------|------------|
| **Migration status unclear** | EmergencyContact is in schema.prisma but the migration may not exist (schema.prisma shows as modified in git). | Run `npx prisma migrate status` before writing any code. Generate migration if needed. |
| **familyMembers.js route conflicts** | The new `/:memberId/emergency-card` route must not shadow existing `/:memberId` patterns (GET/PATCH/DELETE on member itself). | Add new routes after existing specific-ID routes; Express evaluates in declaration order. |
| **userService import name** | Tests must mock the exact module path used by `auth.js` for `findOrCreateByLineUserId`. The path may be `userService.js` or `lineUserService.js`. | Read `auth.js` import before writing the test mock. |
| **Medication fields in card** | The card returns `name`, `dosage`, `frequency` from Medication. Confirm these field names exist in the Prisma schema before Task 3. | Cross-check schema during Task 3. |
| **Access service role** | `assertCanReadMember` may throw 403 for VIEWER or only for no-access. Confirm the exact permission level required for the card (read = VIEWER OK). | Check `accessService.js` implementation; VIEWER should be sufficient for the card read. |
| **Soft-delete check** | The aggregate query must filter `isDeleted: false`. Missing this filter would return data for deleted members. | Always include `isDeleted: false` in `findFirst` for member lookups. |

---

## 11. Output Location

Save this file to:
```
docs/execution/features/emergency-info-card-plan.md
```
