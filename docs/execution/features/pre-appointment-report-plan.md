# Pre-Appointment Report — Implementation & Test Plan

## 1. Goal Summary

Write a comprehensive supertest + Jest test suite for the Pre-Appointment Report feature in
`src/tests/pre_appointment_report.test.js`, then run `npm test` to verify all tests pass. If
tests fail, fix the **implementation** (not the tests) until they pass.

**Critical discovery:** The service and route are already fully implemented. No new code is
required except the test file. The task is test coverage only.

| Component | Status |
|-----------|--------|
| `GET /api/v1/appointments/:id/pre-appointment-report` route | ✅ Exists in `routes/appointments.js:31` |
| `getPreAppointmentReport(actorUserId, appointmentId)` service | ✅ Exists in `services/preAppointmentReportService.js` |
| PDF export | ❌ Not implemented — no PDF library in deps; API returns JSON only |
| Test file `src/tests/pre_appointment_report.test.js` | ❌ Does not exist — must be created |

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/src/routes/appointments.js` | Route handler — mounts `GET /:id/pre-appointment-report` at line 31 |
| `famcare-backend/src/services/preAppointmentReportService.js` | Business logic — `getPreAppointmentReport()` |
| `famcare-backend/src/services/accessService.js` | Permission check — `assertCanReadMember()` |
| `famcare-backend/src/services/userService.js` | Auth — `findOrCreateByLineUserId()` used by `requireLineUser` |
| `famcare-backend/src/middleware/auth.js` | `requireLineUser` middleware applied to all routes |
| `famcare-backend/src/middleware/errorHandler.js` | Global error handler; converts thrown errors to JSON |
| `famcare-backend/src/lib/prisma.js` | Prisma singleton — must be mocked in tests |
| `famcare-backend/src/utils/datetime.js` | `toBangkokISO()` — used for all date formatting in service |
| `famcare-backend/prisma/schema.prisma` | Source of truth for models: `Appointment`, `SymptomLog`, `Medication`, `MedicationLog`, `HealthMetric` |

---

## 3. Data Model Changes

**None required.** All necessary fields and relations already exist:

- `Appointment` — `id`, `familyMemberId`, `status`, `appointmentAt`, `doctor`, `hospital`, `reason`
- `SymptomLog` — `familyMemberId`, `loggedAt`, `description`, `severity`, `note`
- `Medication` (active: true) with `MedicationLog` — `status` (TAKEN/MISSED/SKIPPED), `takenAt`
- `HealthMetric` — `familyMemberId`, `measuredAt`, `type`, `value`, `unit`, `note`

---

## 4. API Changes

**None required.** The endpoint already exists:

```
GET /api/v1/appointments/:id/pre-appointment-report
Headers: x-line-userid (required)
Response: { data: { appointment, windowStart, windowEnd, basedOnLastVisit, symptoms,
                    medicationAdherence, recentHealthMetrics, suggestedQuestions } }
