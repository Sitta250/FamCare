# Symptom & Notes Log — Implementation Plan

## 1. Goal Summary

Extend the existing (partially-implemented) `SymptomLog` feature with:

- **Photo upload** to Cloudinary, storing `photoUrl` on the log
- **Voice note upload** to Cloudinary (audio files), storing `voiceNoteUrl` on the log
- **Date-range filtering** (`from`/`to`) on the list endpoint
- **Field rename**: `attachmentUrl` → `photoUrl` + new `voiceNoteUrl` column in schema
- **Comprehensive test suite** in `src/tests/symptom_and_note_log.test.js`

The core CRUD routes, service functions, and Prisma model already exist. No new routes file or new service file needs to be created from scratch — this is additive work on top of existing scaffolding.

---

## 2. Existing Files/Modules Likely Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | Schema source of truth — SymptomLog model (line 204) |
| `src/routes/symptomLogs.js` | All HTTP routes for symptom logs |
| `src/services/symptomLogService.js` | All business logic for symptom logs |
| `src/middleware/upload.js` | Multer config — currently allows image + PDF only |
| `src/services/cloudinaryService.js` | `uploadBuffer(buffer, opts)` + `deleteByPublicId(id)` |
| `src/services/accessService.js` | `assertCanReadMember` / `assertCanWriteMember` |
| `src/services/caregiverNotifyService.js` | `notifyOwnerIfCaregiver` (fire-and-forget) |
| `src/utils/datetime.js` | `toBangkokISO()` — must be applied to all DateTime fields |
| `src/lib/prisma.js` | Prisma client singleton |
| `src/middleware/errorHandler.js` | Global error handler (throw pattern) |
| `src/middleware/auth.js` | `requireLineUser` — injects `req.user` |
| `src/tests/medication_crud.test.js` | Reference test pattern to follow exactly |

---

## 3. Data Model Changes

### Current `SymptomLog` schema (line 204 of `schema.prisma`)

```prisma
model SymptomLog {
  id             String   @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  description    String
  severity       Int
  note           String?
  attachmentUrl  String?   // ← rename to photoUrl
  loggedAt       DateTime
  createdAt      DateTime @default(now())

  familyMember FamilyMember @relation(...)
}
```

### Required changes

1. **Rename** `attachmentUrl String?` → `photoUrl String?`
2. **Add** `voiceNoteUrl String?`

### Target schema

```prisma
model SymptomLog {
  id             String   @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  description    String
  severity       Int
  note           String?
  photoUrl       String?
  voiceNoteUrl   String?
  loggedAt       DateTime
  createdAt      DateTime @default(now())

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id], onDelete: Cascade)
}
```

### Migration command

```bash
cd famcare-backend
npx prisma migrate dev --name rename_attachmentUrl_add_voiceNoteUrl_symptom_log
```

> **Assumption:** No production data currently uses `attachmentUrl`. If it does, the migration SQL must include `ALTER TABLE "SymptomLog" RENAME COLUMN "attachmentUrl" TO "photoUrl"` rather than drop-and-recreate.

---

## 4. API Changes

### Existing endpoints (already working — no breaking changes needed after schema migration)

```
GET    /api/v1/symptom-logs           — list by familyMemberId
POST   /api/v1/symptom-logs           — create entry (JSON body)
GET    /api/v1/symptom-logs/:id       — get single entry
PATCH  /api/v1/symptom-logs/:id       — update entry
DELETE /api/v1/symptom-logs/:id       — delete entry
```

### Changes to existing endpoints

**`GET /api/v1/symptom-logs`** — add `from` and `to` query params:
```
?familyMemberId=<id>&from=2026-01-01&to=2026-04-30&limit=50&cursor=<cuid>
```
- `from`/`to` are ISO 8601 date strings; filter on `loggedAt` (inclusive range)
- Invalid ISO strings → 400 BAD_REQUEST

**`POST /api/v1/symptom-logs`** — body field rename:
```json
{
  "familyMemberId": "...",
  "description": "Grandma has a headache today",
  "severity": 6,
  "note": "optional free text",
  "photoUrl": "https://res.cloudinary.com/...",
  "voiceNoteUrl": "https://res.cloudinary.com/..."
}
```
(`attachmentUrl` is removed; clients must use `photoUrl` and/or `voiceNoteUrl`)

