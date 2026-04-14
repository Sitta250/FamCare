# Health Documentation Feature — Implementation Plan

> **Saved at:** `docs/execution/features/health-documentation-plan.md`
> **For:** Agent execution. Read CLAUDE.md first before touching any file.

---

## Pre-Read Required

Before starting any task, read:
- `famcare-backend/CLAUDE.md` — full project conventions
- `famcare-backend/prisma/schema.prisma` — current `Document` model
- `famcare-backend/src/services/documentService.js` — existing logic to preserve
- `famcare-backend/src/services/ocrService.js` — existing OCR adapter to extend

---

## 1. Goal Summary

Upgrade the existing (partial) Health Documentation feature into a complete, production-ready system:

| Capability | Current State | Target State |
|------------|--------------|--------------|
| File upload | Client uploads to Cloudinary, passes URL | Server accepts `multipart/form-data`, uploads to Cloudinary itself |
| File size limit | None | Reject >10 MB with `413` |
| OCR | OpenAI Vision only (`gpt-4o-mini`) | Add Google Vision API option; add `tesseract.js` local option |
| Thai text OCR | Untested | Verified via Google Vision (handles Thai natively) |
| Search | `?q=` searches `ocrText` only | `?keyword=` searches `ocrText` + `tags`; `?date=` for exact-day filter |
| Tags | Not in schema | Add `tags String?` field; populate from OCR or client |
| Cloudinary cleanup | Orphaned files on delete | Delete from Cloudinary when document record is deleted |
| Tests | None | Full Jest suite for upload, search, OCR, validation |

**No frontend work.** This is backend-only.

---

## 2. Existing Files / Modules Involved

| File | Current Role | Changes Needed |
|------|-------------|----------------|
| `famcare-backend/prisma/schema.prisma` | `Document` model | Add `tags`, `cloudinaryPublicId` fields |
| `famcare-backend/src/routes/documents.js` | REST handlers | Add multer middleware to POST; update query params |
| `famcare-backend/src/services/documentService.js` | CRUD + async OCR | Accept buffer instead of URL; add Cloudinary upload call; extend search |
| `famcare-backend/src/services/ocrService.js` | OpenAI Vision stub | Add Google Vision + tesseract.js providers |
| `famcare-backend/src/services/accessService.js` | Permission checks | No changes |
| `famcare-backend/src/services/caregiverNotifyService.js` | Owner notifications | No changes |
| `famcare-backend/src/utils/datetime.js` | Date formatting | No changes — reuse `toBangkokISO`, `bangkokCalendarDate` |
| `famcare-backend/src/middleware/auth.js` | LINE auth | No changes |
| `famcare-backend/src/jobs/cron.js` | Cron scheduler | No changes |
| `famcare-backend/package.json` | Dependencies | Add `multer`, `cloudinary`, optionally `tesseract.js` |

**New files to create:**
- `famcare-backend/src/middleware/upload.js` — multer config (memory storage, 10 MB limit, image/PDF MIME check)
- `famcare-backend/src/services/cloudinaryService.js` — `uploadBuffer()` and `deleteByPublicId()` wrappers

---

## 3. Data Model Changes

### `famcare-backend/prisma/schema.prisma`

Modify the `Document` model — add two fields:

```prisma
model Document {
  id                 String       @id @default(cuid())
  familyMemberId     String
  addedByUserId      String
  type               DocumentType
  cloudinaryUrl      String
  cloudinaryPublicId String?      // ← NEW: Cloudinary public_id for deletion
  ocrText            String?
  tags               String?      // ← NEW: comma-separated or JSON tags for search
  createdAt          DateTime     @default(now())

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id], onDelete: Cascade)
}
```

**Migration command:**
```bash
cd famcare-backend
npx prisma migrate dev --name add_document_cloudinary_public_id_and_tags
```

**No other model changes required.**

---

## 4. API Changes

### Modified: `POST /api/v1/documents`

**Before (current):** JSON body with pre-uploaded `cloudinaryUrl`
**After:** `multipart/form-data` with actual file

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | binary | Yes | Image or PDF; max 10 MB |
| `familyMemberId` | string | Yes | Form field |
| `type` | string | Yes | One of `PRESCRIPTION\|LAB_RESULT\|DOCTOR_NOTE\|BILL\|XRAY\|OTHER` |
| `tags` | string | No | Optional comma-separated tags |

