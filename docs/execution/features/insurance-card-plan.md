# Insurance Card Feature — Implementation Plan

> Generated for agent consumption. Do not implement code until all tasks are confirmed.

---

## Context

FamCare is a LINE-based family health coordination backend (Express + PostgreSQL). It already has mature patterns for CRUD features (Documents, Medications), file uploads (Cloudinary), OCR (`ocrService.js`), cron-based reminders, and role-based access control (OWNER/CAREGIVER/VIEWER). This feature adds insurance card management with photo upload, OCR auto-fill, role-based field masking, and expiration reminders — all following existing patterns exactly.

---

## 1. Goal Summary

Add a complete Insurance Card feature:
1. Prisma model with all required fields + migration
2. REST API: POST (create with optional photo upload + OCR), GET list, GET by id, PATCH, DELETE (soft)
3. OCR: upload front/back photos → Cloudinary, run OCR, parse structured fields, return for user confirmation
4. Role enforcement: VIEWER sees masked `policyNumber` (last 4 digits) unless `allowViewerFullAccess: true`
5. Status computed at read time: ACTIVE (>30d), EXPIRING (≤30d), EXPIRED (past)
6. Daily cron: send LINE push at 60d/30d/7d before expiration (one-shot per threshold)
7. Full test suite covering all 12 specified test cases

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | Add `InsuranceCard` model + relation |
| `famcare-backend/src/routes/index.js` | Mount insurance router |
| `famcare-backend/src/middleware/upload.js` | Add `uploadInsurancePhotos` (multer `.fields()`) |
| `famcare-backend/src/services/accessService.js` | `assertCanReadMember` (returns role), `assertCanWriteMember` |
| `famcare-backend/src/services/ocrService.js` | `extractText(imageUrl)` — reuse as-is |
| `famcare-backend/src/services/cloudinaryService.js` | `uploadBuffer()`, `deleteByPublicId()` — reuse as-is |
| `famcare-backend/src/services/linePushService.js` | `sendLinePushToUser()` — reuse as-is |
| `famcare-backend/src/services/caregiverNotifyService.js` | `notifyOwnerIfCaregiver()` — reuse as-is |
| `famcare-backend/src/services/medicationReminderDispatchService.js` | `getRecipients(familyMemberId, eventType)` — reuse for cron recipients |
| `famcare-backend/src/services/familyAccessService.js` | `parseNotificationPrefs()` — used by getRecipients |
| `famcare-backend/src/jobs/cron.js` | Register daily expiration check cron |
| `famcare-backend/src/utils/datetime.js` | `toBangkokISO()`, `bangkokCalendarDate()` |
| `famcare-backend/src/services/documentService.js` | Reference pattern for upload + OCR flow |
| `famcare-backend/src/tests/appointment_management.test.js` | Reference test pattern |

---

## 3. Data Model Changes

### `famcare-backend/prisma/schema.prisma`

**Add `InsuranceCard` model** (after `Document` model):

```prisma
model InsuranceCard {
  id                    String   @id @default(cuid())
  familyMemberId        String
  addedByUserId         String
  companyName           String?
  policyNumber          String?
  groupNumber           String?
  expirationDate        DateTime?
  policyHolderName      String?
  dependentRelationship String?
  customerServicePhone  String?
  emergencyPhone        String?
  coverageType          String?   // JSON array as string, e.g. '["dental","vision"]'
  coverageSummary       String?
  frontPhotoUrl         String?
  backPhotoUrl          String?
  frontPhotoPublicId    String?
  backPhotoPublicId     String?
  extractedText         String?   // Raw OCR output
  isDeleted             Boolean  @default(false)
  allowViewerFullAccess Boolean  @default(false)
  reminder60dSent       Boolean  @default(false)
  reminder30dSent       Boolean  @default(false)
  reminder7dSent        Boolean  @default(false)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id], onDelete: Cascade)
}
```

**Add relation to `FamilyMember`**: `insuranceCards InsuranceCard[]`

**Migration:**
```bash
cd famcare-backend && npx prisma migrate dev --name add-insurance-card
```

---

## 4. API Changes

### New endpoints (all under `/api/v1/insurance`)

