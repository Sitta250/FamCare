# Feature 5: Token and Latency Telemetry

> **Implementation order: 2 (implement alongside Feature 4)**

---

## 1. Goal Summary

After every LLM call (success or failure), emit a single structured JSON log line to stdout:

```
[aiService:telemetry] {"provider":"gemini","intent":"log_medication","durationMs":430,"inputTokens":312,"outputTokens":47,"success":true,"lineUserId":"U123","familyMemberId":"mem1"}
```

No external SDKs. Stdout only. Works with Railway log drain out of the box.

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/src/services/aiService.js` | Only file changed — add timing + token capture around LLM calls |

No route, schema, or handler changes needed.

---

## 3. Data Model Changes

None.

---

## 4. API Changes

`handleAiMessage(userMessage, user, familyMembers)` gains two additional parameters passed through internally:

```js
// Internal signature used for telemetry context
handleAiMessage(userMessage, user, familyMembers)
// user.id → lineUserId resolved via user.lineUserId for the log
```

The **external signature is unchanged**. `lineUserId` is available from `user.lineUserId`. `familyMemberId` is resolved after intent execution.

---

## 5. Frontend Changes

None.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| `inputTokens` not in Gemini response | Log `null` — do not throw |
| `outputTokens` not in Gemini response | Log `null` — do not throw |
| LLM call throws before any response | `durationMs` is still measured; `inputTokens`/`outputTokens` = `null`; `success: false` |
| `intent` JSON parse fails | `intent` field = `null` in log; `success: false` |
| DeepSeek returns `usage.prompt_tokens` | Read `response.usage?.prompt_tokens` and `response.usage?.completion_tokens` |
| `familyMemberId` not resolved | Log `null` |

---

## 7. Implementation Tasks

### Task 5-A: Add `logTelemetry()` Helper to `aiService.js`

**Purpose:** Create a pure function that formats and emits the telemetry JSON line. Keeping it isolated makes it unit-testable without mocking `console.log`.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** None (can be developed in parallel with Feature 4)

**Implementation:**

```js
function logTelemetry({ provider, intent, durationMs, inputTokens, outputTokens, success, lineUserId, familyMemberId }) {
  const entry = { provider, intent: intent ?? null, durationMs, inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null, success, lineUserId, familyMemberId: familyMemberId ?? null }
  console.log(`[aiService:telemetry] ${JSON.stringify(entry)}`)
}
```

**Acceptance criteria:**
- `logTelemetry({...})` emits exactly one line starting with `[aiService:telemetry] `
- The line is valid JSON (parseable with `JSON.parse`)
- All 8 required fields are present in the output
- Missing numeric fields appear as `null`, not `undefined`

**Tests to add:**
`famcare-backend/src/tests/aiService_telemetry.test.js`

Test cases:
1. `logTelemetry` with all fields → output contains all 8 keys
2. `logTelemetry` with `inputTokens: undefined` → output has `"inputTokens":null`
3. `logTelemetry` with `familyMemberId: undefined` → output has `"familyMemberId":null`
4. Output is parseable JSON (no trailing text, no prefix in the JSON itself)

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_telemetry
```

**Constraints:**
- Do NOT import any third-party logging library
- `logTelemetry` must never throw — wrap in try/catch internally

**Risks:** None significant.

---

### Task 5-B: Capture Timing and Token Counts from Gemini and DeepSeek

**Purpose:** Instrument `callGemini()` and `callDeepSeek()` (from Feature 4) to return token counts alongside the raw text, so `callLLMWithFailover` can surface them.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 4-B must exist (callGemini/callDeepSeek are defined)

**Token extraction:**

Gemini (`@google/generative-ai`):
```js
const result = await model.generateContent(prompt)
const inputTokens = result?.response?.usageMetadata?.promptTokenCount ?? null
const outputTokens = result?.response?.usageMetadata?.candidatesTokenCount ?? null
const raw = result?.response?.text()?.trim() ?? ''
return { raw, inputTokens, outputTokens }
```

DeepSeek (OpenAI-compatible):
```js
const response = await openaiClient.chat.completions.create({...})
const inputTokens = response.usage?.prompt_tokens ?? null
const outputTokens = response.usage?.completion_tokens ?? null
const raw = response.choices[0]?.message?.content?.trim() ?? ''
return { raw, inputTokens, outputTokens }
```