**Success response (201):**
```json
{
  "data": {
    "id": "...",
    "familyMemberId": "...",
    "type": "PRESCRIPTION",
    "cloudinaryUrl": "https://res.cloudinary.com/...",
    "ocrText": null,
    "tags": "ใบสั่งยา,paracetamol",
    "createdAt": "2026-04-14T10:00:00+07:00"
  }
}
```

**Error responses:**
- `400 BAD_REQUEST` — missing required fields or invalid `type` enum
- `413 FILE_TOO_LARGE` — file exceeds 10 MB (thrown by multer, caught by error handler)
- `415 UNSUPPORTED_MEDIA_TYPE` — non-image / non-PDF MIME type

### Modified: `GET /api/v1/documents`

Support **both old and new** query param names for backwards compatibility:

| Param | Alias | Notes |
|-------|-------|-------|
| `familyMemberId` | `memberId` | Either accepted; `familyMemberId` takes priority |
| `q` | `keyword` | Full-text search across `ocrText` + `tags` (OR match) |
| `from` | — | Start of date range (existing) |
| `to` | — | End of date range (existing) |
| `date` | — | NEW: exact calendar date filter (`YYYY-MM-DD` Bangkok) |

### Unchanged: `GET /api/v1/documents/:id`, `DELETE /api/v1/documents/:id`

`DELETE` gains a **side effect**: call Cloudinary `destroy(cloudinaryPublicId)` after DB delete (fire-and-forget, do not block response).

---

## 5. Frontend Changes

**None.** This is a backend-only service. iOS app and web dashboard are separate repos.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| File > 10 MB | Multer `limits.fileSize` throws; `errorHandler.js` maps multer's `LIMIT_FILE_SIZE` code to `413` |
| Non-image MIME type (e.g., `.exe`) | Multer `fileFilter` rejects; return `415 UNSUPPORTED_MEDIA_TYPE` |
| PDF files | Allowed — OCR adapters handle or skip gracefully; Cloudinary accepts PDFs |
| Cloudinary upload fails | Throw `500 UPLOAD_FAILED`; do not create DB record |
| OCR fails / times out | Log error, keep `ocrText: null` — document is already saved, OCR is async best-effort |
| `cloudinaryPublicId` is null on old records | `deleteDocument` skips Cloudinary call if `cloudinaryPublicId` is null (backwards compat) |
| Keyword search with no `ocrText` (OCR pending) | Returns document; `ocrText: null` simply won't match — expected behaviour |
| `date` param timezone | Must use `utcInstantFromBangkokYmdHm` to get UTC range for the Bangkok calendar day |
| `keyword` searches `tags` before OCR completes | Tags are stored synchronously at upload time; keyword match on tags works immediately |
| Duplicate upload (same file, same member) | No dedup logic — allowed; each upload creates a new record |
| `type` enum validation | Must be one of `PRESCRIPTION\|LAB_RESULT\|DOCTOR_NOTE\|BILL\|XRAY\|OTHER` — throw `400` otherwise |
| Soft-deleted `FamilyMember` | `assertCanWriteMember` blocks write; existing gap documented in CLAUDE.md |
| Thai OCR with `tesseract.js` | Requires `tha` language data downloaded at install time; heavy dependency (~60 MB) |

---

## 7. Implementation Tasks

---

### Task 1 — Multipart Upload Middleware + Cloudinary Server Upload

**Purpose:** Accept real files from clients (not pre-uploaded URLs), validate size/MIME, upload to Cloudinary, and store the public URL and public_id.

**This is the most impactful change — all other tasks depend on having a real upload flow.**

#### New file: `famcare-backend/src/middleware/upload.js`

```
- Use multer with memory storage (no disk writes)
- limits.fileSize = 10 * 1024 * 1024 (10 MB)
- fileFilter: allow image/jpeg, image/png, image/webp, image/heic, application/pdf only
- Export: uploadSingle = multer(...).single('file')
```

