# Medication Tracking — Implementation Plan

> Generated for agent consumption. Do not implement code until all tasks are confirmed.

---

## Context

FamCare already has a **Medication Tracking skeleton** in place:
- Prisma models: `Medication`, `MedicationLog`, `MedicationSchedule`
- Service: `famcare-backend/src/services/medicationService.js` (CRUD + logs + schedule)
- Routes: full REST at `/api/v1/medications` — `famcare-backend/src/routes/medications.js`
- Cron: `famcare-backend/src/services/medicationReminderDispatchService.js` (reminder + missed-dose alerts)

**What is missing or incomplete:**
- No input validation on create/log endpoints
- No `active` filter on list; no date range / pagination on logs
- No dedicated adherence stats endpoint (buried inside pre-appointment report only)
- `log_medication` webhook postback is a **stub** — redirects to app instead of acting
- `quantity` field exists but nothing monitors it or alerts low stock
- Zero tests for the medication domain

This plan completes the feature end-to-end.

---

## 1. Goal Summary

Complete the Medication Tracking feature by:
1. Hardening the existing API with input validation and list filtering
2. Adding a standalone adherence stats endpoint
3. Implementing the LINE webhook `log_medication` postback (currently a stub)
4. Adding low-stock alerts based on the existing `quantity` field
5. Writing Jest tests covering all new and existing medication logic

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | Data models: `Medication`, `MedicationLog`, `MedicationSchedule` |
| `famcare-backend/src/routes/medications.js` | REST route handlers |
| `famcare-backend/src/services/medicationService.js` | Business logic (CRUD, logs, schedule) |
| `famcare-backend/src/services/medicationReminderDispatchService.js` | Cron reminder + missed-dose dispatch |
| `famcare-backend/src/services/accessService.js` | `assertCanReadMember`, `assertCanWriteMember` |
| `famcare-backend/src/services/caregiverNotifyService.js` | Owner LINE push when caregiver acts |
| `famcare-backend/src/services/linePushService.js` | `sendLinePushToUser` |
| `famcare-backend/src/webhook/handler.js` | LINE postback handler — stub at `log_medication` action |
| `famcare-backend/src/jobs/cron.js` | Cron scheduler |
| `famcare-backend/src/utils/datetime.js` | `toBangkokISO`, `bangkokCalendarDate`, `utcInstantFromBangkokYmdHm` |
| `famcare-backend/src/tests/appointment_management.test.js` | Reference test pattern to follow |

---

## 3. Data Model Changes

### `famcare-backend/prisma/schema.prisma`

Add two fields to the `Medication` model:

```prisma
model Medication {
  // ... all existing fields unchanged ...
  lowStockThreshold      Int?     // Alert when quantity <= this value (null = disabled)
  lastLowStockAlertDate  String?  // "YYYY-MM-DD" Bangkok — prevents same-day re-alert
}
```

**Migration command:**
```bash
cd famcare-backend
npx prisma migrate dev --name add_medication_low_stock_fields
```

No other schema changes required. All other gaps are implementable against the existing schema.

---

## 4. API Changes

### Modified endpoints

| Method | Path | Change |
|--------|------|--------|
| `GET /api/v1/medications` | Add optional `?active=true\|false` query param filter |
| `GET /api/v1/medications/:id/logs` | Add optional `?from=&to=` date range; `?limit=&cursor=` pagination |
| `POST /api/v1/medications` | Validate: `name` + `familyMemberId` required; accept `lowStockThreshold` |
| `PATCH /api/v1/medications/:id` | Accept and persist `lowStockThreshold` |
| `POST /api/v1/medications/:id/logs` | Validate: `status` in `["TAKEN","MISSED","SKIPPED"]`; `takenAt` required ISO string |

### New endpoint

| Method | Path | Description |
|--------|------|-------------|
| `GET /api/v1/medications/:id/adherence` | Query `?from=&to=` (default: last 30 days). Returns adherence counts and percentage. |

**Response shape for adherence:**
```json
{
  "data": {
    "medicationId": "...",
    "from": "2026-03-15T00:00:00+07:00",
    "to": "2026-04-14T23:59:59+07:00",
    "taken": 25,
    "missed": 3,
    "skipped": 2,
    "total": 30,
    "adherencePct": 83.3
  }
}
```
- `adherencePct` = `(taken / total) * 100` rounded to 1 decimal; `null` when `total === 0`

---

## 5. Implementation Tasks

---

### Task 1 — Input Validation for Medication Create & Log

**Purpose:** Prevent runtime crashes and confusing 500 errors when clients omit required fields or pass invalid enum values.

