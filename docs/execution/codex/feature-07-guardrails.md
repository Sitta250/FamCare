# Feature 7: Prompt Guardrails and Output Validation

> **Implementation order: 4**

---

## 1. Goal Summary

Validate every intent JSON returned by the LLM before calling `executeIntent()`. Apply field-level validation, enum checks, clamping, and content guardrails. Never throw an unhandled error from validation failure. Log raw model output at warn level when validation fails.

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/src/services/aiService.js` | Add `validateIntent()` function; call it between `parseIntentJson()` and `executeIntent()` |

No schema, route, or handler changes.

---

## 3. Data Model Changes

None.

---

## 4. API Changes

None. `handleAiMessage` signature unchanged. Validation is internal.

---

## 5. Frontend Changes

None. Validation failures produce Thai-language error strings returned to LINE.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| Unknown intent string | Return Thai "ไม่เข้าใจคำสั่ง" message — do not call `executeIntent` |
| `familyMemberId` in response not in `familyMembers` array | Set to `null` — ambiguity resolution (Feature 2) handles it downstream |
| `status` for `log_medication` is invalid | Default to `TAKEN`, log warning |
| `type` for `log_health_metric` is invalid | Default to `CUSTOM`, log warning |
| `value` for `log_health_metric` is missing or NaN | Return Thai message asking for numeric value |
| `severity` for `log_symptom` out of 1–10 | Clamp to 1 or 10 |
| `severity` missing | Default to `1` |
| `appointmentAt` is invalid ISO 8601 | Set to `null`, return Thai message asking for date |
| `chat` reply contains SQL keywords | Replace with Thai fallback |
| `chat` reply contains triple backtick | Replace with Thai fallback |
| Extra unknown fields in intent JSON | Ignore silently |
| Structural: valid JSON but not an object | Treat as parse failure |

---

## 7. Implementation Tasks

### Task 7-A: Implement `validateIntent(intent, familyMembers)` — Structural + Field Validation

**Purpose:** Create a pure function that takes the parsed intent object and the available family members, applies all validation rules from the spec, and returns `{ valid: true, intent }` or `{ valid: false, replyText: string }`.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** None (can be written before Features 4–6 if desired, but wire-up is after)

**Known intents (for structural check):**
```js
const KNOWN_INTENTS = new Set([
  'add_appointment','list_appointments','log_medication','list_medications',
  'log_health_metric','list_health_metrics','log_symptom','list_symptoms','chat'
])
```

**Validation rules (per spec):**

```
Structural:
  - typeof intent !== 'object' || intent === null → invalid
  - !KNOWN_INTENTS.has(intent.intent) → invalid, return Thai message

Field-level (mutate intent in place, or return corrected copy):
  - familyMemberId: if present + not null + not in familyMembers → set null
  - log_medication.status: if not in {TAKEN,MISSED,SKIPPED} → set 'TAKEN', warn
  - log_health_metric.type: if not in {BLOOD_PRESSURE,...,CUSTOM} → set 'CUSTOM', warn
  - log_health_metric.value: if not finite number → return { valid:false, replyText: Thai msg }
  - log_symptom.severity: if missing → 1; if < 1 → 1; if > 10 → 10
  - add_appointment.appointmentAt: if present + not parseable ISO → set null, return { valid:false, replyText: Thai date msg }

Content guardrail (chat intent only):
  - reply contains /SELECT|DROP|INSERT/i → replace with FALLBACK_TEXT
  - reply contains triple backtick → replace with FALLBACK_TEXT
  - reply contains URL not matching known safe domains → replace with FALLBACK_TEXT
    (Assumption: "known safe domain" = no URLs allowed since none are defined in spec. Any URL = replacement.)