#### New file: `famcare-backend/src/services/cloudinaryService.js`

```
- uploadBuffer(buffer, { folder, resourceType, originalname }) → { secure_url, public_id }
- deleteByPublicId(publicId) → void (fire-and-forget safe)
- Uses CLOUDINARY_URL env var (already in .env.example per CLAUDE.md)
- Dynamic import of 'cloudinary' package to avoid hard dep at boot
```

#### Modified: `famcare-backend/src/routes/documents.js`

```
- Import uploadSingle from upload.js
- Apply as: router.post('/', uploadSingle, async (req, res, next) => {...})
- Pass req.file.buffer + req.body to createDocument
```

#### Modified: `famcare-backend/src/services/documentService.js` — `createDocument`

```
- Accept { familyMemberId, type, tags, file: { buffer, mimetype, originalname } }
- Validate required fields (familyMemberId, type, file)
- Validate type is valid DocumentType enum value
- Call cloudinaryService.uploadBuffer(buffer, { folder: 'famcare/documents/...' })
- Store { cloudinaryUrl: secure_url, cloudinaryPublicId: public_id }
- Trigger async OCR as before
```

**New dependencies to install:**
```bash
npm install multer cloudinary
```

**Files affected:**
- `famcare-backend/package.json`
- `famcare-backend/src/middleware/upload.js` ← NEW
- `famcare-backend/src/services/cloudinaryService.js` ← NEW
- `famcare-backend/src/routes/documents.js`
- `famcare-backend/src/services/documentService.js`

**Dependencies on previous tasks:** None — implement first.

**Acceptance criteria:**
- `POST /documents` with a valid JPEG + form fields → `201` with `cloudinaryUrl` starting with `https://res.cloudinary.com/`
- `POST /documents` with a 15 MB file → `413` response
- `POST /documents` with a `.exe` file → `415` response
- `POST /documents` with missing `familyMemberId` → `400 BAD_REQUEST`
- `POST /documents` with invalid `type` → `400 BAD_REQUEST`
- `cloudinaryPublicId` is stored in DB (verify via Prisma Studio or test)
- Old `GET /documents/:id`, `GET /documents`, `DELETE /documents/:id` still work (no regression)

**Tests to add:** `famcare-backend/src/tests/document_upload.test.js`
- Mock `cloudinaryService.uploadBuffer` to return fake `{ secure_url, public_id }`
- Mock `prisma.document.create`
- Test: valid upload → 201 + expected shape
- Test: missing `familyMemberId` → 400
- Test: invalid `type` → 400
- Test: multer file size exceeded → 413
- Test: unsupported MIME → 415

**Verification:** `npm test -- --testPathPattern=document_upload`

**Constraints:**
- Use `multer` memory storage only — no disk writes
- `cloudinary` package must be dynamically imported or initialized lazily (check `CLOUDINARY_URL` is set)
- Follow existing error pattern: `Object.assign(new Error(...), { status, code })`
- `uploadBuffer` must not throw if `CLOUDINARY_URL` is missing — throw `500 UPLOAD_UNAVAILABLE` with a clear message

**Risks:**
- `multer` error codes differ from Express errors — `errorHandler.js` must be updated to map `LIMIT_FILE_SIZE` → `413` and unknown multer errors → `400`
- Cloudinary folder structure: use `famcare/documents/{familyMemberId}` to keep files organized per member
- `multipart/form-data` means `req.body` won't be populated until after multer runs — order matters in middleware chain

---

### Task 2 — Schema Migration: `tags` + `cloudinaryPublicId`

**Purpose:** Add the two new fields to the `Document` model so Tasks 1 and 4 have a place to write their data.

**Do this task before or in parallel with Task 1, as Task 1 writes `cloudinaryPublicId`.**

**Files affected:**
- `famcare-backend/prisma/schema.prisma`
- New migration file (auto-generated)

**Steps:**
1. Add `cloudinaryPublicId String?` to `Document` model
2. Add `tags String?` to `Document` model
3. Run migration:
   ```bash
   cd famcare-backend
   npx prisma migrate dev --name add_document_cloudinary_public_id_and_tags
   npx prisma generate
   ```