**Files to modify:**
- `famcare-backend/src/services/medicationService.js`
  - `createMedication`: validate `name` (required, non-empty string) and `familyMemberId` (required)
  - `createMedicationLog`: validate `status` is one of `TAKEN|MISSED|SKIPPED`; validate `takenAt` is a parseable ISO date string

**Pattern to follow:**
```js
// Existing error pattern in codebase
throw Object.assign(new Error('name is required'), { status: 400, code: 'BAD_REQUEST' })
```

**Acceptance criteria:**
- `POST /medications` with missing `name` → `400 { code: "BAD_REQUEST", error: "name is required" }`
- `POST /medications` with missing `familyMemberId` → `400 BAD_REQUEST`
- `POST /medications/:id/logs` with `status` not in `["TAKEN","MISSED","SKIPPED"]` → `400 BAD_REQUEST`
- `POST /medications/:id/logs` with missing or non-parseable `takenAt` → `400 BAD_REQUEST`
- Valid payloads still succeed (`201` response, existing shape)

**Tests to add:** `famcare-backend/src/tests/medication_validation.test.js`
- `createMedication` rejects missing name
- `createMedication` rejects missing familyMemberId
- `createMedicationLog` rejects invalid status
- `createMedicationLog` rejects missing takenAt
- Valid inputs return expected shape

**Verification:** `npm test -- --testPathPattern=medication_validation`

**Constraints:** No new npm dependencies. Follow existing error-object pattern throughout.

**Risks:** Low. Purely additive guards, no logic changes.

**Dependencies:** None — implement first.

---

### Task 2 — List Filtering: Active Filter + Log Date Range

**Purpose:** Allow clients to show only active medications and paginate through potentially large log histories.

**Files to modify:**
- `famcare-backend/src/services/medicationService.js`
  - `listMedications(actorUserId, familyMemberId, { active })`: add optional `active` boolean filter to Prisma `where` clause
  - `listMedicationLogs(actorUserId, medicationId, { from, to, limit, cursor })`: add date range filter on `takenAt`; add cursor-based pagination (default `limit: 50`)
- `famcare-backend/src/routes/medications.js`
  - Parse `active`, `from`, `to`, `limit`, `cursor` from `req.query` and pass to service

**Acceptance criteria:**
- `GET /medications?familyMemberId=X&active=true` returns only `active: true` rows
- `GET /medications?familyMemberId=X&active=false` returns only `active: false` rows
- `GET /medications?familyMemberId=X` (no `active` param) returns all — **existing behaviour preserved**
- `GET /medications/:id/logs?from=2026-01-01&to=2026-01-31` returns logs where `takenAt` is within range
- `GET /medications/:id/logs?limit=10&cursor=<logId>` returns next page after cursor item
- Invalid `active` value (e.g., `active=yes`) → treated as "no filter" (ignore silently)

**Date handling:** Use `utcInstantFromBangkokYmdHm` from `utils/datetime.js` to convert Bangkok-local date strings to UTC. Do NOT use `new Date(from)` directly.

**Tests to add:** `famcare-backend/src/tests/medication_list.test.js`
- `listMedications` with `active=true` returns only active rows
- `listMedications` with no `active` returns all rows
- `listMedicationLogs` with date range filters correctly
- `listMedicationLogs` cursor pagination returns correct slice

**Verification:** `npm test -- --testPathPattern=medication_list`

**Constraints:** No schema changes. Default `limit = 50`.

**Risks:** Cursor pagination edge cases (first page, last page, invalid cursor ID). Validate cursor exists before using, throw 400 if invalid.

**Dependencies:** None — can run in parallel with Task 1.

---

### Task 3 — Adherence Stats Endpoint

**Purpose:** Give clients a dedicated, queryable adherence summary per medication, independent of the appointment pre-report.

**Files to modify:**
- `famcare-backend/src/services/medicationService.js`
  - Add `getMedicationAdherence(actorUserId, medicationId, { from, to })`
  - Default date range: last 30 days in Bangkok time
  - Group `MedicationLog` counts by `status`
  - Compute `adherencePct = taken / total * 100` (null if total === 0)
- `famcare-backend/src/routes/medications.js`
  - Add `GET /:id/adherence` route **before** the `GET /:id` catch-all to avoid route shadowing

**Acceptance criteria:**
- `GET /medications/:id/adherence` with no params → uses last 30 days, returns correct counts
- `GET /medications/:id/adherence?from=2026-01-01&to=2026-01-31` → uses specified range
- Zero logs in window → `{ total: 0, adherencePct: null }`
- All TAKEN → `adherencePct: 100.0`
- Mixed statuses → correct counts and percentage
- VIEWER and CAREGIVER roles can access (read-only)
- Non-existent medication ID → `404 NOT_FOUND`
- Unauthorized user → `403 FORBIDDEN`

