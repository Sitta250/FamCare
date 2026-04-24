# Final Checks — Codex Task

## Status
VERIFY

## Goal
Run the complete verification suite after all other tasks (00–13) are done. All checks must be green before the backend is considered production-ready.

## Prerequisite
All tasks 00–13 must be completed and passing before running this file.

## Tasks

1. **Run full test suite — all tests must be green:**
   ```bash
   cd famcare-backend && npm test
   ```
   Expected: all suites pass, 0 failures.

2. **Check Railway deploy logs — no red errors:**
   - Open Railway dashboard → FamCare backend service → Logs
   - Look for any ERROR-level log lines after the last deploy
   - Fix any runtime errors found

3. **Confirm all cron jobs are running:**
   Check `famcare-backend/src/jobs/cron.js` and confirm these 4 cron jobs are registered and scheduled:
   - Reminder dispatch (every 5 min) — sends appointment reminders
   - Missed dose check (scheduled) — alerts caregivers of missed medications
   - Refill check (scheduled) — alerts when medication quantity is low
   - Insurance expiry check (scheduled) — alerts at 60d, 30d, 7d before expiry

4. **Test full user flow end-to-end in LINE:**
   Using the live Railway bot:
   - Add a family member via LINE
   - Add a medication for that member
   - Confirm a dose via LINE message
   - Add an appointment
   - Wait for or manually trigger the reminder cron → confirm LINE push received

5. **Confirm test push route is removed:**
   ```bash
   curl -X POST https://famcare-backend-production.up.railway.app/api/v1/test/push
   ```
   Expected: HTTP 404 (route no longer exists).

6. **Optional — Swap Gemini to Claude Sonnet for production:**
   If higher quality responses are needed, replace `gemini-2.0-flash` with Claude via the Anthropic API. This requires:
   - Adding `ANTHROPIC_API_KEY` to Railway env vars
   - Replacing `@google/generative-ai` with `@anthropic-ai/sdk`
   - Updating `webhook/handler.js` to use the Anthropic client
   - Re-running `npm test`

7. **Schema validation:**
   ```bash
   cd famcare-backend && npm run check
   ```
   Expected: no errors.

## Test Commands

```bash
cd famcare-backend && npm run check
cd famcare-backend && npm test
```

## Pass Criteria

- Full test suite: `npm test` — all tests green
- Railway deploy logs — no red errors
- All 4 cron jobs confirmed running (reminders, missed dose, refill, insurance expiry)
- Full user flow end-to-end in LINE: add member → add medication → confirm dose → add appointment → receive reminder
- POST /api/v1/test/push → 404 (route removed)
- (Optional) Claude Sonnet swap done and tested
- Move to frontend
