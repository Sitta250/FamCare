# Feature 3 — Smart Appointment Reminders — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Smart Appointment Reminders cron is implemented. Run the specific test assertions listed below and fix any failures in the implementation. All 5 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/services/reminderDispatchService.js` | Cron logic: query PENDING reminders, send LINE push, mark SENT |
| `famcare-backend/src/jobs/cron.js` | Cron scheduler (every 5 min) |
| `famcare-backend/src/services/linePushService.js` | `sendLinePushToUser` |
| `famcare-backend/src/tests/reminders.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | Reminder model |

## Cron Logic Being Tested

Every 5 minutes: query Reminder rows where `scheduledAt <= now+5min`, `status=PENDING`, and `appointment.status=SCHEDULED` → send LINE push → mark status=SENT.

## Tasks

1. Run the reminders tests:
   ```bash
   cd famcare-backend && npx jest reminders --verbose
   ```
2. For any failing test, fix the **implementation** (service or cron), not the test.
3. Key behaviors to verify:
   - Only PENDING reminders within the 5-min window are sent
   - Already-SENT reminders are not re-sent (idempotency check)
   - Reminders for CANCELLED appointments are skipped
   - Custom reminder timing: if only [3d, 1d] offsets configured, only 2 Reminder rows exist
   - LINE push delivers correctly (check Railway logs for actual delivery)
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest reminders --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Cron only sends PENDING reminders within the 5-min window
- Already-SENT reminders not re-sent (idempotency)
- Cancelled appointment reminders skipped
- Custom timing: [3d, 1d] offsets → only 2 Reminder rows created
- LINE push delivers correctly (verify in Railway logs)