**Dependencies on previous tasks:** None — safe to do first.

**Acceptance criteria:**
- `npx prisma validate` passes with no errors
- `npx prisma migrate dev` applies cleanly with no destructive operations
- `npx prisma generate` regenerates client with new fields
- Existing documents (if any) have `cloudinaryPublicId: null` and `tags: null` — no data loss
- `prisma.document.create({ data: { ..., cloudinaryPublicId: '...', tags: '...' } })` compiles without TypeScript errors

**Tests to add:** None — schema change only. Validate via `npm run check` (`prisma validate`).

**Verification:**
```bash
cd famcare-backend
npm run check          # prisma validate
npx prisma migrate dev --name add_document_cloudinary_public_id_and_tags
```

**Constraints:** No application code changes in this task. Schema only.

**Risks:**
- If the database already has document rows in production, the migration is safe (both fields are nullable)
- Remember to run `npx prisma generate` after migration or the Prisma client won't know about the new fields

---

### Task 3 — OCR Enhancement: Google Vision + tesseract.js Providers

**Purpose:** Make OCR robust for Thai medical documents. OpenAI Vision works but is expensive and untested for Thai. Google Vision handles Thai natively. `tesseract.js` works offline but is heavier.

**Files affected:**
- `famcare-backend/src/services/ocrService.js` — add two new provider branches
- `famcare-backend/package.json` — add `@google-cloud/vision` and optionally `tesseract.js`
- `famcare-backend/.env.example` — document new env vars

**Current provider switching logic (preserve):**
```js
const provider = process.env.OCR_PROVIDER ?? 'none'
// 'openai' → extractWithOpenAI
```

**Add:**
```js
// 'google'    → extractWithGoogleVision
// 'tesseract' → extractWithTesseract
```

#### Google Vision (`extractWithGoogleVision`)

```
- Dynamic import: await import('@google-cloud/vision')
- Auth via GOOGLE_APPLICATION_CREDENTIALS env var (JSON key file path) OR GOOGLE_VISION_API_KEY
- client.textDetection(imageUrl) → response[0].textAnnotations[0].description
- Handles Thai, English, numbers automatically
- Return extracted text string
```

#### tesseract.js (`extractWithTesseract`)

```
- Dynamic import: await import('tesseract.js')
- Languages: ['tha', 'eng'] (Thai + English combined)
- Input: imageUrl (fetch buffer first, then pass to Tesseract)
- Note: First run downloads language data (~60 MB) — document this clearly
- Suitable for offline/self-hosted environments
```

**New env vars to document in `.env.example`:**
```
OCR_PROVIDER=openai            # openai | google | tesseract | none
OPENAI_API_KEY=                # required if OCR_PROVIDER=openai
GOOGLE_APPLICATION_CREDENTIALS=./path/to/key.json  # required if OCR_PROVIDER=google
```

**Recommended default for this project:** `OCR_PROVIDER=google` — best Thai support, no large local download.

**Dependencies on previous tasks:** None (OCR is independent). Can be done in parallel with Task 1.

**Acceptance criteria:**
- `OCR_PROVIDER=google` + valid `GOOGLE_APPLICATION_CREDENTIALS` → Thai text extracted correctly from test image
- `OCR_PROVIDER=tesseract` → text extracted locally without network call
- `OCR_PROVIDER=openai` (existing) → still works unchanged
- `OCR_PROVIDER=none` or unset → returns `''`, logs warning (existing behaviour preserved)
- Missing provider package (e.g., `@google-cloud/vision` not installed) → throws `500 OCR_UNAVAILABLE` with install hint

**Tests to add:** `famcare-backend/src/tests/ocr_service.test.js`
- Mock `@google-cloud/vision` → returns known text → `extractText` returns that text when `OCR_PROVIDER=google`
- `OCR_DISABLED=true` → returns `''` regardless of provider
- `OCR_PROVIDER=none` → returns `''`
- Missing package → throws `OCR_UNAVAILABLE`

**Verification:** `npm test -- --testPathPattern=ocr_service`