```

**Note on "PDF export" from the feature spec:** The codebase has no PDF generation library
(`pdfkit`, `puppeteer`, etc. are not in `package.json`). The API returns structured JSON only.
PDF rendering is handled client-side (iOS app). The PDF test case should be reframed as
**"response is valid JSON with all required sections"** rather than a binary PDF check.

---

## 5. Frontend Changes

None — backend-only repository.

---

## 6. Edge Cases

| Edge Case | Expected Behaviour |
|-----------|--------------------|
| Appointment not found | 404 `NOT_FOUND` |
| User has no access to family member | 403 `FORBIDDEN` |
| No prior completed appointment → window fallback | `basedOnLastVisit: false`, `windowStart` is ~14 days ago |
| Prior completed appointment exists | `basedOnLastVisit: true`, `windowStart` equals that appointment's `appointmentAt` |
| No symptoms in window | `symptoms: []` — not an error |
| No active medications | `medicationAdherence: []` |
| No health metrics in last 14 days | `recentHealthMetrics: []` |
| All medications taken (100% adherence) | `adherenceRate: 100`, no adherence question in `suggestedQuestions` |
| Adherence < 80% | `suggestedQuestions` includes medication adherence question |
| Symptom with severity ≥ 7 | `suggestedQuestions` names the symptom with severity |
| Blood pressure metric present | `suggestedQuestions` includes BP question |
| No symptoms + no adherence issues + no BP | `suggestedQuestions` has fallback generic question |
| `x-line-userid` header missing | 401 (enforced by `requireLineUser` middleware) |
| Adherence: 20 TAKEN / 5 MISSED / 0 SKIPPED = 25 total → 80% | `adherenceRate: 80` |

---

## 7. Implementation Tasks

### Task 1 — Write the Test File

**Title:** Create `src/tests/pre_appointment_report.test.js`

**Purpose:** Provide complete test coverage for `GET /api/v1/appointments/:id/pre-appointment-report`
following the exact patterns used in `appointment_management.test.js`.

**Files Affected:**
- `famcare-backend/src/tests/pre_appointment_report.test.js` ← **create**

**Dependencies:** None (no code changes needed first)

**Acceptance Criteria:**
1. File is at `src/tests/pre_appointment_report.test.js`
2. Uses `jest.unstable_mockModule` for all ESM mocks (prisma, accessService, userService)
3. Mocks prisma models: `appointment.findUnique`, `appointment.findFirst`, `symptomLog.findMany`,
   `medication.findMany`, `healthMetric.findMany`
4. Builds a minimal Express app with the real `appointmentsRouter` and `errorHandler`
5. All test cases below are implemented and passing

**Test Cases to Implement:**

```
describe('GET /api/v1/appointments/:id/pre-appointment-report')

  TC-1: Full history — all sections populated
    Setup:
      - mockApptFindUnique resolves a fake appointment (UPCOMING, future date)
      - mockApptFindFirst resolves a prior COMPLETED appointment (basedOnLastVisit: true)
      - mockSymptomLogFindMany resolves 2 symptoms (one severity 8)
      - mockMedicationFindMany resolves 1 medication with 20 TAKEN + 5 MISSED logs
      - mockHealthMetricFindMany resolves 1 BLOOD_PRESSURE metric
    Assert:
      - res.status === 200
      - res.body.data.basedOnLastVisit === true
      - res.body.data.symptoms.length === 2
      - res.body.data.medicationAdherence[0].adherenceRate === 80
      - res.body.data.recentHealthMetrics.length === 1
      - res.body.data.suggestedQuestions.length >= 1
      - res.body.data.appointment.id exists

  TC-2: No prior symptoms → symptoms is empty array, not error
    Setup:
      - mockSymptomLogFindMany resolves []
      - other mocks resolve valid data
    Assert:
      - res.status === 200
      - res.body.data.symptoms === []

  TC-3: Response is valid JSON with all required sections (PDF test reframed)
    Setup: all mocks resolve valid data
    Assert:
      - res.status === 200
      - res.body.data has keys: appointment, windowStart, windowEnd, basedOnLastVisit,
        symptoms, medicationAdherence, recentHealthMetrics, suggestedQuestions
      - res.body.data.appointment has keys: id, title, appointmentAt, doctor, hospital, reason
      - appointmentAt matches /\+07:00$/ (Bangkok ISO format)

  TC-4: Adherence calculation — 20 TAKEN / 5 MISSED → 80%
    Setup:
      - mockMedicationFindMany resolves 1 medication with exactly 20 TAKEN + 5 MISSED logs
    Assert:
      - res.body.data.medicationAdherence[0].taken === 20
      - res.body.data.medicationAdherence[0].missed === 5
      - res.body.data.medicationAdherence[0].total === 25
      - res.body.data.medicationAdherence[0].adherenceRate === 80

  TC-5: Abnormal metric (high severity symptom) → appears in suggestedQuestions
    Setup:
      - mockSymptomLogFindMany resolves [{ description: 'Fever', severity: 9, ... }]
    Assert:
      - res.body.data.suggestedQuestions.some(q => q.includes('Fever'))

  TC-6: Appointment not found → 404
    Setup:
      - mockApptFindUnique resolves null
    Assert:
      - res.status === 404
      - res.body.code === 'NOT_FOUND'

  TC-7: Access denied → 403
    Setup:
      - mockApptFindUnique resolves a valid appointment
      - mockAssertCanReadMember rejects with { status: 403, code: 'FORBIDDEN' }
    Assert:
      - res.status === 403
      - res.body.code === 'FORBIDDEN'

  TC-8: No prior completed appointment → basedOnLastVisit false, windowStart ~14 days ago
    Setup:
      - mockApptFindFirst resolves null (no prior visit)
    Assert:
      - res.body.data.basedOnLastVisit === false
      - windowStart is defined (truthy)

  TC-9: No active medications → medicationAdherence is empty array
    Setup:
      - mockMedicationFindMany resolves []
    Assert:
      - res.body.data.medicationAdherence equals []

  TC-10: Missing x-line-userid header → 401 UNAUTHORIZED
    Setup: no AUTH headers (do not set x-line-userid)
    Assert:
      - res.status === 401
      - res.body.code === 'UNAUTHORIZED'
      - res.body.error === 'Missing x-line-userid header'
    Note: requireLineUser middleware (auth.js:6-8) short-circuits with res.status(401).json(...)
          before any service call. userService mock is NOT needed for this test case.
