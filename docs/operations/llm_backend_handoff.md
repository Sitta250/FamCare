# FamCare Backend + LLM Integration Handoff

## Purpose
This document is a quick, source-of-truth handoff for another LLM agent to understand:
- what is already implemented in the backend
- how LLM behavior currently works
- what is ready vs. what still needs integration work

## Current Backend State (Implemented)
- Backend stack: Node.js (ESM), Express, Prisma, PostgreSQL, LINE Bot webhook integration.
- API base: `/api/v1` for app routes, `/webhook` for LINE events.
- Core modules implemented and tested:
  - Family members and access control (OWNER/CAREGIVER/VIEWER)
  - Appointments + reminder generation/dispatch
  - Medications (CRUD, logs, schedule, adherence, low-stock reminders)
  - Health metrics
  - Symptom logs (including LINE audio handling)
  - Documents + OCR extraction pipeline
  - Emergency info and insurance cards
  - Pre-appointment report
- Background jobs implemented in `famcare-backend/src/jobs/cron.js`:
  - appointment reminders (every minute)
  - medication reminders and missed-dose alerts (every minute)
  - low-stock checks (daily, Bangkok timezone)
  - insurance expiration reminders (daily, Bangkok timezone)

## Verification Snapshot
- Full backend tests pass using repo runner:
  - `cd famcare-backend && npm test`
  - latest observed: 28 suites / 275 tests passed
- Prisma schema validates:
  - `cd famcare-backend && npm run check`
- Important repo convention: use `npm test` (ESM Jest entrypoint), not plain `npx jest ...`.

## Current LLM Integration (What Exists)
- LLM integration is currently inside `famcare-backend/src/webhook/handler.js`.
- Provider/model:
  - Google Generative AI SDK (`@google/generative-ai`)
  - model currently set to `gemini-2.0-flash`
- Flow for LINE text messages:
  1. receive LINE text event
  2. ensure LINE user exists (`findOrCreateByLineUserId`)
  3. call Gemini with a static system prompt + user text
  4. reply to LINE with generated text
- Failure behavior:
  - if Gemini call fails or key missing, a Thai fallback message is returned
  - webhook never blocks LINE acknowledgement (responds 200 quickly first)

## Current "AI" Scope (Important)
- Existing Gemini usage is chat response generation only.
- There is no tool-calling agent loop, no structured output pipeline, and no action executor driven by LLM intent yet.
- Appointment creation and medication logging via LINE currently use explicit postback actions (deterministic JSON postback), not free-form LLM intent-to-action execution.

## Related Non-Chat AI/OCR
- OCR service exists in `famcare-backend/src/services/ocrService.js`.
- OCR provider supports OpenAI or Google Vision depending on env.
- This OCR pipeline is separate from webhook Gemini chat logic.

## Environment Prerequisites for LLM Path
- Required for webhook LLM responses:
  - `LINE_CHANNEL_SECRET`
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `GEMINI_API_KEY`
- Optional but relevant:
  - `CLOUDINARY_URL` (voice-note upload persistence path)
  - OCR provider settings for document extraction

## Known Gaps for "LLM Integration" Roadmap
- No centralized AI service abstraction (logic is in webhook handler).
- No model routing/failover strategy.
- No conversation state/memory policy beyond LINE event handling.
- No structured intent schema enforced on generated responses.
- No guardrail layer (prompt policy, moderation, output validation).
- No telemetry for model latency/cost/token usage.
- No production-grade retry/backoff/circuit breaker around model API calls.

## Recommended Next Integration Steps
1. Extract Gemini calls from `webhook/handler.js` into a dedicated AI service module.
2. Define structured intent contract (JSON schema) for action-capable messages.
3. Add safe action orchestration:
   - detect intent
   - validate payload
   - run backend service function
   - return user-safe summary response
4. Add observability fields for AI calls (latency, failures, request IDs).
5. Add test coverage for:
   - fallback behavior
   - malformed model output
   - intent-to-action happy path + rejection paths
6. Keep deterministic postback actions as fallback path for high-safety operations.

## Files to Read First (for Any LLM Agent)
- `famcare-backend/src/webhook/handler.js`
- `famcare-backend/src/services/thaiNlpService.js`
- `famcare-backend/src/services/appointmentService.js`
- `famcare-backend/src/services/medicationService.js`
- `famcare-backend/src/jobs/cron.js`
- `famcare-backend/CLAUDE.md`
- `docs/execution/STATUS.md`

## Notes on Doc Drift
- Some `docs/execution/codex/*.md` task files reference stale test commands and outdated surfaces.
- Runtime code and passing tests are the source of truth.
