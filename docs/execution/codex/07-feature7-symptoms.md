# Feature 7 — Symptom & Notes Log — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Symptom & Notes Log feature is implemented. Run the specific test assertions listed below and fix any failures in the implementation. All 5 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/symptomLogs.js` | REST route handlers |
| `famcare-backend/src/services/symptomLogService.js` | createSymptomLog, listSymptomLogs |
| `famcare-backend/src/tests/symptoms.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | SymptomLog model |

## API Surface Being Tested

```
POST  /api/v1/symptoms
GET   /api/v1/symptoms?memberId=&from=&to=
```

## Schema Fields

`text`, `severity` (1–10), `photoUrl`, `voiceNoteUrl`, `memberId`, `loggedAt`

## Tasks

1. Run the symptom tests:
   ```bash
   cd famcare-backend && npx jest symptom --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - Create entry with `text` + `severity` → stored correctly with all fields
   - Create with photo → Cloudinary URL stored in `photoUrl`
   - GET returns entries in chronological order (timeline)
   - Severity 0 or 11 → rejected with HTTP 400
   - Voice note upload → URL stored in `voiceNoteUrl`
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest symptom --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Create entry with text + severity → stored correctly
- Create with photo → Cloudinary URL stored
- GET returns chronological timeline
- Severity 0 or 11 → 400
- Voice note upload → URL stored
