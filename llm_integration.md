# FamCare LLM Integration Roadmap

> **Audience:** Claude Code / Codex agents. Read this file fully before planning any implementation task. Each section is self-contained. Do not infer missing details — follow what is written exactly.

---

## Current State

The LLM integration is functional at a basic level:

- LINE text messages are routed through `aiService.js` which calls Gemini to extract a structured intent JSON, then executes the matching backend service function.
- 9 intent types are supported: `add_appointment`, `list_appointments`, `log_medication`, `list_medications`, `log_health_metric`, `list_health_metrics`, `log_symptom`, `list_symptoms`, `chat`.
- Postback actions (from Rich Menu buttons) are handled deterministically in `handler.js` and are not affected by this roadmap.
- There is currently only one LLM provider: `gemini-2.0-flash` via `@google/generative-ai`. There is no retry logic and no fallback provider.
- Each message is processed statelessly. No conversation history is stored or sent to the model.

---

## Feature 1: Conversation Memory (Per User, Per Elder)

### What it does
Each LINE user can manage health data for multiple elders (family members). Currently every message is sent to Gemini with zero context from prior turns. This means multi-turn conversations break — if a user says "นัดหมอ" and then "พรุ่งนี้ 10 โมง" as two separate messages, the second message has no context and will fail to resolve correctly.

Conversation memory stores the last N message pairs (user message + bot reply) and includes them in every Gemini prompt. Memory is scoped per LINE user AND per elder. This means if a user switches from talking about their mother to their father, the context resets to the correct elder's history — it does not bleed across elders.

### How memory scoping works
- When an intent is resolved and a `familyMemberId` is identified (either explicitly or via auto-selection), that elder becomes the active scope for this message.
- Memory is keyed as `lineUserId:familyMemberId`.
- If a message cannot resolve a `familyMemberId` (e.g. pure `chat` intent), use the most recently active elder for that user as the scope. If no prior elder exists, store under a generic key `lineUserId:none`.

### Storage
- Store conversation history in the existing PostgreSQL database via Prisma.
- Create a new model `ConversationMessage` with fields: `id`, `lineUserId`, `familyMemberId` (nullable), `role` (enum: `USER` / `BOT`), `content` (text), `createdAt`.
- On every text message: load the last 10 messages for the resolved scope, append current exchange after the reply is sent.
- Hard cap: keep only the last 10 message pairs (20 rows) per scope. Delete oldest when inserting beyond cap.

### Prompt injection
- Inject history as a `Conversation so far:` block at the top of the intent extraction prompt, formatted as alternating `User:` / `Bot:` lines.
- If no history exists, omit the block entirely.

### Access control note
- Conversation history belongs to the LINE user who sent the messages. CAREGIVERs and VIEWERs have their own separate memory scopes. Do not share memory across users even if they manage the same elder.

---

## Feature 2: Ambiguity Resolution via LINE Quick Reply

### What it does
When the extracted intent is valid but a required field cannot be resolved, the bot must ask the user to clarify before executing any action. It does this using LINE Quick Reply buttons, which appear as tappable chips above the keyboard — not as plain text options.

### When to trigger ambiguity resolution
Trigger when ALL of the following are true:
- The intent requires a `familyMemberId`.
- The user has more than one family member.
- Gemini returned `familyMemberId: null` (could not infer from message).

Do not trigger if the user has exactly one family member — auto-select that member silently.

### Flow
1. Bot sends a LINE message with text "ข้อมูลนี้เกี่ยวกับใครครับ?" and Quick Reply items — one button per family member, labeled with their name.
2. Each Quick Reply item sends a postback event with data: `{"action":"resolve_member","familyMemberId":"<id>","pendingIntent":<original intent JSON as string>}`.
3. The postback handler receives this, extracts `pendingIntent`, re-runs `executeIntent()` with the resolved `familyMemberId` injected, and replies with the result.
4. `pendingIntent` must be URL-encoded or escaped to fit LINE's postback data size limit (300 bytes). If the pending intent JSON exceeds safe size, truncate non-essential fields (note, reason) before encoding.

### Scope
Only `familyMemberId` ambiguity is handled this way. Do not build generic ambiguity resolution for other fields (e.g. unclear medication name). For other unclear fields, return a plain Thai error message asking the user to be more specific.

---

## Feature 3: Confirmation for Destructive Actions