| Method | Path | Description |
|--------|------|-------------|
| `POST /insurance` | Create card (multipart: optional `frontPhoto`, `backPhoto` files + JSON body fields). Returns created card with `ocrSuccess` flag and `extractedFields` |
| `GET /insurance?memberId=` | List non-deleted cards for a family member. Status computed. PolicyNumber masked for VIEWER |
| `GET /insurance/:id` | Get single card by ID. Same masking rules |
| `PATCH /insurance/:id` | Partial update. Accepts optional new photos. Resets reminder flags if `expirationDate` changes |
| `DELETE /insurance/:id` | Soft delete (`isDeleted: true`). Returns 204 |

### Response shape (single card)

```json
{
  "data": {
    "id": "...",
    "familyMemberId": "...",
    "companyName": "AIA",
    "policyNumber": "****5678",       // masked for VIEWER
    "groupNumber": "GRP-001",
    "expirationDate": "2027-01-15T00:00:00+07:00",
    "policyHolderName": "สมชาย",
    "dependentRelationship": "spouse",
    "customerServicePhone": "1581",
    "emergencyPhone": "02-xxx-xxxx",
    "coverageType": ["dental", "vision", "medical"],
    "coverageSummary": "ทันตกรรม 20,000/ปี...",
    "frontPhotoUrl": "https://res.cloudinary.com/...",
    "backPhotoUrl": "https://res.cloudinary.com/...",
    "extractedText": "AIA HEALTH HAPPY...",
    "status": "ACTIVE",
    "allowViewerFullAccess": false,
    "isDeleted": false,
    "createdAt": "2026-04-22T10:00:00+07:00",
    "updatedAt": "2026-04-22T10:00:00+07:00"
  }
}
```

### POST response (with OCR) adds:

```json
{
  "data": { ...card },
  "ocrSuccess": true,
  "extractedFields": {
    "companyName": "AIA",
    "policyNumber": "1234567890",
    "groupNumber": null,
    "policyHolderName": "สมชาย ใจดี",
    "expirationDate": null,
    "customerServicePhone": "1581",
    "emergencyPhone": null
  }
}
```

---

## 5. Frontend Changes

**None.** This is backend-only. iOS app and web dashboard are separate repos.

---

## 6. Edge Cases

- OCR returns empty/unreadable text → `ocrSuccess: false`, empty `extractedFields`, card still created
- Thai text on card → stored as-is in `extractedText` (PostgreSQL handles UTF-8 natively)
- No `expirationDate` → `status: null`, skipped by cron
- `expirationDate` updated → reminder flags (`reminder60dSent`, etc.) reset to `false`
- VIEWER with `allowViewerFullAccess: true` → full `policyNumber` shown
- `policyNumber` shorter than 4 chars → mask as `****`
- Multiple cards per family member → all returned independently
- Soft-deleted cards → excluded from list/get, Cloudinary assets retained
- Card with photos deleted → Cloudinary cleanup fire-and-forget (same as Document pattern)
- `coverageType` not valid JSON → store as-is (treat as plain string)

---

## 7. Implementation Tasks

---

### Task 1 — Prisma Schema + Migration

**Purpose:** Add the `InsuranceCard` model and database table.

**Files affected:**
- `famcare-backend/prisma/schema.prisma`

**Changes:**
1. Add `InsuranceCard` model (see §3 above)
2. Add `insuranceCards InsuranceCard[]` to `FamilyMember` model

**Acceptance criteria:**
- `npx prisma validate` passes
- Migration creates `InsuranceCard` table with all columns, FK to `FamilyMember`, cascade delete
- No existing data or models affected

**Verification:**
```bash
cd famcare-backend && npx prisma validate
npx prisma migrate dev --name add-insurance-card
```

**Constraints:** No other schema changes. Additive only.

**Risks:** None — new table, no impact on existing data.

**Dependencies:** None — start here.

---

### Task 2 — Multer Fields Upload Middleware

**Purpose:** Support multipart upload of two optional photo fields (`frontPhoto`, `backPhoto`).

**Files affected:**
- `famcare-backend/src/middleware/upload.js`

**Changes:**
Add a new export `uploadInsurancePhotos` using `multer.fields()`:
```js
export const uploadInsurancePhotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: imageFileFilter,  // reuse existing filter
}).fields([
  { name: 'frontPhoto', maxCount: 1 },
  { name: 'backPhoto', maxCount: 1 },
])
```

**Acceptance criteria:**
- `req.files.frontPhoto[0]` and `req.files.backPhoto[0]` available when photos sent
- File type/size validation unchanged
- Existing exports (`uploadSingle`, `uploadAudio`) unmodified

**Verification:** Covered by Task 6 tests.

**Constraints:** Reuse existing mime type set and file size constant. No new dependencies.

