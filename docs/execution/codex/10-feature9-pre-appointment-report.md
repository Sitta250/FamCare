# Feature 9 — Pre-Appointment Report — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Pre-Appointment Report feature is implemented (aggregates symptoms since last visit, medication adherence %, health metric trends, suggested questions, PDF via pdfkit). Run the specific test assertions listed below and fix any failures in the implementation. All 5 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/appointments.js` | GET /api/v1/appointments/:id/report |
| `famcare-backend/src/services/preAppointmentReportService.js` | Aggregate symptoms, adherence, metrics, questions, generate PDF |
| `famcare-backend/src/tests/report.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | Appointment, SymptomLog, MedicationLog, HealthMetric models |

## API Surface Being Tested

```
GET /api/v1/appointments/:id/report
GET /api/v1/appointments/:id/report?format=pdf   (returns PDF binary)
```

## Tasks

1. Run the report tests:
   ```bash
   cd famcare-backend && npx jest report --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - Report with full history → all sections populated: symptoms, adherence, metrics, suggested questions
   - No prior symptoms → `symptoms: []` (empty array, not error)
   - PDF endpoint returns valid PDF binary (Content-Type: application/pdf)
   - Adherence calculation: 20 doses logged out of 25 expected → `adherence: 80` (or `0.80`)
   - Abnormal metric within the reporting window → appears in the metrics section
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest report --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Report with full history → all sections populated
- No prior symptoms → empty array, not error
- PDF endpoint returns valid PDF binary
- Adherence: 20/25 expected doses → 80%
- Abnormal metric in window → appears in report