**Constraints:**
- All new providers must be **dynamically imported** (same pattern as existing `openai` dynamic import)
- Do not add `@google-cloud/vision` or `tesseract.js` to `dependencies` without confirming with user — they are large packages. Add to `optionalDependencies` or document as manual install steps.
- Do not break the existing OpenAI provider path

**Risks:**
- `tesseract.js` v5 has a different API from v4 — verify the API before writing
- Thai language data for `tesseract.js` requires download at runtime (~30 MB); CI/CD may time out
- Google Vision requires service account JSON; this must never be committed to git — validate `.gitignore` covers it

---

### Task 4 — Search Enhancements: `keyword`, `date`, `tags`, `memberId` Alias

**Purpose:** Align the list endpoint's query params with the spec (`keyword`, `memberId`, `date`) while keeping backwards compat with existing params (`q`, `familyMemberId`, `from`/`to`).

**Files affected:**
- `famcare-backend/src/routes/documents.js` — parse and pass new params
- `famcare-backend/src/services/documentService.js` — `listDocuments` logic

**Query param resolution rules (implement in this order):**

```
familyMemberId = req.query.familyMemberId ?? req.query.memberId
keyword        = req.query.keyword ?? req.query.q
date           = req.query.date   (new — exact Bangkok calendar day)
from           = req.query.from   (existing)
to             = req.query.to     (existing)
```

**Keyword search — extend to cover `tags` as well:**

Current (search `ocrText` only):
```js
where.ocrText = { contains: keyword, mode: 'insensitive' }
```

New (search `ocrText` OR `tags`):
```js
where.OR = [
  { ocrText: { contains: keyword, mode: 'insensitive' } },
  { tags:    { contains: keyword, mode: 'insensitive' } },
]
```

**Date filter (`date` param — exact Bangkok day):**

```
'date' param is a Bangkok YYYY-MM-DD string.
Convert to UTC range: [00:00:00+07:00, 23:59:59+07:00]
Use utcInstantFromBangkokYmdHm from utils/datetime.js:
  from = utcInstantFromBangkokYmdHm(date, '00:00')
  to   = utcInstantFromBangkokYmdHm(date, '23:59')
Merge with existing from/to if both provided (date takes priority).
```

**`tags` on create:**

- `documentService.createDocument` already accepts the form body; add `tags` to the `prisma.document.create` data object (after Task 2 migration).

**Files affected:**
- `famcare-backend/src/routes/documents.js`
- `famcare-backend/src/services/documentService.js`

**Dependencies:** Task 2 (schema migration for `tags` field must be applied first).

**Acceptance criteria:**
- `GET /documents?memberId=X` → same result as `GET /documents?familyMemberId=X`
- `GET /documents?keyword=paracetamol` → matches documents where `ocrText` OR `tags` contains "paracetamol" (case-insensitive)
- `GET /documents?date=2026-04-14` → returns only documents created on April 14 Bangkok time
- `GET /documents?q=old_param` → still works (backwards compat)
- `GET /documents?familyMemberId=X&from=2026-01-01&to=2026-03-31` → still works (no regression)
- `POST /documents` with `tags=ใบสั่งยา,paracetamol` → tags stored; searchable immediately

**Tests to add:** `famcare-backend/src/tests/document_search.test.js`
- `keyword` finds in `ocrText`
- `keyword` finds in `tags`
- `keyword` returns empty array when no match
- `memberId` alias resolves correctly
- `date` filter returns only same-day Bangkok docs
- `date` and `from`/`to` together → `date` takes priority
- No params → returns all docs for member (existing behaviour)

**Verification:** `npm test -- --testPathPattern=document_search`

**Constraints:**
- Date boundary conversion MUST use `utcInstantFromBangkokYmdHm` — never `new Date(date)` for Bangkok date strings
- Both old and new param names must continue to work
- `date` and `from`/`to` should not silently conflict — document the priority rule in a code comment

**Risks:**
- Prisma `OR` with two `contains` checks may be slow on large tables without a full-text index. Acceptable for MVP; note as a future optimisation.
- If `date` and `from`/`to` are both provided simultaneously, define which wins (recommend: `date` overrides `from`/`to`, document this).

---

### Task 5 — Cloudinary Cleanup on Document Delete