**Risks:** `multer.fields()` puts files in `req.files` (object keyed by name), not `req.file`. Route must read accordingly.

**Dependencies:** None — can parallel with Task 1.

---

### Task 3 — Insurance Card Service

**Purpose:** All business logic for insurance card CRUD, OCR parsing, role-based masking, and expiration dispatch.

**Files affected:**
- `famcare-backend/src/services/insuranceService.js` (NEW)

**Exported functions:**
1. `createInsuranceCard(actorUserId, body)` — validate `familyMemberId` required, `assertCanWriteMember`, upload photos to Cloudinary (folder: `famcare/insurance/{familyMemberId}`), run OCR via `extractText()` on each photo (in parallel with `Promise.allSettled`), parse extracted text into structured fields, create Prisma record, fire-and-forget `notifyOwnerIfCaregiver`. Returns `{ card, ocrSuccess, extractedFields }`.
2. `listInsuranceCards(actorUserId, { familyMemberId })` — validate memberId, `assertCanReadMember` (capture role), query `isDeleted: false`, compute status, mask policyNumber for VIEWER.
3. `getInsuranceCard(actorUserId, cardId)` — find by id, check `isDeleted`, `assertCanReadMember` (capture role), compute status, mask.
4. `updateInsuranceCard(actorUserId, cardId, body)` — find card, `assertCanWriteMember`, update only provided fields. If new photos: delete old Cloudinary assets, upload new, re-run OCR. **If `expirationDate` changes: reset `reminder60dSent`, `reminder30dSent`, `reminder7dSent` to false.** Fire-and-forget `notifyOwnerIfCaregiver`.
5. `deleteInsuranceCard(actorUserId, cardId)` — find card, `assertCanWriteMember`, set `isDeleted: true`.
6. `dispatchExpirationReminders()` — cron entry point. Query non-deleted cards with `expirationDate` set. Compute days until expiry in Bangkok time. For each threshold (60/30/7), if within range and flag is false, send LINE push via `getRecipients(familyMemberId, 'medicationReminders')`, set flag true.

**Private helpers:**
- `computeStatus(expirationDate)` — `null` if no date, `'EXPIRED'` if past, `'EXPIRING'` if ≤30d, `'ACTIVE'` if >30d
- `maskPolicyNumber(policyNumber)` — `'****' + last4` or `'****'` if <4 chars, `null` if null
- `parseInsuranceOcrText(rawText)` — best-effort regex extraction of companyName, policyNumber, groupNumber, policyHolderName, customerServicePhone, emergencyPhone, expirationDate. Returns object with all nullable fields. Conservative: returns null for uncertain matches.
- `formatCard(card, role)` — apply `toBangkokISO` to `expirationDate`/`createdAt`/`updatedAt`, compute status, parse `coverageType` JSON to array, conditionally mask policyNumber based on role + `allowViewerFullAccess`

**Key patterns to reuse:**
- Import `prisma` from `../lib/prisma.js`
- Import `assertCanReadMember`, `assertCanWriteMember` from `./accessService.js` — both return role string
- Import `uploadBuffer`, `deleteByPublicId` from `./cloudinaryService.js`
- Import `extractText` from `./ocrService.js`
- Import `notifyOwnerIfCaregiver` from `./caregiverNotifyService.js`
- Import `getRecipients` from `./medicationReminderDispatchService.js`
- Import `sendLinePushToUser` from `./linePushService.js`
- Import `toBangkokISO`, `bangkokCalendarDate` from `../utils/datetime.js`
- OCR is **synchronous** (not fire-and-forget like Document) because user needs pre-filled fields. Wrap in try/catch; on failure set `ocrSuccess: false`.
- Error convention: `throw Object.assign(new Error('msg'), { status: N, code: 'CODE' })`

**Acceptance criteria:**
- CRUD works with proper access control
- OCR runs on create, extracted fields returned for confirmation
- OCR failure → 201 with `ocrSuccess: false`, empty `extractedFields`
- VIEWER sees masked policyNumber; OWNER/CAREGIVER see full
- Status computed correctly: ACTIVE/EXPIRING/EXPIRED/null
- Soft delete works; deleted cards excluded from list/get
- Expiration cron sends LINE push at 60/30/7d thresholds, once per threshold per card
- `expirationDate` update resets reminder flags

**Constraints:** No new npm dependencies. Reuse existing `ocrService.extractText()`.

