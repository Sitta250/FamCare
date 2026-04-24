# Feature 2 — Appointment Management — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Appointment Management feature is implemented. Run the specific test assertions listed below and fix any failures in the implementation (not the tests). All 7 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/appointments.js` | REST route handlers |
| `famcare-backend/src/services/appointmentService.js` | Business logic: createAppointment, listAppointments, updateAppointment, cancelAppointment, markCompleted |
| `famcare-backend/src/tests/appointment_management.test.js` | Primary test file — run this |
| `famcare-backend/prisma/schema.prisma` | Appointment + Reminder models |

## API Surface Being Tested

```
POST   /api/v1/appointments
GET    /api/v1/appointments?memberId=&view=upcoming|calendar
PATCH  /api/v1/appointments/:id
DELETE /api/v1/appointments/:id
```

## Tasks

1. Run the appointment tests:
   ```bash
   cd famcare-backend && npx jest appointment --verbose
   ```
2. For any failing test, read the test assertion carefully. Fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - On `POST`, 4 Reminder rows are auto-created at T-7d, T-2d, T-1d, T-2h (UTC)
   - On reschedule (`PATCH` with new datetime), all 4 Reminder rows are recalculated
   - `GET ?view=upcoming` returns only future, non-cancelled appointments sorted ascending
   - `GET ?view=calendar` returns appointments grouped by date
   - `PATCH` to mark completed with `postNotes` saves both status=COMPLETED and the notes
   - `DELETE` (or cancel) sets status=CANCELLED and reminders are not fired
   - A user cannot access another family's appointments (auth scope check)
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest appointment --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- POST creates appointment → 4 Reminder rows created at correct UTC times
- Reschedule → Reminder rows recalculated
- GET ?view=upcoming → future non-cancelled only, sorted ascending
- GET ?view=calendar → grouped by date
- Mark completed with postNotes → status + notes saved
- Cancel → status CANCELLED, reminders not fired
- Auth: user cannot access another family's appointments
