# LLM Phase 2 — Intent-Based Actions — Codex Task

## Status
IMPLEMENT

## Prerequisite
Task `01-llm-phase1-gemini.md` must be completed first. Gemini must be integrated into the webhook handler before upgrading it here.

## Goal
Upgrade the Gemini webhook integration so that natural language from the user triggers real backend actions. Send the user message to Gemini with a structured prompt asking it to return JSON with an intent + extracted fields. Parse the JSON and call the matching service. Send a Thai confirmation back. If intent is UNKNOWN or JSON parsing fails, fall back to conversational Gemini reply.

## Intent Map

| User says (example) | Intent | Action |
|---------------------|--------|--------|
| "นัดหมอพรุ่งนี้ 10 โมง" | CREATE_APPOINTMENT | `appointmentService.createAppointment` |
| "กินยาแล้ว" | CONFIRM_DOSE | `medicationService.confirmDose` |
| "ปวดหัวนิดหน่อย" | LOG_SYMPTOM | `symptomService.createSymptomLog` |
| "ยาเหลือน้อยแล้ว" | REFILL_CHECK | `medicationService.refillCheck` |
| "แสดงนัดหมอ" | LIST_APPOINTMENTS | `appointmentService.listAppointments` |
| (anything else) | UNKNOWN | Fall back to conversational Gemini reply |

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/webhook/handler.js` | Upgrade the Gemini call here |
| `famcare-backend/src/services/appointmentService.js` | `createAppointment`, `listAppointments` |
| `famcare-backend/src/services/medicationService.js` | `confirmDose`, `refillCheck` |
| `famcare-backend/src/services/symptomLogService.js` | `createSymptomLog` |
| `famcare-backend/src/utils/datetime.js` | Use `utcInstantFromBangkokYmdHm` to parse Thai date strings |

## Tasks

1. Open `famcare-backend/src/webhook/handler.js`.
2. Replace the current single Gemini call with a two-step approach:

   **Step A — Intent detection prompt:**
   ```
   System: You are FamCare intent parser. Given a Thai or English user message, respond ONLY with valid JSON in this format:
   { "intent": "CREATE_APPOINTMENT|CONFIRM_DOSE|LOG_SYMPTOM|REFILL_CHECK|LIST_APPOINTMENTS|UNKNOWN", "data": { ...extracted fields } }

   For CREATE_APPOINTMENT extract: { "datetime": "YYYY-MM-DD HH:MM", "doctor": "...", "hospital": "...", "reason": "..." }
   For CONFIRM_DOSE extract: { "medicationName": "..." } (or empty if unclear)
   For LOG_SYMPTOM extract: { "text": "...", "severity": 1-10 }
   For others: data can be empty {}
   Respond with JSON only, no explanation.
   ```

3. Parse the JSON response with `JSON.parse()` wrapped in try/catch.

4. Based on `intent`, call the matching service and send a Thai confirmation message back to the user via LINE reply.

5. If `intent === 'UNKNOWN'`, `JSON.parse()` throws, or the service call fails → fall back to the Phase 1 conversational Gemini call (send original message to Gemini as normal conversation).

6. Extract `lineUserId` from the event to pass as `addedByUserId` when creating records. The user's `familyMemberId` may need to be looked up from the User table — if no family member is registered, reply with a friendly Thai message asking them to set up a profile first.

7. Run `cd famcare-backend && npm test` — confirm no existing tests broke.

## Test Commands

```bash
cd famcare-backend && npm test
```

Manual verification (requires live Railway + GEMINI_API_KEY):
- Send "นัดหมอ 15 มกราคม บ่าย 2 โมง" → appointment created with correct datetime
- Send "กินยาแล้ว" → DoseLog created for today
- Send "ปวดหัว ระดับ 3" → SymptomLog created with severity 3
- Send an unrecognized message → conversational reply, no crash
- Force Gemini to return malformed JSON (temporarily break prompt) → fallback to conversation, no crash

## Pass Criteria

- "นัดหมอ 15 มกราคม บ่าย 2 โมง" → appointment created with correct datetime
- "กินยาแล้ว" → DoseLog created for today
- "ปวดหัว ระดับ 3" → SymptomLog created with severity 3
- Unknown message → conversational reply, no crash
- Gemini returns malformed JSON → fallback to conversation, no crash
