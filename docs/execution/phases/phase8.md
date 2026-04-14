# Phase 8 — LINE push + appointment reminder cron

## Goal

- **`linePushService`**: wrap Messaging API **push** to a LINE user id using `LINE_CHANNEL_ACCESS_TOKEN`.
- **`reminderDispatchService`**: find `Reminder` rows where `sent = false` and `scheduledAt <= now()`, send push, set `sent = true` (idempotent: use transaction or `updateMany` with condition).
- **`node-cron`**: run every minute (or 30s in dev) calling dispatch.

Recipients for each reminder: **`FamilyMember.owner`** LINE id **plus** all **CAREGIVER** `FamilyAccess` for that member (see [docs/architecture/schema.md](../../architecture/schema.md) notification table). Optional: include VIEWER—PRD says owner + caregivers for reminders; **exclude VIEWER** unless product changes.

## Prerequisites

- [Phase 6](phase6.md) reminders exist
- [Phase 7](phase7.md) LINE packages installed
- `LINE_CHANNEL_ACCESS_TOKEN` set

## Step-by-step

1. Add `node-cron` dependency.

2. **`services/linePushService.js`**
   - Use `MessagingApiClient` from `@line/bot-sdk` (or project’s documented client).
   - If no token in dev, **log** instead of throwing.

3. **`services/reminderDispatchService.js`**
   - Query due reminders with `include: { appointment: { include: { familyMember: { include: { owner: true, accessList: { include: { grantedTo: true } } } } } } } }` (adjust shape).
   - Build distinct list of `lineUserId` for push.
   - Message text: Thai or bilingual stub with appointment title + local time (Bangkok).

4. **`src/jobs/cron.js`**
   - `startCronJobs()` schedules cron; export for `index.js`.

5. **`src/index.js`**
   - Call `startCronJobs()` after `listen`.

6. **Concurrency**
   - Process reminders in a loop with `try/catch` per reminder so one failure does not block others.

## Definition of done

- Seed past `scheduledAt` + `sent: false` → after tick, `sent` is true and LINE receives message (or log in dev).

## Verify

Temporarily set a reminder `scheduledAt` to 1 minute ago; run server; check DB and logs.

## Next

[phase9.md](phase9.md)