**Tests to add:** `famcare-backend/src/tests/medication_adherence.test.js`
- Empty window → null adherencePct
- All TAKEN → 100.0
- Mixed TAKEN/MISSED/SKIPPED → correct math
- Permission denied for unauthorized user
- 404 for non-existent medication

**Verification:** `npm test -- --testPathPattern=medication_adherence`

**Constraints:** Pure computation over `MedicationLog` table. No schema changes.

**Risks:** Bangkok timezone boundaries for date range. Must convert `from`/`to` Bangkok date strings to UTC instants before querying. Off-by-one errors likely if using `new Date()` directly.

**Dependencies:** Task 2 (date range pattern established; reuse the same utility approach).

---

### Task 4 — LINE Webhook: Implement `log_medication` Postback

**Purpose:** Replace the current stub (which redirects to app) with actual medication log creation from the LINE bot. Enables caregivers to confirm a dose directly from a LINE reminder push.

**Files to modify:**
- `famcare-backend/src/webhook/handler.js`
  - Replace stub `log_medication` handler with real implementation
  - Import `createMedicationLog` from `medicationService.js`
  - Call `findOrCreateByLineUserId(lineUserId)` to get `user.id` (mirrors `add_appointment` pattern)
  - Default `takenAt` to `new Date().toISOString()` if not provided in postback

**Postback data format expected:**
```json
{
  "action": "log_medication",
  "medicationId": "<id>",
  "status": "TAKEN",
  "takenAt": "2026-04-14T08:00:00+07:00"
}
```

**Reply messages (Thai):**
- Success: `"✅ บันทึกการกินยา ${med.name} (${status}) เรียบร้อยแล้ว"`
- Missing medicationId: `"กรุณาระบุ medicationId"`
- Invalid status: `"สถานะไม่ถูกต้อง ต้องเป็น TAKEN, MISSED หรือ SKIPPED"`
- Not found / access denied: `"เกิดข้อผิดพลาด: ${err.message}"`

**Acceptance criteria:**
- Valid postback creates `MedicationLog` and replies with success message
- Missing `medicationId` → error reply, no log created, no crash
- Invalid `status` → error reply, no log created
- Unknown medication or access denied → error reply, no unhandled exception
- `takenAt` defaults to current time if absent from postback

**Tests to add:** `famcare-backend/src/tests/medication_webhook.test.js`
- Valid postback → log created, correct reply sent
- Missing medicationId → error reply, no DB write
- Invalid status → error reply
- Service throws → error reply, no crash

**Verification:** `npm test -- --testPathPattern=medication_webhook`

**Constraints:** Must call `findOrCreateByLineUserId` before service call (no direct `lineUserId` → service). Do not re-throw from webhook handler — always reply and return.

**Risks:**
- LINE has a ~1-second reply timeout. DB calls are fast but keep the pattern async like other handlers.
- `createMedicationLog` will throw if validation fails (Task 1) — catch and reply gracefully.

**Dependencies:** Task 1 (validation must be in place before webhook relies on it).

---

### Task 5 — Low-Stock Alert (Schema Migration + Cron Job)

**Purpose:** Alert the family when a medication's `quantity` drops to or below a configurable threshold.

**Files to modify:**
- `famcare-backend/prisma/schema.prisma`
  - Add `lowStockThreshold Int?` and `lastLowStockAlertDate String?` to `Medication`
- `famcare-backend/src/services/medicationService.js`
  - Expose `lowStockThreshold` in `createMedication` and `updateMedication`
  - Add `checkLowStockAlerts()` function:
    1. Query all `active` medications where `quantity IS NOT NULL AND lowStockThreshold IS NOT NULL AND quantity <= lowStockThreshold AND (lastLowStockAlertDate IS NULL OR lastLowStockAlertDate != todayStr)`
    2. For each, call `getRecipients(familyMemberId)` (reuse from `medicationReminderDispatchService.js`)
    3. Send LINE push: `"⚠️ ยาใกล้หมด: ${med.name} เหลือ ${med.quantity} ${unit or 'เม็ด'} กรุณาจัดซื้อเพิ่ม"`
    4. Update `lastLowStockAlertDate` to today's Bangkok date string
- `famcare-backend/src/jobs/cron.js`
  - Add a once-daily cron for low-stock check (e.g., `0 8 * * *` = 08:00 Bangkok if server is UTC+0, use `1 8 * * *`)

**Acceptance criteria:**
- `POST /medications` accepts `lowStockThreshold` field; returned in response
- `PATCH /medications/:id` can update `lowStockThreshold`
- Cron runs daily, finds medications at/below threshold, sends LINE push
- Same medication not alerted twice in the same day
- `lowStockThreshold = null` or `quantity = null` → no alert
- `active = false` → no alert