### New endpoints for file upload

```
POST   /api/v1/symptom-logs/:id/photo        — upload photo to Cloudinary, store photoUrl
POST   /api/v1/symptom-logs/:id/voice-note   — upload audio to Cloudinary, store voiceNoteUrl
```

Both endpoints:
- Accept `multipart/form-data` with field name `file`
- Authenticate via `requireLineUser` (OWNER or CAREGIVER)
- Return `200 { data: { id, photoUrl } }` or `{ id, voiceNoteUrl }`

### Cloudinary folder convention (matching existing pattern)

```
famcare/symptom-logs/{familyMemberId}/photos/
famcare/symptom-logs/{familyMemberId}/voice-notes/
```

---

## 5. Frontend Changes

**None.** This is a backend-only repo. The iOS app consumes the API — it is out of scope here.

---

## 6. Edge Cases

| Case | Handling |
|------|----------|
| `severity` = 0 or 11 | 400 BAD_REQUEST — `validateSeverity()` already enforces 1–10 |
| `severity` is float (e.g. 5.5) | 400 — must be integer; `Number.isInteger()` check |
| `from` after `to` in date range | 400 BAD_REQUEST — validate order |
| Invalid ISO string for `from`/`to` | 400 BAD_REQUEST — `isNaN(new Date(from))` check |
| Upload > 10 MB | 413 FILE_TOO_LARGE — existing Multer limit handles this |
| Unsupported audio MIME type | 415 UNSUPPORTED_MEDIA_TYPE — update fileFilter in upload.js |
| `:id` not found for photo/voice upload | 404 NOT_FOUND — fetch log first, throw if missing |
| VIEWER role tries to attach file | 403 FORBIDDEN — `assertCanWriteMember` rejects VIEWER |
| Cloudinary upload fails | Throw 500 — do NOT save URL if upload fails |
| `familyMemberId` missing on create | 400 BAD_REQUEST — existing validation |
| `description` missing on create | 400 BAD_REQUEST — existing validation |
| Empty `from` or `to` string | Treat as absent (no filter applied) |
| Voice note transcription | **Stretch goal — do not implement.** Log decision in DECISION_LOG: transcription is async/optional, deferred to a future sprint. |

---

## 7. Implementation Tasks

---

### Task 1 — Prisma Schema Migration

**Purpose:** Rename `attachmentUrl` → `photoUrl` and add `voiceNoteUrl` to `SymptomLog`.

**Files affected:**
- `famcare-backend/prisma/schema.prisma`

**Dependencies:** None — do this first.

**Acceptance criteria:**
- `SymptomLog` model has `photoUrl String?` and `voiceNoteUrl String?`; `attachmentUrl` is removed
- Migration file generated under `prisma/migrations/`
- `npx prisma generate` runs without error
- `npx prisma validate` passes

**Tests to add/run:** None for this task — schema only.

**Verification commands:**
```bash
cd famcare-backend
npx prisma validate
npx prisma migrate dev --name rename_attachmentUrl_add_voiceNoteUrl_symptom_log
npx prisma generate
```

**Constraints:**
- Do not add any new npm packages
- Follow existing schema style (no `@@map`, no extra indexes unless clearly needed)

**Risks:**
- If any existing DB data is in `attachmentUrl`, the default `migrate dev` will drop the column and lose data. The migration SQL may need a manual `RENAME COLUMN` step. Check for existing rows before running.

---

### Task 2 — Upload Middleware: Add Audio MIME Support

**Purpose:** Allow audio file uploads (voice notes) through the existing Multer middleware.

**Files affected:**
- `src/middleware/upload.js`

**Dependencies:** Task 1 (schema must be settled before deciding on resource types).

**Acceptance criteria:**
- `upload.js` exports both `uploadSingle` (images + PDF) and a new `uploadAudio` export (audio MIME types only), OR a single export that accepts an optional MIME type set
- Allowed audio MIME types: `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/aac`
- File size limit remains 10 MB for both
- Non-audio file submitted to audio endpoint → 415 UNSUPPORTED_MEDIA_TYPE
- Non-image file submitted to image endpoint → 415 (existing behavior unchanged)

**Tests to add/run:** Covered in Task 5 (upload route tests mock Multer behaviour).

**Verification commands:**
```bash
npm test -- --testPathPattern=symptom_and_note_log
```

