# Feature 4 — Medication Tracking — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Medication Tracking feature is implemented. Run the specific test assertions listed below and fix any failures in the implementation. All 7 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/medications.js` | REST route handlers |
| `famcare-backend/src/services/medicationService.js` | Business logic: createMedication, getDurationString, logDosageChange, confirmDose, checkMissedDoses, refillCheck |
| `famcare-backend/src/services/medicationReminderDispatchService.js` | Cron: missed dose + refill alerts |
| `famcare-backend/src/tests/medications.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | Medication, MedicationDosageHistory, DoseLog models |

## API Surface Being Tested

```
POST   /api/v1/medications
GET    /api/v1/medications?memberId=
PATCH  /api/v1/medications/:id
POST   /api/v1/medications/:id/doses
POST   /api/v1/medications/:id/dosage-change
```

## Tasks

1. Run the medication tests:
   ```bash
   cd famcare-backend && npx jest medication --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - Create medication → duration string correct at day 0, day 30, day 90
   - Dosage change → MedicationDosageHistory row created, current dosage updated, old history preserved
   - GET medications → returns full dosage history array per medication
   - Tap-to-confirm dose → DoseLog created for correct scheduled time
   - Missed dose: no DoseLog after buffer window → caregiver LINE push fires
   - Refill: quantity reaches threshold → refill reminder fires
   - endDate in past → medication returned with `active: false` (or equivalent inactive flag)
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest medication --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Create medication → duration string correct at day 0, day 30, day 90
- Dosage change → history row created, current dosage updated, old history preserved
- GET medications → returns full dosage history array per medication
- Tap-to-confirm dose → DoseLog created for correct scheduled time
- Missed dose: no DoseLog after buffer → caregiver LINE push fires
- Refill: quantity reaches threshold → refill reminder fires
- endDate in past → medication shown as inactive