### What it does
Actions that modify or delete existing records must ask the user to confirm before executing. This prevents accidental data loss from a misunderstood message.

### Which intents require confirmation
- Any intent that maps to an update or delete operation. Based on current intent coverage:
  - `delete_appointment` (when added)
  - `delete_medication` (when added)
  - `delete_symptom` (when added)
  - `update_appointment` with field changes (when added)
- Read and create operations do NOT require confirmation.
- `log_medication` (TAKEN/MISSED/SKIPPED) does NOT require confirmation — it is append-only logging, not destructive.

### Flow
1. Gemini extracts a destructive intent. Before calling the service, the bot sends a LINE Flex Message with:
   - A summary of what will be changed or deleted (e.g. "ลบนัดหมาย 'นัดหมอ' วันที่ 1 พ.ค. 2569?").
   - Two buttons: "ยืนยัน" (confirm) and "ยกเลิก" (cancel).
2. Each button sends a postback:
   - Confirm: `{"action":"confirm_destructive","pendingIntent":<intent JSON>}`
   - Cancel: `{"action":"cancel_destructive"}`
3. On confirm postback: execute the service call, reply with success message.
4. On cancel postback: reply "ยกเลิกแล้วครับ" and do nothing.
5. Pending intent must be stored server-side (in `ConversationMessage` or a dedicated `PendingAction` Prisma model) keyed by `lineUserId`, not passed entirely through LINE postback data, because Flex Message button postback data has a 300 byte limit and full intent JSON may exceed it.

---

## Feature 4: LLM Provider Failover (Gemini → DeepSeek)

### Current state
Only Gemini (`gemini-2.0-flash`) is used. There is no retry logic and no fallback. If the Gemini API is unavailable, the user receives the Thai error message immediately.

### What to implement
A two-stage failover:

**Stage 1 — Gemini with single retry:**
- Call Gemini once.
- If it throws any error (network, 5xx, timeout), wait 1 second and call Gemini once more.
- If the second attempt also fails, move to Stage 2.
- Do not retry on 4xx errors (bad API key, quota exhausted) — go directly to Stage 2.

**Stage 2 — DeepSeek fallback:**
- Call DeepSeek using the same prompt that was sent to Gemini.
- DeepSeek API is OpenAI-compatible. Use the `openai` npm package pointed at DeepSeek's base URL (`https://api.deepseek.com/v1`) with `DEEPSEEK_API_KEY` from env.
- Model: `deepseek-chat`.
- If DeepSeek also fails, return the Thai fallback message to the user.

### Environment variables to add
- `DEEPSEEK_API_KEY` — required for fallback. If not set, skip Stage 2 and return fallback message directly after Gemini retries fail.

### Logging
- Log which provider ultimately served the response: `[aiService] provider=gemini` or `[aiService] provider=deepseek` or `[aiService] provider=fallback`.
- Log Gemini failure reason before switching.

### Prompt compatibility
- The intent extraction prompt does not need to change. Both providers receive identical prompt text.
- Parse the response from DeepSeek the same way as Gemini (strip markdown fences, JSON.parse).

---

## Feature 5: Token and Latency Telemetry

### What it does
Currently there is no visibility into how long Gemini calls take, how many tokens are used per message, or how often failures occur. This makes it impossible to monitor cost or performance before and after going to production.

### What to log on every LLM call
Log a single structured JSON line to stdout after each call completes (success or failure):

```
[aiService:telemetry] {"provider":"gemini","intent":"log_medication","durationMs":430,"inputTokens":312,"outputTokens":47,"success":true,"lineUserId":"U123","familyMemberId":"mem1"}
```

Fields:
- `provider` — which model served the request (`gemini`, `deepseek`, `fallback`)
- `intent` — the resolved intent string (or `null` if JSON parse failed)
- `durationMs` — wall clock time from start of LLM call to response parsed
- `inputTokens` — token count from API response metadata if available; `null` if not provided
- `outputTokens` — same
- `success` — whether a valid intent JSON was returned
- `lineUserId` — passed in from handler, for correlation
- `familyMemberId` — resolved member or `null`

### How to get token counts
- Gemini: `result.response.usageMetadata.promptTokenCount` and `candidatesTokenCount`
- DeepSeek (OpenAI-compatible): `response.usage.prompt_tokens` and `completion_tokens`
- If the field is missing, log `null` — do not throw.