**Constraints:**
- Do not change the existing `uploadSingle` export signature — other routes (documents) depend on it
- No new npm packages; Multer is already installed

**Risks:**
- iOS voice memos use `audio/x-m4a` — confirm whether this should be included. **Assumption:** treat `audio/x-m4a` the same as `audio/mp4`.

---

### Task 3 — Service Layer: date-range filtering + photoUrl/voiceNoteUrl fields

**Purpose:** Update `symptomLogService.js` to (a) accept `from`/`to` in `listSymptomLogs`, and (b) use `photoUrl`/`voiceNoteUrl` instead of `attachmentUrl` after schema migration.

**Files affected:**
- `src/services/symptomLogService.js`

**Dependencies:** Task 1 (schema change must be migrated before service can reference new columns).

**Acceptance criteria:**
- `listSymptomLogs(actorUserId, { familyMemberId, limit, cursor, from, to })`:
  - `from` and `to` filter on `loggedAt` (inclusive, UTC-aware — use `new Date(from)`)
  - Invalid ISO string → 400 BAD_REQUEST with code `BAD_REQUEST`
  - `from` after `to` → 400 BAD_REQUEST
  - Timeline order is `loggedAt: 'desc'` (newest first) — unchanged
- `createSymptomLog` uses `photoUrl` and `voiceNoteUrl` (no more `attachmentUrl`)
- `updateSymptomLog` accepts `photoUrl` and `voiceNoteUrl` patch fields
- `formatLog()` still calls `toBangkokISO()` on `loggedAt` and `createdAt`
- All existing tests still pass after rename

**Tests to add/run:** See Task 5.

**Verification commands:**
```bash
npm test
```

**Constraints:**
- Do not change the function signatures for `getSymptomLog`, `deleteSymptomLog` — they are already correct
- Keep `notifyOwnerIfCaregiver` fire-and-forget pattern (`.catch()`)
- No new npm dependencies

**Risks:**
- `new Date(from)` on a bare date string like `"2026-01-01"` is interpreted as UTC midnight — this is correct for a "start of day" filter. Document this behavior.

---

### Task 4 — Upload Routes: photo and voice note attachment endpoints

**Purpose:** Add `POST /api/v1/symptom-logs/:id/photo` and `POST /api/v1/symptom-logs/:id/voice-note` routes that upload files to Cloudinary and persist the URL on the log.

**Files affected:**
- `src/routes/symptomLogs.js`
- `src/services/symptomLogService.js` (add two new service functions)
- `src/services/cloudinaryService.js` (read only — reuse `uploadBuffer`)

**Dependencies:** Tasks 1, 2, 3.

**Acceptance criteria:**
- `POST /api/v1/symptom-logs/:id/photo`:
  - Accepts `multipart/form-data`, field `file`, image MIME types
  - Fetches the log by `:id`, asserts `assertCanWriteMember`
  - Uploads to Cloudinary folder `famcare/symptom-logs/{familyMemberId}/photos/`
  - Updates `prisma.symptomLog.update` with `photoUrl: upload.secure_url`
  - Returns `200 { data: { id, photoUrl } }`
- `POST /api/v1/symptom-logs/:id/voice-note`:
  - Accepts `multipart/form-data`, field `file`, audio MIME types
  - Uploads to `famcare/symptom-logs/{familyMemberId}/voice-notes/` with `resourceType: 'raw'`
  - Updates `voiceNoteUrl`
  - Returns `200 { data: { id, voiceNoteUrl } }`
- Missing log → 404
- VIEWER role → 403
- Cloudinary error → 500 (do not save partial URL)
- Routes placed BEFORE `/:id` routes in `symptomLogs.js` to avoid param collision

**New service functions:**
```js
export async function attachPhotoToSymptomLog(actorUserId, logId, file)
export async function attachVoiceNoteToSymptomLog(actorUserId, logId, file)
```

**Tests to add/run:** See Task 5.

**Verification commands:**
```bash
npm test -- --testPathPattern=symptom_and_note_log
```

**Constraints:**
- Reuse `uploadBuffer` from `cloudinaryService.js` — do not duplicate upload logic
- Use `resourceType: 'raw'` for audio (same as PDFs in document service)
- Follow thin-route pattern: all logic in service, route only calls service and returns

