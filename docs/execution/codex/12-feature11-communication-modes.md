# Feature 11 — Communication Modes — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Communication Modes feature is implemented (webhook handler fan-out to multiple caregivers, private vs. group modes, Thai NLP via Gemini Phase 2, voice message handling). Run the specific test assertions listed below and fix any failures in the implementation. All 5 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/webhook/handler.js` | Fan-out logic, mode routing |
| `famcare-backend/src/services/caregiverNotifyService.js` | Push notifications to opted-in caregivers |
| `famcare-backend/src/services/linePushService.js` | `sendLinePushToUser` |
| `famcare-backend/src/tests/communication_mode.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | User model with `chatMode` (PRIVATE/GROUP) |

## API Surface Being Tested

```
PATCH /api/v1/me/chat-mode   (set user's chat mode: PRIVATE or GROUP)
```

And the webhook behavior itself (fan-out logic).

## Tasks

1. Run the communication mode tests:
   ```bash
   cd famcare-backend && npx jest communication --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - Private mode: when user A takes an action, user B (a caregiver) does NOT receive a notification
   - Group fan-out: a missed dose triggers LINE push to ALL opted-in caregivers (not just owner)
   - Thai text parsing: "นัดหมอ 15 มกราคม บ่าย 2 โมง" → correct appointment datetime (Bangkok → UTC)
   - Voice message → audio URL stored on the correct record (SymptomLog or appropriate model)
   - Unknown intent → conversational reply sent back, no crash or unhandled error
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest communication --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Private mode: action by user A does not notify user B
- Group fan-out: missed dose → all opted-in caregivers receive push
- Thai text: "นัดหมอ 15 มกราคม บ่าย 2 โมง" → correct appointment datetime
- Voice message → audio URL stored on correct record
- Unknown intent → conversational reply, not error