### No external service required
Write to stdout only. Do not add any third-party analytics SDK. Structured logs can be ingested by Railway's log drain or any external log aggregator later without code changes.

---

## Feature 6: Rate Limiting Per LINE User Per Day

### What it does
Prevents a single LINE user from making unlimited Gemini calls in a day. This protects against runaway API costs and accidental infinite loops from test accounts.

### Limit
- **50 AI-processed messages per LINE user per calendar day (Bangkok timezone).**
- This is sufficient for a caregiver actively tracking an elderly parent throughout the day with reasonable margin. A typical active day involves checking medications (3x), logging health metrics (2x), adding or checking appointments (2x), and general questions — well under 50.

### What counts toward the limit
- Every text message that reaches `handleAiMessage()` counts as one use.
- Postback actions (Rich Menu buttons, confirmation buttons) do NOT count — they are deterministic and do not call the LLM.
- Audio messages do NOT count.

### Storage
- Store counts in PostgreSQL. Create a new Prisma model `AiUsageLog` with fields: `id`, `lineUserId`, `date` (String, format `YYYY-MM-DD` in Bangkok timezone), `count` (Int). Unique constraint on `(lineUserId, date)`.
- On each message: upsert the row for today, increment count. If count before increment is already >= 50, reject the message before calling Gemini.

### User-facing behavior when limit is hit
Reply with:
```
ขออภัย วันนี้ใช้ FamCare AI ครบ 50 ครั้งแล้ว กรุณาลองใหม่พรุ่งนี้ครับ
```
Do not call Gemini at all once the limit is reached.

---

## Feature 7: Prompt Guardrails and Output Validation

### What it does
Gemini can return malformed JSON, hallucinated field values, or intent types that do not exist in the system. Without validation, these reach `executeIntent()` and cause silent failures or incorrect database writes.

### Validation rules to enforce before executing any intent

**Structural:**
- Response must parse as valid JSON object.
- `intent` field must be one of the known intent strings. Reject anything else.
- No extra top-level keys that don't belong to the intent's schema should cause a crash — ignore them silently.

**Field-level:**
- `familyMemberId`: if present and not null, must exist in the `familyMembers` array passed to `handleAiMessage`. If it doesn't match, set to null and trigger ambiguity resolution.
- `status` for `log_medication`: must be one of `TAKEN`, `MISSED`, `SKIPPED`. If invalid, default to `TAKEN` and log a warning.
- `type` for `log_health_metric`: must be one of `BLOOD_PRESSURE`, `BLOOD_SUGAR`, `WEIGHT`, `TEMPERATURE`, `CUSTOM`. If invalid, default to `CUSTOM`.
- `value` for `log_health_metric`: must be a finite number. If missing or NaN, reject the intent and reply asking the user to provide a numeric value.
- `severity` for `log_symptom`: must be integer 1–10. If out of range, clamp to nearest valid value (1 or 10). If missing, default to 1.
- `appointmentAt`: if present, must parse as a valid ISO 8601 date. If invalid, set to null and reply asking for the date.

**Content guardrail:**
- If the `chat` intent reply contains any of the following, replace with the Thai fallback message: SQL-like strings (`SELECT`, `DROP`, `INSERT`), code blocks (triple backtick), URLs not from a known safe domain.
- Do not attempt to moderate Thai medical content — this is a health app and clinical language is expected.

### On validation failure
- Log the raw Gemini output at warn level.
- Either apply the default/clamp as described above, or return a specific Thai message asking the user to clarify.
- Never throw an unhandled error from a validation failure.

---

## Feature 8: Intent Coverage Expansion — Documents and Insurance

### What it does
Currently documents and insurance records are only accessible via the REST API (iOS app). Users cannot query, add, or delete them through the LINE chat. This feature adds full CRUD intent coverage for both.

### New intents to add

**Documents:**
- `list_documents` — list documents for a family member, optionally filtered by type or keyword
- `get_document` — describe a specific document by name or keyword
- `delete_document` — delete a document by name (requires confirmation flow from Feature 3)

Note: `create_document` via chat is not practical because it requires a file upload. If a user asks to add a document, reply telling them to use the app to upload files.

**Insurance:**
- `list_insurance` — list insurance cards for a family member
- `get_insurance` — get details of a specific insurance card (provider, expiry, policy number)
- `update_insurance` — update fields on an existing card (expiry date, policy number, provider name)
- `delete_insurance` — delete an insurance card (requires confirmation flow from Feature 3)