**Purpose:** When a document is deleted from the DB, also delete the file from Cloudinary storage. Currently, deleted documents leave orphaned files.

**Files affected:**
- `famcare-backend/src/services/documentService.js` — `deleteDocument`
- `famcare-backend/src/services/cloudinaryService.js` — `deleteByPublicId` (created in Task 1)

**Logic change in `deleteDocument`:**

```js
export async function deleteDocument(actorUserId, documentId) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) throw { status: 404, code: 'NOT_FOUND' }
  await assertCanWriteMember(actorUserId, doc.familyMemberId)
  await prisma.document.delete({ where: { id: documentId } })

  // NEW: Fire-and-forget Cloudinary cleanup
  if (doc.cloudinaryPublicId) {
    deleteByPublicId(doc.cloudinaryPublicId)
      .catch(err => console.error('[cloudinary] delete failed:', err.message))
  }
  // If cloudinaryPublicId is null (legacy records), skip silently
}
```

**Dependencies:** Task 1 (cloudinaryService.js must exist) + Task 2 (cloudinaryPublicId field in schema).

**Acceptance criteria:**
- `DELETE /documents/:id` on a document with `cloudinaryPublicId` → DB record deleted AND `cloudinaryService.deleteByPublicId` called with correct ID
- `DELETE /documents/:id` on a legacy document with `cloudinaryPublicId: null` → DB record deleted, no Cloudinary call, no error
- Cloudinary deletion failure → does NOT block the `204` response (fire-and-forget)
- `DELETE /documents/:id` on non-existent ID → `404` (existing behaviour unchanged)

**Tests to add:** Add to `famcare-backend/src/tests/document_upload.test.js` or create `document_delete.test.js`
- Delete with `cloudinaryPublicId` present → `deleteByPublicId` spy called once with correct id
- Delete with `cloudinaryPublicId: null` → `deleteByPublicId` spy never called
- Cloudinary delete throws → response is still `204` (fire-and-forget verified)

**Verification:** `npm test -- --testPathPattern=document`

**Constraints:** Cloudinary delete must be fire-and-forget. Do not `await` it in the request path.

**Risks:** Minimal. Backwards compatible with legacy records that have no `cloudinaryPublicId`.

---

### Task 6 — Full Document Test Suite

**Purpose:** Consolidate and complete Jest test coverage for all document operations, following existing test patterns.

**Test files (some created in Tasks 1–5):**

| File | Covers |
|------|--------|
| `src/tests/document_upload.test.js` | Multipart POST, Cloudinary mock, 413, 415, 400 |
| `src/tests/document_search.test.js` | Keyword, date, memberId, tags search |
| `src/tests/document_delete.test.js` | DELETE + Cloudinary cleanup |
| `src/tests/ocr_service.test.js` | OCR provider switching, disabled flag, error handling |
| `src/tests/document_crud.test.js` | `getDocument`, `listDocuments` baseline, access control |

**Mock targets:**
```js
jest.mock('../services/cloudinaryService.js')   // uploadBuffer, deleteByPublicId
jest.mock('../services/ocrService.js')           // extractText
jest.mock('../lib/prisma.js')                    // prisma.document.*
jest.mock('../services/linePushService.js')      // sendLinePushToUser
```

**Pattern to follow:** `famcare-backend/src/tests/appointment_management.test.js`
- Mock at module level
- `jest.clearAllMocks()` in `beforeEach`
- Use `supertest` for HTTP-level paths
- Note: ESM mocks use `jest.unstable_mockModule` pattern if needed

**Coverage targets:**
- `createDocument` — valid upload, missing field, invalid type, Cloudinary fail, OCR async
- `listDocuments` — no filters, keyword, date, memberId alias, access denied
- `getDocument` — found, not found, access denied
- `deleteDocument` — success + Cloudinary cleanup, missing publicId, access denied
- `extractText` — all providers, disabled flag, missing package

**Verification:** `npm test`

**Constraints:** No new test-only dependencies beyond Jest + supertest (already installed).

**Risks:**
- Multer middleware is harder to test via supertest — use `supertest`'s `.attach()` method for multipart requests
- ESM dynamic imports in `ocrService.js` and `cloudinaryService.js` require `jest.unstable_mockModule` in the test file