`callLLMWithFailover` now returns `{ raw, provider, inputTokens, outputTokens }`.

**Acceptance criteria:**
- `callLLMWithFailover` return object contains `inputTokens` and `outputTokens` fields
- Fields are `null` (not `undefined`) when unavailable
- Token fields are numbers when available (not strings)

**Tests to add:** (extend `aiService_failover.test.js` or `aiService_telemetry.test.js`)

Test cases:
5. Gemini mock returns `usageMetadata.promptTokenCount = 100` → `inputTokens = 100` in result
6. Gemini mock with no `usageMetadata` → `inputTokens = null` in result
7. DeepSeek mock returns `usage.prompt_tokens = 80` → `inputTokens = 80` in result

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService
```

**Risks:**
- Gemini SDK response shape may change — always use optional chaining (`?.`)
- DeepSeek `usage` may be absent if streaming is accidentally enabled — ensure `stream: false` (default)

---

### Task 5-C: Emit Telemetry Line from `handleAiMessage`

**Purpose:** Capture wall-clock time around the LLM call and emit `logTelemetry()` after every call (success or failure).

**Files affected:**
- `famcare-backend/src/services/aiService.js` — update `handleAiMessage()`

**Dependencies:** Tasks 5-A, 5-B, 4-C

**Key change in `handleAiMessage`:**

```js
const start = Date.now()
let provider = 'fallback', inputTokens = null, outputTokens = null, intentStr = null, success = false
try {
  const result = await callLLMWithFailover(prompt)
  provider = result.provider
  inputTokens = result.inputTokens
  outputTokens = result.outputTokens
  const intent = parseIntentJson(result.raw)
  intentStr = intent?.intent ?? null
  success = !!intent
  if (!intent) { ... return FALLBACK_TEXT }
  const reply = await executeIntent(intent, user.id, familyMembers)
  return reply
} catch (err) {
  ...
} finally {
  logTelemetry({
    provider, intent: intentStr,
    durationMs: Date.now() - start,
    inputTokens, outputTokens, success,
    lineUserId: user.lineUserId,
    familyMemberId: intent?.familyMemberId ?? null,
  })
}
```

Use `finally` so telemetry is always emitted regardless of throw path.

**Acceptance criteria:**
- `[aiService:telemetry]` line emitted on every call to `handleAiMessage`, including error paths
- `durationMs` is a positive integer
- `success: true` only when a valid intent JSON was parsed AND `executeIntent` returned without throwing
- `success: false` when JSON parse fails or LLM throws
- `lineUserId` matches `user.lineUserId` (not `user.id`)

**Tests to add:** (extend `aiService_telemetry.test.js`)

Test cases:
8. Successful Gemini call → telemetry line with `success: true`, `provider: 'gemini'`, `durationMs > 0`
9. JSON parse failure → telemetry with `success: false`, `intent: null`
10. Gemini throws → telemetry with `success: false`, `provider: 'fallback'`
11. `lineUserId` in telemetry matches `user.lineUserId` (not internal `user.id`)

**Verification:**
```bash
cd famcare-backend && npm test
```

**Risks:**
- `familyMemberId` may not be known at `finally` time if parsing failed — use `intent?.familyMemberId ?? null`; `intent` must be in-scope in `finally`

---

## 8. Safe Implementation Order

```
5-A (logTelemetry helper + tests) → 5-B (token capture, depends on 4-B) → 5-C (wire into handleAiMessage, depends on 4-C)
```

Task 5-A can start immediately (no Feature 4 dependency). Task 5-B requires Feature 4's provider functions to exist.

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| Gemini SDK field name for token counts may differ across SDK versions | Always use `?.` chaining; log `null` on miss; add a unit test with the actual field name |
| `finally` block runs even if `executeIntent` throws | `success` flag must be set to `true` only after `executeIntent` resolves successfully — set it just before the return, not before executeIntent call |
| Multiple concurrent messages → log lines interleaved but each is complete JSON | `console.log` is synchronous — each line is atomic on Node.js single thread |