Note: `create_insurance` via chat is not practical (requires photo upload). Same response as documents.

### Prompt additions
Add all new intent schemas to the intent extraction prompt in `aiService.js` following the same pattern as existing intents. Each schema must include `familyMemberId` and all fields the service function requires.

### Access control
Apply the same access control as the REST routes: OWNER and CAREGIVER can write, VIEWER can only read. Check the user's role against the family member before executing any write intent. Return a Thai permission-denied message if the role is insufficient.

---

## Feature 9: User Onboarding Flow for New Users

### What it does
A new LINE user who has just followed the bot has no family members in the system. Any intent that requires a `familyMemberId` will fail with a dead-end response. The onboarding flow handles this gracefully.

### Trigger condition
Before running intent extraction, check if `familyMembers` array is empty. If it is, skip Gemini entirely and run the onboarding flow.

### Onboarding options
Present the user with two LINE Quick Reply buttons:

**Option A — Add via chat:**
Button label: "เพิ่มสมาชิกตอนนี้"
Postback: `{"action":"onboard_start"}`

Flow:
1. Bot asks for the elder's name: "ชื่อสมาชิกที่ต้องการดูแลคือใครครับ?"
2. User replies with a name (plain text).
3. Bot stores the name in a `PendingOnboarding` state (Prisma model or in `ConversationMessage` as a special role).
4. Bot asks for date of birth: "เกิดวันที่เท่าไหร่ครับ? (ตัวอย่าง: 15 มีนาคม 2500)"
5. User replies. Bot parses the date using existing Thai date parsing logic.
6. Bot calls `createFamilyMember(userId, { name, dateOfBirth })` and confirms: "✅ เพิ่ม [ชื่อ] เรียบร้อยแล้ว ตอนนี้คุณสามารถเริ่มบันทึกข้อมูลสุขภาพได้เลยครับ"

**Option B — Use the app:**
Button label: "เปิดแอป FamCare"
Postback: `{"action":"onboard_app"}`

Reply: "กรุณาเปิดแอป FamCare เพื่อเพิ่มสมาชิกในครอบครัว หลังจากนั้นกลับมาคุยกับบอทได้เลยครับ"

### State management for Option A
- Use a dedicated Prisma model `OnboardingSession` with fields: `lineUserId`, `step` (enum: `AWAITING_NAME` / `AWAITING_DOB`), `name` (nullable String), `createdAt`, `updatedAt`.
- Check for an active `OnboardingSession` at the top of `handleTextMessage`, before any other processing. If one exists, route to the onboarding handler instead of `handleAiMessage`.
- Delete the session after successful member creation.
- If the user abandons (no activity for 10 minutes), delete the session silently on next message and restart from the two-button prompt.

---

## Implementation Order

Implement features in this order. Each feature should be fully implemented and tested before starting the next.

1. Feature 4 (Failover) — foundational, affects all subsequent features
2. Feature 5 (Telemetry) — add alongside failover
3. Feature 6 (Rate Limiting) — protects against cost before any other expansion
4. Feature 7 (Guardrails) — makes intent pipeline reliable before expanding it
5. Feature 1 (Conversation Memory) — requires Prisma migration, do after pipeline is stable
6. Feature 2 (Ambiguity Resolution) — depends on stable intent pipeline
7. Feature 3 (Confirmation for Destructive Actions) — depends on Feature 2 patterns
8. Feature 8 (Intent Coverage Expansion) — add after core pipeline is hardened
9. Feature 9 (Onboarding) — last, depends on all prior features being stable

---

## Environment Variables Summary

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes (existing) | Primary LLM provider |
| `DEEPSEEK_API_KEY` | No | Fallback LLM provider. If absent, skip DeepSeek and return Thai error after Gemini retries fail |
| `LINE_CHANNEL_SECRET` | Yes (existing) | Webhook signature verification |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes (existing) | Reply and push messages |

---

## Prisma Models to Add

The following new models are required across features. Add them in a single migration if implementing multiple features at once, or per-feature if implementing sequentially.

```
ConversationMessage   — Feature 1 (memory)
PendingAction         — Feature 3 (destructive confirmation)
AiUsageLog            — Feature 6 (rate limiting)
OnboardingSession     — Feature 9 (onboarding)
```

Each model's fields are described in the relevant feature section above.