```

Returns `{ valid: true, intent: correctedIntent }` or `{ valid: false, replyText: string }`.

**Acceptance criteria:**
- Unknown intent string → `valid: false`, `replyText` contains Thai error
- Valid intent, all fields valid → `valid: true`, `intent` returned (possibly mutated)
- `familyMemberId` not in array → set to null, still `valid: true`
- Invalid `log_medication.status` → defaulted to `TAKEN`, `valid: true`
- Invalid `log_health_metric.value` (NaN/missing) → `valid: false`
- `log_symptom.severity = 15` → clamped to 10, `valid: true`
- `chat` with SQL keywords → `valid: true` but `intent.reply` replaced with FALLBACK_TEXT
- Extra unknown fields → ignored, `valid: true`

**Tests to add:**
`famcare-backend/src/tests/aiService_guardrails.test.js`

Test cases (all unit-level, no HTTP):
1. `intent.intent = 'unknown_action'` → `valid: false`
2. `intent.intent = 'log_medication'`, `status = 'INVALID'` → `valid: true`, `intent.status = 'TAKEN'`
3. `intent.intent = 'log_health_metric'`, `value = NaN` → `valid: false`
4. `intent.intent = 'log_health_metric'`, `value = null` → `valid: false`
5. `intent.intent = 'log_health_metric'`, `value = 120` → `valid: true`
6. `intent.intent = 'log_health_metric'`, `type = 'INVALID'` → `valid: true`, `intent.type = 'CUSTOM'`
7. `intent.intent = 'log_symptom'`, `severity = 15` → `valid: true`, `intent.severity = 10`
8. `intent.intent = 'log_symptom'`, `severity = -1` → `valid: true`, `intent.severity = 1`
9. `intent.intent = 'log_symptom'`, `severity = null` → `valid: true`, `intent.severity = 1`
10. `intent.intent = 'add_appointment'`, `appointmentAt = 'not-a-date'` → `valid: false`
11. `intent.intent = 'add_appointment'`, `appointmentAt = null` → `valid: true`
12. `familyMemberId = 'nonexistent-id'` with `familyMembers = [{id:'abc'}]` → `intent.familyMemberId = null`
13. `intent.intent = 'chat'`, `reply = 'SELECT * FROM users'` → `valid: true`, `intent.reply = FALLBACK_TEXT`
14. `intent.intent = 'chat'`, `reply = '```code```'` → `valid: true`, `intent.reply = FALLBACK_TEXT`
15. `intent.intent = 'chat'`, `reply = 'check https://example.com'` → `valid: true`, `intent.reply = FALLBACK_TEXT`
16. Extra field `intent.extraField = 'value'` → `valid: true`, extra field ignored

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_guardrails
```

**Constraints:**
- `validateIntent` must be a pure function (no Prisma calls, no side effects except `console.warn`)
- Mutate a copy of `intent` (spread) rather than the original to avoid spooky action at a distance

**Risks:**
- ISO 8601 validation: `new Date(str).toString() !== 'Invalid Date'` is sufficient but may accept some edge-case strings. Use this approach for simplicity.
- URL detection regex must be simple; Thai medical content should not be filtered.

---

### Task 7-B: Wire `validateIntent` into `handleAiMessage`

**Purpose:** Insert the validation call between `parseIntentJson()` and `executeIntent()`. If validation fails, log the raw output and return the validation error reply.

**Files affected:**
- `famcare-backend/src/services/aiService.js` — update `handleAiMessage()`

**Dependencies:** Task 7-A

**Key change:**
```js
const intent = parseIntentJson(raw)
if (!intent) {
  console.warn('[aiService] failed to parse intent JSON:', raw)
  return FALLBACK_TEXT
}

const validation = validateIntent(intent, familyMembers)
if (!validation.valid) {
  console.warn('[aiService] intent validation failed:', raw)
  return validation.replyText
}

return await executeIntent(validation.intent, user.id, familyMembers)
```

**Acceptance criteria:**
- When `validateIntent` returns `{ valid: false }`, `validation.replyText` is returned to user
- `console.warn` called with raw LLM output on validation failure
- When `validateIntent` returns `{ valid: true }`, `executeIntent` called with the corrected intent
- No unhandled errors thrown from validation path

**Tests to add:** (extend `aiService_guardrails.test.js` with integration-style tests)

Test cases:
17. `handleAiMessage` with mocked Gemini returning `{intent:'unknown_intent'}` → returns Thai error message, `executeIntent` not called
18. `handleAiMessage` with mocked Gemini returning `{intent:'log_medication', status:'WRONG'}` → `executeIntent` called with `status:'TAKEN'`
19. `handleAiMessage` with mocked Gemini returning `{intent:'log_health_metric', value: NaN}` → returns Thai error message

**Verification:**
```bash
cd famcare-backend && npm test
```

**Risks:** `validateIntent` returns a mutated copy of intent — ensure `executeIntent` receives `validation.intent`, not the original `intent` variable.

---

## 8. Safe Implementation Order

```
7-A (validateIntent pure function + tests) → 7-B (wire into handleAiMessage)
```

Task 7-A can start independently of Features 4–6 but 7-B must come after Features 4–6 are wired into `handleAiMessage`.

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| `appointmentAt` validation: some valid ISO strings might fail edge cases | Use `!isNaN(new Date(str).getTime())` — covers all valid ISO 8601 |
| "Known safe domain" not defined in spec | Assumption: reject all URLs. If domain whitelist needed later, add to a constant array |
| Guardrail on `chat` reply may accidentally filter Thai medical terms | Spec explicitly says "Do not attempt to moderate Thai medical content" — only filter SQL, triple backtick, URLs |
| `validateIntent` is called before Feature 2 (ambiguity resolution) — the null `familyMemberId` it produces will feed into Feature 2 naturally | This is correct and intended per the spec flow |