**Tests to add:** `famcare-backend/src/tests/medication_low_stock.test.js`
- Medication at threshold → alert sent, `lastLowStockAlertDate` updated
- Medication above threshold → no alert
- `lastLowStockAlertDate` equals today → no re-alert
- `lowStockThreshold = null` → skipped
- `active = false` → skipped

**Verification:** `npm test -- --testPathPattern=medication_low_stock`

**Constraints:** Reuse `sendLinePushToUser` and `getRecipients` patterns from `medicationReminderDispatchService.js`. Do not duplicate the helper — extract `getRecipients` to a shared location or import it directly.

**Risks:**
- `quantity` is client-managed (no auto-decrement on TAKEN log). Accuracy depends on client updating quantity. Document this in code comments.
- `getRecipients` is currently unexported from `medicationReminderDispatchService.js`. Either export it or duplicate a minimal version. Prefer extracting to a shared utility.

**Dependencies:** Task 1 (validation in place). Requires schema migration before running.

---

### Task 6 — Full Test Suite

**Purpose:** Consolidate and complete Jest coverage for all medication service functions.

**New test files (some created inline in Tasks 1–5):**
- `famcare-backend/src/tests/medication_validation.test.js` — validation guards (Task 1)
- `famcare-backend/src/tests/medication_list.test.js` — filtering + pagination (Task 2)
- `famcare-backend/src/tests/medication_adherence.test.js` — adherence stats (Task 3)
- `famcare-backend/src/tests/medication_webhook.test.js` — LINE postback (Task 4)
- `famcare-backend/src/tests/medication_low_stock.test.js` — low-stock alert (Task 5)
- `famcare-backend/src/tests/medication_crud.test.js` — core CRUD not covered by the above

**Coverage targets for `medication_crud.test.js`:**
- `listMedications` — success, permission denied
- `getMedication` — found, not found, permission denied
- `updateMedication` — partial update, active toggle
- `deleteMedication` — success, not found
- `getMedicationSchedule` + `updateMedicationSchedule` — set, replace, clear times, invalid format

**Mock pattern (follow `appointment_management.test.js`):**
- Mock `prisma` at module level with Jest
- Mock `linePushService.js` to prevent real LINE calls
- Use `supertest` for HTTP-level integration paths
- Call `jest.clearAllMocks()` in `beforeEach` to prevent cross-test bleed

**Verification:** `npm test`

**Constraints:** No new test dependencies. Use existing Jest + supertest setup.

**Risks:** Prisma mock setup for date-range queries requires careful mock return value design. Plan mock structure before writing.

**Dependencies:** All previous tasks complete.

---

## 9. Safe Implementation Order

```
Task 1 (Validation)          ←── start here, no dependencies
    │
    ├──→ Task 2 (List Filtering)    ←── parallel with Task 1 if desired
    │         │
    │         └──→ Task 3 (Adherence Stats)
    │
    └──→ Task 4 (Webhook)           ←── after Task 1

Task 5 (Low Stock + Migration)      ←── after Task 1; do last before tests
    │
    └──→ Task 6 (Full Test Suite)   ←── after all above
```

**Recommended sequence:** 1 → 2 → 3 → 4 → 5 → 6

---

## 10. Global Risks & Ambiguities

| Risk | Detail | Mitigation |
|------|--------|-----------|
| `quantity` is client-managed | Backend does not auto-decrement on TAKEN log. Low-stock alerts depend on clients calling `PATCH /medications/:id` to update quantity. | Add a code comment. Consider mentioning in the push message. |
| Bangkok timezone boundaries | Date-range filtering and adherence stats must convert `from`/`to` Bangkok-local dates to UTC using `utcInstantFromBangkokYmdHm`. Using `new Date(from)` directly is off by 7 hours. | Use existing `datetime.js` utilities throughout. |
| Soft-deleted family members | `assertCanReadMember` does not check `FamilyMember.isDeleted`. Medications for a deleted member remain accessible via direct medication ID. | Add `isDeleted` guard in `getMedication` and `listMedications`, or flag as known gap. |
| `getRecipients` not exported | Helper in `medicationReminderDispatchService.js` is unexported. Task 5 needs it. | Export or move to a shared utility file before Task 5. |
| Route order in `medications.js` | New `GET /:id/adherence` must be registered **before** `GET /:id` or Express will treat "adherence" as a medication ID. | This is already handled for `/logs` and `/schedule`; follow the same placement pattern. |
| Test Prisma mock complexity | Date-range queries require precise mock return values. | Sketch the mock structure in a comment at the top of each test file before writing assertions. |