**Risks:**
- OCR parsing is best-effort. Insurance cards vary wildly in format. Parser should be conservative.
- Synchronous OCR may take 3-6s for two photos. Mitigate with `Promise.allSettled` for parallel execution.
- `getRecipients` uses `medicationReminders` as default eventType. For insurance, we'll pass the same since there's no separate `insuranceReminders` pref yet — document this as a known simplification.

**Dependencies:** Task 1 (schema), Task 2 (multer).

---

### Task 4 — Insurance Card Routes + Route Registration

**Purpose:** Thin route handlers + mount in the API router.

**Files affected:**
- `famcare-backend/src/routes/insurance.js` (NEW)
- `famcare-backend/src/routes/index.js` (add mount)

**Route file pattern** (follow `documents.js` exactly):
```
POST   /           — uploadInsurancePhotos middleware, then createInsuranceCard
GET    /           — listInsuranceCards (query: memberId)
GET    /:id        — getInsuranceCard
PATCH  /:id        — uploadInsurancePhotos middleware, then updateInsuranceCard
DELETE /:id        — deleteInsuranceCard
```

In `routes/index.js` add:
```js
import insuranceRouter from './insurance.js'
router.use('/insurance', insuranceRouter)
```

**Acceptance criteria:**
- All 5 endpoints accessible at `/api/v1/insurance`
- POST and PATCH accept multipart form data with optional photos
- Routes are thin — parse params, call service, return `{ data }` or `204`
- `requireLineUser` middleware applied (via router-level `.use()`)

**Constraints:** Follow existing route pattern exactly. No business logic in routes.

**Risks:** Route order: `:id` routes must not shadow each other. Since there are no sub-resource routes (like `/insurance/:id/something`), this is not a concern.

**Dependencies:** Task 2 (multer), Task 3 (service).

---

### Task 5 — Expiration Reminder Cron Registration

**Purpose:** Wire the daily cron job that checks insurance card expirations.

**Files affected:**
- `famcare-backend/src/jobs/cron.js`

**Changes:**
Import `dispatchExpirationReminders` from `insuranceService.js`. Add:
```js
cron.schedule('0 9 * * *', async () => {
  try { await dispatchExpirationReminders() }
  catch (err) { console.error('[cron] dispatchExpirationReminders error:', err.message) }
}, { timezone: 'Asia/Bangkok' })
```

Runs daily at 09:00 Bangkok (after the 08:00 low-stock alert).

