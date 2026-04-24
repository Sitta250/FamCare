# Immediate Fixes — Codex Task

## Status
IMPLEMENT

## Goal
Fix two existing bugs before any other work: (1) the reminder cron job throws a 400 because it pushes to a LINE userId that may not exist — look it up from the User table first and skip with a warning if not found; (2) remove the temporary test push route that was used during development.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/services/reminderDispatchService.js` | Contains the reminder cron logic — fix lineUserId lookup here |
| `famcare-backend/src/services/linePushService.js` | `sendLinePushToUser(lineUserId, messages)` — the push call being made |
| `famcare-backend/src/routes/test.js` | Contains POST /api/v1/test/push — delete this file or remove the route |
| `famcare-backend/src/routes/index.js` | Route aggregator — remove the test route import/registration |

## Tasks

1. Open `famcare-backend/src/services/reminderDispatchService.js`.
2. Find where it sends a LINE push for a reminder. Before calling `sendLinePushToUser`, look up the `lineUserId` from the `User` table via Prisma using the `userId` associated with the appointment/family member.
3. If no User row is found, or if `user.lineUserId` is null/undefined, log a warning (`console.warn`) and `continue` — do not throw or crash.
4. Only call `sendLinePushToUser` if a valid `lineUserId` is found.
5. Open `famcare-backend/src/routes/test.js` and delete the file entirely, or remove the `POST /api/v1/test/push` route handler from it.
6. Open `famcare-backend/src/routes/index.js` and remove the import and `router.use()` registration for the test route.
7. Run `cd famcare-backend && npm run check` — confirm schema still validates.
8. Run `cd famcare-backend && npm test` — confirm no tests broke.

## Test Commands

```bash
cd famcare-backend && npm run check
cd famcare-backend && npm test
```

## Pass Criteria

- Reminder cron no longer throws 400 when lineUserId is missing — skips with a console.warn instead
- POST /api/v1/test/push returns 404 (route no longer exists)
- All existing tests still pass
