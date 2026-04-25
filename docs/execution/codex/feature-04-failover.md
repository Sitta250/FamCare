# Feature 4: LLM Provider Failover (Gemini → DeepSeek)

> **Implementation order: 1 (do first — foundational for all other features)**

---

## 1. Goal Summary

Replace the single no-retry Gemini call in `aiService.js` with a two-stage failover pipeline:
- Stage 1: Call Gemini once; on non-4xx failure, retry once after 1 s
- Stage 2: If both Gemini attempts fail, call DeepSeek (`deepseek-chat`) with the identical prompt
- If DeepSeek also fails (or key absent), return the existing Thai fallback message
- Log which provider ultimately served the response

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/src/services/aiService.js` | Only file changed — contains `callGemini()`, `handleAiMessage()` |
| `famcare-backend/.env` / `.env.example` | Add `DEEPSEEK_API_KEY` |
| `famcare-backend/package.json` | Add `openai` npm package |

No changes to `webhook/handler.js`, routes, or schema.

---

## 3. Data Model Changes

None. No schema migration required.

---

## 4. API Changes

None. `handleAiMessage(userMessage, user, familyMembers)` signature is unchanged. Callers are unaffected.

---

## 5. Frontend Changes

None. LINE bot only.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| `GEMINI_API_KEY` not set | Existing `throw new Error('GEMINI_API_KEY is not configured')` — skip to fallback |
| `DEEPSEEK_API_KEY` not set | Skip Stage 2, return Thai fallback after Gemini retries |
| Gemini 4xx (quota/bad key) | Do NOT retry; go directly to Stage 2 |
| DeepSeek returns non-JSON | Same `parseIntentJson()` strip-fence logic applied |
| Retry wait blocked in tests | Use injected `sleepFn` parameter (default `() => new Promise(r => setTimeout(r, 1000))`) |
| Both providers return valid JSON but wrong schema | Guardrail (Feature 7) handles downstream — failover only cares about throw vs. success |

---

## 7. Implementation Tasks

### Task 4-A: Add `openai` Package and `DEEPSEEK_API_KEY` Env

**Purpose:** Install dependency and document new env var before any code changes.

**Files affected:**
- `famcare-backend/package.json` — add `"openai": "^4.x"`
- `famcare-backend/.env.example` — add `DEEPSEEK_API_KEY=`

**Dependencies:** None

**Acceptance criteria:**
- `npm install` succeeds
- `.env.example` contains `DEEPSEEK_API_KEY=` line
- `import OpenAI from 'openai'` resolves without error

**Tests:** None for this task (install only)

**Verification commands:**
```bash
cd famcare-backend && node -e "import('openai').then(() => console.log('ok'))"
```

**Constraints:** Follow CLAUDE.md — "Do not add new npm dependencies without a clear reason." DeepSeek's OpenAI-compatible API justifies the `openai` package here.

**Risks:** `openai` v4 ESM import differs from v3 — confirm default export is `OpenAI` class.

---

### Task 4-B: Extract `callGemini()` into `callLLM(prompt, provider)` with Retry Logic

**Purpose:** Refactor the existing `callGemini()` to support retry on the Gemini path, and add `callDeepSeek()` alongside it. Keep both internal — only `callLLM` is exported.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Schema/services used:** None (pure HTTP to external APIs)

**Dependencies:** Task 4-A (openai package must be installed)

**Key implementation:**

```
// Internal — not exported
async function callGemini(prompt)      // unchanged logic, throws on error
async function callDeepSeek(prompt)    // new: OpenAI client → deepseek-chat at deepseek base URL
async function callLLMWithFailover(prompt, sleepFn)  // orchestrates: Gemini → retry → DeepSeek
```

`callLLMWithFailover` returns `{ raw: string, provider: 'gemini'|'deepseek'|'fallback' }`.

Retry logic:
```
try Gemini → if 4xx throw immediately (no retry) → catch non-4xx → sleep 1s → retry Gemini → catch → try DeepSeek → catch → return fallback
```

**Acceptance criteria:**
- `callLLMWithFailover` returns `{ raw, provider: 'gemini' }` on first-try Gemini success
- Returns `{ raw, provider: 'gemini' }` on second-try Gemini success
- Returns `{ raw, provider: 'deepseek' }` after both Gemini attempts fail
- Returns `{ raw: '', provider: 'fallback' }` when DeepSeek key absent
- Returns `{ raw: '', provider: 'fallback' }` when both providers fail
- 4xx Gemini error skips retry and goes straight to DeepSeek

**Tests to add:**
`famcare-backend/src/tests/aiService_failover.test.js`

Test cases:
1. `callLLMWithFailover` — Gemini succeeds on first try → provider = 'gemini', no sleep
2. Gemini fails first try (non-4xx), succeeds second try → provider = 'gemini', sleep called once
3. Both Gemini attempts fail → DeepSeek called → provider = 'deepseek'
4. Gemini 4xx → no retry → DeepSeek called immediately → provider = 'deepseek'
5. Both providers fail → provider = 'fallback', empty string returned
6. `DEEPSEEK_API_KEY` absent → skip DeepSeek → provider = 'fallback'

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_failover
```