---

## 8. Safest Implementation Order

```
Task 2 (Schema Migration)        ← no code deps; do first or in parallel
    │
    ├──→ Task 1 (Multipart Upload + Cloudinary)   ← core change; blocks Tasks 4, 5
    │         │
    │         ├──→ Task 4 (Search Enhancements)   ← needs tags field (Task 2) + upload flow
    │         │
    │         └──→ Task 5 (Cloudinary Delete)     ← needs cloudinaryService (Task 1) + publicId (Task 2)
    │
Task 3 (OCR Enhancement)         ← fully independent; run in parallel with Task 1
    │
    └──→ Task 6 (Full Test Suite) ← after all above
```

**Recommended sequence:** 2 → 1 → 3 → 4 → 5 → 6

Tasks 1 and 3 can be worked in parallel by two agents/developers.

---

## 9. New Environment Variables

Add these to `famcare-backend/.env.example`:

```dotenv
# Cloudinary (required for document upload)
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name

# OCR Configuration
OCR_PROVIDER=google         # openai | google | tesseract | none
OCR_DISABLED=false          # set true to skip OCR entirely

# Required if OCR_PROVIDER=openai
OPENAI_API_KEY=

# Required if OCR_PROVIDER=google
GOOGLE_APPLICATION_CREDENTIALS=./path/to/service-account-key.json
```

---

## 10. Global Risks & Ambiguities

| Risk | Detail | Mitigation |
|------|--------|-----------|
| **`multer` error shape** | Multer throws `MulterError` objects with `.code` (e.g., `LIMIT_FILE_SIZE`), not the custom `{ status, code }` pattern. The global `errorHandler.js` won't recognise these. | Update `errorHandler.js` to check `err instanceof MulterError` and map codes → HTTP status. |
| **Cloudinary URL not set** | If `CLOUDINARY_URL` is missing, `cloudinaryService.uploadBuffer` throws at runtime. | Check env at startup in `index.js` and warn loudly; or throw `500 UPLOAD_UNAVAILABLE` lazily. |
| **Bangkok date for `date` param** | `new Date('2026-04-14')` interprets as UTC midnight (Apr 13 17:00 Bangkok). | Always use `utcInstantFromBangkokYmdHm` from `utils/datetime.js`. |
| **OCR package size** | `tesseract.js` + Thai language data is ~100 MB; `@google-cloud/vision` is ~15 MB. Both are optional. | Mark as `optionalDependencies`; document manual install. Default to `OCR_PROVIDER=google`. |
| **Backwards compatibility** | Existing clients may already pass `cloudinaryUrl` as JSON (old flow). After Task 1, `POST /documents` requires multipart. | If old clients must continue working, keep a JSON fallback path or version the endpoint. Clarify with product team before Task 1. |
| **`tesseract.js` API version** | v5 (current) has different API from v4. Do not guess — read the npm page for v5 before implementing. | Use dynamic import and isolate in a single `extractWithTesseract` function. |
| **Cloudinary folder permissions** | The `CLOUDINARY_URL` env var must have upload rights to the `famcare/documents/` folder. | Test with a small upload in dev before wiring up full flow. |
| **`ocrText` search on large tables** | `ILIKE '%keyword%'` (Prisma `contains` + `insensitive`) performs a full table scan. | Acceptable for MVP. Future: add PostgreSQL `GIN` full-text index on `ocrText`. |
| **PDF OCR** | Google Vision accepts PDF via GCS URI but not a public URL directly. For PDFs, must upload first then use Vision's async batch API. | Scope: OCR PDFs is out of scope for MVP. Log a warning and return `''` for PDF MIME types. |

---

## Appendix: Minimal `errorHandler.js` Update for Multer

The existing `errorHandler.js` needs one addition. Find the file at:
`famcare-backend/src/middleware/errorHandler.js`

Add before the default handler:

```js
// Handle multer file-upload errors
if (err.name === 'MulterError') {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.', code: 'FILE_TOO_LARGE' })
  }
  return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' })
}
```

This must be added as part of Task 1 (not a separate task) since it's required for the 413 test to pass.