**Risks:**
- Route ordering matters: `/:id/photo` must be registered before `/:id` in Express or Express will try to treat `photo` as an ID parameter. Verify by reading `symptomLogs.js` route order.

---

### Task 5 — Test Suite: `src/tests/symptom_and_note_log.test.js`

**Purpose:** Write comprehensive supertest + Jest tests for the entire symptom log feature. This is the deliverable the executing agent must run with `npm test` until all tests pass.

**Files affected:**
- `src/tests/symptom_and_note_log.test.js` ← create new

**Dependencies:** Tasks 1–4 (all implementation must be complete before tests can be verified end-to-end).

**Acceptance criteria — tests must cover:**

| Test Case | Expected |
|-----------|----------|
| `POST /api/v1/symptom-logs` with text + severity → stored | 201, `data.id` present, `data.severity === 6` |
| `POST` with `photoUrl` string → stored in `data.photoUrl` | 201, correct URL returned |
| `POST` with missing `description` → | 400, `code: 'BAD_REQUEST'` |
| `POST` with `severity: 0` → | 400, `code: 'BAD_REQUEST'` |
| `POST` with `severity: 11` → | 400, `code: 'BAD_REQUEST'` |
| `POST` with `severity: 5.5` (float) → | 400, `code: 'BAD_REQUEST'` |
| `POST` with VIEWER role → | 403, `code: 'FORBIDDEN'` |
| `GET /api/v1/symptom-logs?familyMemberId=X` → chronological timeline | 200, array ordered newest-first |
| `GET` without `familyMemberId` → | 400, `code: 'BAD_REQUEST'` |
| `GET` with `from`/`to` → filtered results | 200, Prisma called with correct date bounds |
| `GET` with `from` after `to` → | 400, `code: 'BAD_REQUEST'` |
| `GET` with invalid `from` ISO string → | 400 |
| `GET /api/v1/symptom-logs/:id` → single log | 200, correct shape |
| `GET /:id` not found → | 404, `code: 'NOT_FOUND'` |
| `PATCH /:id` with new severity → updated | 200, updated severity |
| `DELETE /:id` → | 204 |
| `POST /:id/photo` (mock upload) → `photoUrl` stored | 200, `data.photoUrl` present |
| `POST /:id/voice-note` (mock upload) → `voiceNoteUrl` stored | 200, `data.voiceNoteUrl` present |
| `POST /:id/photo` on missing log → | 404 |
| Missing `x-line-userid` header → | 401 |

**Test file structure (follow `medication_crud.test.js` exactly):**

```js
import { jest } from '@jest/globals'

// 1. Declare mock functions at top level
const mockSymptomLogCreate = jest.fn()
const mockSymptomLogFindUnique = jest.fn()
const mockSymptomLogFindMany = jest.fn()
const mockSymptomLogUpdate = jest.fn()
const mockSymptomLogDelete = jest.fn()
const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockFindOrCreate = jest.fn()
const mockUploadBuffer = jest.fn()

// 2. jest.unstable_mockModule() for all ESM dependencies
jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    symptomLog: {
      create: mockSymptomLogCreate,
      findUnique: mockSymptomLogFindUnique,
      findMany: mockSymptomLogFindMany,
      update: mockSymptomLogUpdate,
      delete: mockSymptomLogDelete,
    },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
  assertCanWriteMember: mockAssertCanWriteMember,
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: mockUploadBuffer,
}))

// 3. Dynamic imports AFTER mocks
const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: symptomLogsRouter } = await import('../routes/symptomLogs.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/symptom-logs', symptomLogsRouter)
app.use(errorHandler)

const request = supertest(app)

// 4. Constants
const LINE_ID = 'U_test_symptom_123'
const USER_ID = 'usr_symptom_abc'
const MEMBER_ID = 'mem_xyz'
const LOG_ID = 'clog_abc12345678901234567'
const AUTH = { 'x-line-userid': LINE_ID }

// 5. Fixture factory
function fakeLog(overrides = {}) {
  return {
    id: LOG_ID,
    familyMemberId: MEMBER_ID,
    addedByUserId: USER_ID,
    description: 'Headache',
    severity: 6,
    note: null,
    photoUrl: null,
    voiceNoteUrl: null,
    loggedAt: new Date('2026-04-14T10:00:00Z'),
    createdAt: new Date('2026-04-14T10:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID })
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
})
```