**Constraints:**
- Use `jest.unstable_mockModule` for ESM mocks (per existing test pattern in `appointment_management.test.js`)
- Inject `sleepFn` as a parameter with default `() => new Promise(r => setTimeout(r, 1000))` so tests can pass a no-op

**Risks:**
- DeepSeek API response wraps text in `choices[0].message.content` (OpenAI format) — strip markdown fences before `parseIntentJson`
- Gemini SDK may throw non-Error objects; ensure `err.status` check handles undefined

---

### Task 4-C: Wire Failover into `handleAiMessage` and Add Provider Logging

**Purpose:** Replace the `callGemini(prompt)` call in `handleAiMessage()` with `callLLMWithFailover(prompt)`, and log the provider used.

**Files affected:**
- `famcare-backend/src/services/aiService.js` — update `handleAiMessage()`

**Dependencies:** Task 4-B

**Key change in `handleAiMessage`:**
```js
const { raw, provider } = await callLLMWithFailover(prompt)
console.log(`[aiService] provider=${provider}`)
const intent = parseIntentJson(raw)
```

If `provider === 'fallback'`, return `FALLBACK_TEXT` immediately (skip `parseIntentJson`).

**Acceptance criteria:**
- `[aiService] provider=gemini` logged on success
- `[aiService] provider=deepseek` logged when fallback used
- `[aiService] provider=fallback` logged when both fail
- `FALLBACK_TEXT` returned to user when provider=fallback
- Gemini failure reason logged before switching: `console.warn('[aiService] gemini failed:', err.message)`

**Tests to add:** (extend `aiService_failover.test.js`)

Test cases:
7. `handleAiMessage` returns FALLBACK_TEXT when `callLLMWithFailover` resolves with `provider='fallback'`
8. `handleAiMessage` processes intent normally when `callLLMWithFailover` resolves with `provider='deepseek'`

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_failover
cd famcare-backend && npm test
```

**Risks:** `handleAiMessage` currently catches all errors and returns FALLBACK_TEXT — ensure the new flow doesn't double-wrap errors.

---

## 8. Safe Implementation Order

```
4-A (install dep + env) → 4-B (callLLMWithFailover + tests) → 4-C (wire into handleAiMessage)
```

Each task is independently testable. 4-C can only start after 4-B is complete.

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| `@google/generative-ai` may not expose HTTP status on errors | Inspect `err.status`, `err.httpStatus`, `err.code` — wrap detection in helper `isGemini4xx(err)` that checks multiple fields |
| DeepSeek rate limits during tests | Mock the OpenAI client entirely in tests — never call real APIs |
| 1-second sleep makes tests slow | Inject `sleepFn` (no-op in tests) per Task 4-B constraint |
| `openai` package tree-shakes poorly with ESM | Use named import `import OpenAI from 'openai'` and test at import time |