```

**Exact Tests to Add:** All 10 above in a single `describe` block.

**Verification Command:**
```bash
cd famcare-backend && npm test -- --testPathPattern=pre_appointment_report
```

**Constraints:**
- Follow ESM mock pattern from `appointment_management.test.js` exactly
- No new npm dependencies
- Mock `symptomLog.findMany`, `medication.findMany`, `healthMetric.findMany` at the `prisma` level
- `mockMedicationFindMany` must return medication objects with an `logs` array embedded
  (since the service uses `include: { logs: { where: { ... } } }`)
- Include a `fakeAppointment()` fixture factory for reuse across tests
- `mockAssertCanReadMember` defaults to resolving `'OWNER'` in `beforeEach`

**Risks / Edge Cases Specific to This Task:**
- The service calls `prisma.medication.findMany` with `include: { logs: ... }`. The mock must
  return objects with a `logs` property — not just the medication fields.
- `prisma.appointment.findFirst` is used for the "last completed" query. If this mock is not set up,
  the service will throw because `.appointmentAt` is accessed on the result.
- Health metrics window uses a rolling "last 14 days" from `Date.now()`, not `windowStart`. Tests
  should not hardcode dates that might fall outside this window.
- `suggestedQuestions` is purely rule-based (no external calls), so it can be asserted
  deterministically based on mock data.

---

### Task 2 — Run Tests and Fix Failures

**Title:** Run full test suite; fix any implementation bugs until all tests pass

**Purpose:** Validate the service implementation against the test cases. Fix `preAppointmentReportService.js`
if any edge cases expose bugs (e.g., null-safety, date boundary issues, wrong adherence formula).

**Files Potentially Affected:**
- `famcare-backend/src/services/preAppointmentReportService.js` ← may need bug fixes
- `famcare-backend/src/tests/pre_appointment_report.test.js` ← the test file (do not change tests)

**Dependencies:** Task 1 must be complete

**Acceptance Criteria:**
- `npm test` exits with code 0
- All 10 test cases in `pre_appointment_report.test.js` pass
- No regressions in existing test files

**Verification Command:**
```bash
cd famcare-backend && npm test
```

**Constraints:**
- Fix implementation only — never modify test assertions to make them pass artificially
- Follow existing error-throwing convention: `Object.assign(new Error(...), { status, code })`

**Risks:**
- The `suggestedQuestions` function uses `healthMetrics` but the test mocks `mockHealthMetricFindMany`.
  If the service accesses `m.type` or `m.value` on metrics that the mock doesn't include, it will throw.
- The adherence calculation divides by `total`. If `total === 0`, `adherenceRate` must return `null`
  (not `NaN`). Verify this in the service — it already handles this at line 69 but confirm.

---

## 8. Safest Implementation Order

```
Task 1 → Task 2
```

Both tasks are sequential. Write the tests first, then run and fix. No parallelism needed.

---

## 9. Global Risks and Ambiguities

| Risk | Detail |
|------|--------|
| **PDF export not implemented** | Feature spec mentions PDF/image export. The actual codebase has no `pdfkit` / `puppeteer`. The "PDF test" is reframed as a structured JSON verification. If PDF is required in future, it must be added as a separate task with new deps. |
| **Route path mismatch** | Feature spec says `GET /api/v1/appointments/:id/report` but the actual route is `GET /api/v1/appointments/:id/pre-appointment-report`. Tests must use the actual path. |
| **Medication mock shape** | The service does `include: { logs: ... }` inside `findMany`. Mocking `findMany` to return bare medication objects (without `logs: []`) will cause `med.logs.filter(...)` to throw. Always include `logs` in mock data. |
| **Date window for health metrics** | The service uses `Date.now() - 14 days` for health metrics regardless of `windowStart`. Tests that set metrics with `measuredAt` beyond 14 days from "now" may not appear in results. Use dates close to `Date.now()` in fixtures. |
| **`suggestedQuestions` is deterministic** | The rule engine is pure synchronous logic — no AI, no external calls. Assertions on question content are reliable as long as mock data drives the rules predictably. |
| **Existing tests must keep passing** | Do not modify `preAppointmentReportService.js` in ways that break the adherence calculation used by `medication_adherence.test.js`. |