**Acceptance criteria:**
- Cron fires at 09:00 Bangkok daily
- Errors logged, not thrown (won't crash the server)
- Follows exact pattern of existing `checkLowStockAlerts` registration

**Constraints:** One line of import + cron schedule block. Minimal change.

**Risks:** None — additive.

**Dependencies:** Task 3 (service function exists).

---

### Task 6 — Test Suite

**Purpose:** Comprehensive Jest + supertest tests covering all 12 specified test cases.

**Files affected:**
- `famcare-backend/src/tests/insurance_card.test.js` (NEW)

**Mock setup** (follow `appointment_management.test.js`):
```js
// 1. Declare mock fn handles
const mockCreate = jest.fn()
const mockFindMany = jest.fn()
const mockFindUnique = jest.fn()
const mockUpdate = jest.fn()
// ... etc

// 2. jest.unstable_mockModule for ESM
jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: { insuranceCard: { create: mockCreate, findMany: mockFindMany, ... } }
}))
jest.unstable_mockModule('../services/accessService.js', () => ({ ... }))
jest.unstable_mockModule('../services/userService.js', () => ({ ... }))
jest.unstable_mockModule('../services/cloudinaryService.js', () => ({ ... }))
jest.unstable_mockModule('../services/ocrService.js', () => ({ ... }))
jest.unstable_mockModule('../services/linePushService.js', () => ({ ... }))
jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({ ... }))
jest.unstable_mockModule('../services/medicationReminderDispatchService.js', () => ({ ... }))

// 3. Dynamic imports
const { default: express } = await import('express')
// ... etc
```

**12 test cases:**

| # | Test | Key Assertions |
|---|------|----------------|
| 1 | POST with front/back photos | `uploadBuffer` called 2x, `extractText` called, response has URLs + extracted fields + `ocrSuccess: true` |
| 2 | POST manual entry (no photo) | Card created, `uploadBuffer` not called, `extractText` not called, 201 |
| 3 | GET list by memberId | Returns only cards for queried member, `isDeleted: false` filter in Prisma call |
| 4 | GET by VIEWER role | `policyNumber` masked to `****5678` format |
| 5 | GET by CAREGIVER/OWNER | Full `policyNumber` returned |
| 6 | PATCH partial update | Only sent fields updated, mock `update` receives partial data |
| 7 | DELETE soft-deletes | `update` called with `{ isDeleted: true }`, returns 204 |
| 8 | Status computation | Future date → ACTIVE, within 30d → EXPIRING, past → EXPIRED, null date → null |
| 9 | Expiration cron 60d/30d/7d | Mock cards at each threshold, verify `sendLinePushToUser` called, flags updated |
| 10 | OCR failure | `extractText` throws, response 201 with `ocrSuccess: false`, empty extracted fields |
| 11 | Thai text | Card with Thai `companyName`/`policyHolderName`, stored and returned correctly |
| 12 | Multiple cards per member | 2 cards for member A, 1 for member B. GET for A returns 2, no B leakage |

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=insurance_card
npm test   # full suite still passes
```

**Constraints:** No new test dependencies. All external services mocked. No real Cloudinary/LINE/OCR calls.

**Risks:** Multer multipart in supertest requires `attach()` for files and `field()` for body fields (not `.send()`). Follow the pattern used in `document_upload.test.js` if it exists, otherwise use supertest's multipart API.

**Dependencies:** Task 3 (service), Task 4 (routes), Task 5 (cron function).

---

## 8. (Intentionally merged into §7 — each task has acceptance criteria inline)

---

## 9. Safe Implementation Order

```
Task 1 (Schema + Migration)     ←── start here
Task 2 (Multer middleware)       ←── parallel with Task 1
    │
    ▼
Task 3 (Service)                 ←── depends on Task 1 + Task 2
    │
    ├──▶ Task 4 (Routes)        ←── depends on Task 3
    │
    └──▶ Task 5 (Cron)          ←── depends on Task 3, parallel with Task 4
         │
         ▼
Task 6 (Tests)                   ←── depends on Tasks 3 + 4 + 5
```

**Recommended sequence:** 1 → 2 → 3 → 4 → 5 → 6

**Parallelizable pairs:** (Task 1 + Task 2), (Task 4 + Task 5)

---

## 10. Global Risks & Ambiguities

| Risk | Detail | Mitigation |
|------|--------|-----------|
| **OCR parsing accuracy** | Insurance cards vary wildly (Thai/English, different insurers). `parseInsuranceOcrText` will miss many fields. | Parser is conservative — returns `null` for uncertain fields. Raw `extractedText` always preserved. User confirms/corrects pre-filled fields via PATCH. |
| **Synchronous OCR latency** | Two photos = two OCR calls = 3-6 seconds on POST. | Run both `extractText` calls in parallel with `Promise.allSettled`. |
| **Expiration date update resets reminders** | If `expirationDate` is PATCHed, old reminder flags are stale. | PATCH handler resets `reminder60dSent/30d/7d` to `false` when `expirationDate` changes. |
| **No `insuranceReminders` notification pref** | `getRecipients` takes an `eventType` that maps to `FamilyAccess.notificationPrefs`. There's no `insuranceReminders` key. | Reuse `medicationReminders` as the event type for now. Document as known simplification. Can add a separate pref later. |
| **Boolean reminder flags are one-shot** | Unlike date-string idempotency (which resets daily), these are per-card-lifetime flags. If a card is created with `expirationDate` already within 60d, all 3 thresholds may fire on the same day. | This is acceptable — the cron checks `<=60`, `<=30`, `<=7` with `else-if` ordering: only the tightest matching threshold fires per run. Next run picks up the next threshold. |
| **`coverageType` validation** | Stored as JSON string but could be malformed. | Service accepts any string. `formatCard` attempts `JSON.parse` and falls back to wrapping in array if it fails. |
| **Soft-deleted cards retain Cloudinary assets** | Unlike hard delete, soft delete doesn't clean up photos. | Acceptable — same pattern as `FamilyMember.isDeleted`. A future cleanup job could purge old soft-deleted records. |
| **Bangkok timezone for expiration computation** | `expirationDate` is a UTC DateTime. Days-until-expiry must compare Bangkok calendar dates, not raw UTC. | Use `bangkokCalendarDate()` for both "today" and the expiration date to get correct Bangkok-local day comparison. |

---

## 11. Output Location

This plan should be saved to: `docs/execution/features/insurance-card-plan.md`