**Verification commands:**
```bash
cd famcare-backend
npm test -- --testPathPattern=symptom_and_note_log
# Must show: Tests: N passed, 0 failed
# Final check — run full suite to confirm no regressions:
npm test
```

**Constraints:**
- Do not modify any existing test files
- Use `jest.unstable_mockModule` (ESM) — NOT `jest.mock`
- Do not write real Cloudinary or DB calls in tests
- Mock `upload.js` or use supertest `.attach()` with a fake buffer — verify approach against `document_upload.test.js`
- Test file must live in `src/tests/symptom_and_note_log.test.js` (exact path)

**Risks:**
- Multer multipart parsing in tests requires `.attach('file', buffer, { filename, contentType })` via supertest. Check `document_upload.test.js` for exact mock pattern used.
- `jest.unstable_mockModule` for `upload.js` (which exports Multer middleware) may need the middleware to be stubbed to call `next()` directly and inject `req.file`. Follow the document upload test for precedent.

---

## 8. Safest Implementation Order

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```

**Rationale:**
- Schema must be migrated first (Tasks 3–4 reference new columns)
- Middleware update is independent but needed before routes work
- Service update depends on schema (Task 3 after Task 1)
- Routes depend on both service and middleware (Task 4 after Tasks 2–3)
- Tests validate the full stack (Task 5 last, run `npm test` until green)

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|------------|
| **`attachmentUrl` data in prod DB** | Check for non-null rows before migration. If found, write migration SQL with `RENAME COLUMN` instead of drop. |
| **Prisma migration on `attachmentUrl` rename** | Prisma may generate `DROP COLUMN attachmentUrl` + `ADD COLUMN photoUrl` (loses data). Add custom SQL in migration file if needed. |
| **Audio MIME types on iOS** | iOS voice memos export as `audio/x-m4a`. Assume same as `audio/mp4`. Confirm with iOS team if needed. |
| **Voice note transcription (stretch goal)** | Out of scope for this plan. Add a note to `DECISION_LOG.md` that transcription is deferred — implement as an async background step in a future sprint using an OCR-style pattern. |
| **Route path `/symptoms` vs `/symptom-logs`** | Spec uses `/api/v1/symptoms` but codebase uses `/symptom-logs`. **Use `/symptom-logs`** — consistent with existing router registration. iOS app must use this path. |
| **Query param `memberId` vs `familyMemberId`** | Spec uses `memberId` but codebase uses `familyMemberId` everywhere. **Use `familyMemberId`**. |
| **Severity as string vs number in JSON** | JSON body may send `"6"` as a string. `validateSeverity` uses `Number(severity)` so this is handled, but tests should cover both string and number input. |
| **Cloudinary CLOUDINARY_URL env var in CI** | Tests mock `cloudinaryService.js` so no real credentials needed. Confirm that `cloudinaryService.js` mock completely prevents the real client from initializing. |
| **No Railway backup plan available** | Before deploy, run a manual `SymptomLog` data export (CSV/JSON/SQL) and verify `photoUrl` distribution so there is at least one recovery artifact if historical attachment data is later found missing. |

---

## 10. Pre-Deploy Reminder (read before shipping)

- Railway backup snapshots are unavailable on current plan.
- Compensating control: take a manual export of `SymptomLog` before deployment.
- Confirm migration state is up to date (`npx prisma migrate status`) and schema is valid (`npx prisma validate`).
- Proceed only after accepting the residual risk: if hidden historical `attachmentUrl` data was lost previously, recovery without backup is limited.

---

## 11. DECISION_LOG Entry (to be added)

```markdown
## Voice Note Transcription — Deferred

**Date:** 2026-04-14
**Feature:** Symptom & Notes Log
**Decision:** Speech-to-text transcription of voice notes is NOT implemented in this sprint.
**Reason:** Transcription requires an external AI provider call, async job infrastructure, and cost
management that are out of scope. The voice note URL is stored; transcription can be added as an
async background step (similar to OCR on documents) in a future sprint.
**Follow-up:** Implement using the `ocrService.js` provider-pluggable pattern — add a
`transcribeAudio(url)` function with provider support for OpenAI Whisper or Google Speech-to-Text.
```

---

*Save this file as `docs/execution/features/symptom-and-note-log-plan.md`*
