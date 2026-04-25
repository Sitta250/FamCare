# Feature 6: Rate Limiting Per LINE User Per Day

> **Implementation order: 3**

---

## 1. Goal Summary

Prevent a single LINE user from making more than 50 AI-processed text messages per calendar day (Bangkok timezone). Check and increment a PostgreSQL counter before calling any LLM. Postback actions are exempt. Return a Thai message when the limit is reached without calling Gemini at all.

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | Add `AiUsageLog` model |
| `famcare-backend/src/services/aiService.js` | Add rate-limit check before LLM call |
| `famcare-backend/src/webhook/handler.js` | No change needed — rate limit is enforced inside `handleAiMessage` |
| `famcare-backend/src/utils/datetime.js` | Use `bangkokCalendarDate()` for the day key |

---

## 3. Data Model Changes

**New Prisma model** — add to `prisma/schema.prisma`:

```prisma
model AiUsageLog {
  id          String @id @default(cuid())
  lineUserId  String
  date        String // "YYYY-MM-DD" Bangkok timezone
  count       Int    @default(0)

  @@unique([lineUserId, date])
}
```

**Migration name:** `add_ai_usage_log`

No existing models are modified.

---

## 4. API Changes

`handleAiMessage(userMessage, user, familyMembers)` — unchanged external signature. Internally, the first thing it does is check and increment the rate limit before building the prompt.

No REST route changes.

---

## 5. Frontend Changes

None. The rate-limit message is returned as a plain Thai string to LINE.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| User sends exactly 50th message | Allow (count 50 is valid); reject from 51st onward |
| User sends 51st message | Reject before calling LLM; return Thai limit message |
| Midnight Bangkok timezone rollover | `bangkokCalendarDate()` returns new date → fresh row, count resets to 0 |
| DB upsert race condition (concurrent messages) | PostgreSQL `ON CONFLICT DO UPDATE SET count = count + 1` is atomic — use Prisma `upsert` with `update: { count: { increment: 1 } }` |
| `count` check before increment | Read existing count first; if `>= 50`, reject without incrementing |
| `lineUserId` available from `user.lineUserId` | Available in `handleAiMessage` via `user` param |

---

## 7. Implementation Tasks

### Task 6-A: Add `AiUsageLog` Model and Run Migration

**Purpose:** Create the database table needed to track daily LLM usage per user.

**Files affected:**
- `famcare-backend/prisma/schema.prisma` — add `AiUsageLog` model

**Dependencies:** None

**Schema to add:**
```prisma
model AiUsageLog {
  id         String @id @default(cuid())
  lineUserId String
  date       String
  count      Int    @default(0)

  @@unique([lineUserId, date])
}
```

**Acceptance criteria:**
- `prisma migrate dev --name add_ai_usage_log` runs without error
- `prisma generate` succeeds
- `prisma.aiUsageLog` is accessible in the Prisma client

**Tests:** None for this task (migration only)

**Verification commands:**
```bash
cd famcare-backend && npx prisma migrate dev --name add_ai_usage_log && npx prisma generate
```

**Constraints:** Single-field unique index on `(lineUserId, date)` is required for upsert atomicity.

**Risks:** If other pending schema changes exist, migrate all at once.

---

### Task 6-B: Implement `checkAndIncrementRateLimit(lineUserId)` in `aiService.js`

**Purpose:** Encapsulate the rate-limit logic as a pure async function, making it independently testable.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 6-A (AiUsageLog model must exist)

**Implementation:**

```js
const DAILY_LIMIT = 50

async function checkAndIncrementRateLimit(lineUserId) {
  const today = bangkokCalendarDate() // "YYYY-MM-DD"

  // Read current count
  const existing = await prisma.aiUsageLog.findUnique({
    where: { lineUserId_date: { lineUserId, date: today } },
    select: { count: true },
  })

  if (existing && existing.count >= DAILY_LIMIT) {
    return false // limit reached — do not increment
  }

  // Upsert: create with count=1 or increment
  await prisma.aiUsageLog.upsert({
    where: { lineUserId_date: { lineUserId, date: today } },
    create: { lineUserId, date: today, count: 1 },
    update: { count: { increment: 1 } },
  })

  return true // allowed
}
```

**Acceptance criteria:**
- Returns `true` for first 50 calls per user per day
- Returns `false` (without incrementing) on 51st call
- `count` in DB matches number of allowed calls
- Uses `bangkokCalendarDate()` from `datetime.js`

**Tests to add:**
`famcare-backend/src/tests/aiService_rateLimit.test.js`

Mock `prisma.aiUsageLog.findUnique` and `prisma.aiUsageLog.upsert`.

Test cases:
1. `findUnique` returns `null` (new user) → `upsert` called with `create: {count:1}` → returns `true`
2. `findUnique` returns `{count: 49}` → `upsert` called with `update: {count: {increment:1}}` → returns `true`
3. `findUnique` returns `{count: 50}` → `upsert` NOT called → returns `false`
4. `findUnique` returns `{count: 100}` (data integrity failure) → returns `false`
5. Uses `bangkokCalendarDate()` for date key (mock datetime to verify)

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_rateLimit
```

**Constraints:**
- Use `bangkokCalendarDate()` — never `new Date().toISOString().slice(0,10)` (UTC, wrong timezone)
- The unique index compound name in Prisma is `lineUserId_date` (Prisma auto-generates this)

**Risks:**
- Concurrent requests within the same millisecond: the read-then-write is not a single atomic DB operation. Under high concurrency a user could briefly exceed 50. Acceptable for this use case (caregivers, not adversarial users). Note this in code comments.

---

### Task 6-C: Wire Rate Limit into `handleAiMessage`

**Purpose:** Call `checkAndIncrementRateLimit` as the first operation in `handleAiMessage` — before building the prompt or calling any LLM. Return the Thai rejection message immediately if limit is reached.

**Files affected:**
- `famcare-backend/src/services/aiService.js` — update `handleAiMessage()`

**Dependencies:** Task 6-B

**Key change:**
```js
const RATE_LIMIT_TEXT = 'ขออภัย วันนี้ใช้ FamCare AI ครบ 50 ครั้งแล้ว กรุณาลองใหม่พรุ่งนี้ครับ'

export async function handleAiMessage(userMessage, user, familyMembers) {
  const allowed = await checkAndIncrementRateLimit(user.lineUserId)
  if (!allowed) return RATE_LIMIT_TEXT

  // ... existing logic
}
```

**Acceptance criteria:**
- When `checkAndIncrementRateLimit` returns `false`, `RATE_LIMIT_TEXT` is returned without calling Gemini
- When allowed, existing flow continues unchanged
- The Thai message exactly matches the spec: `ขออภัย วันนี้ใช้ FamCare AI ครบ 50 ครั้งแล้ว กรุณาลองใหม่พรุ่งนี้ครับ`
- Telemetry (Feature 5) is NOT emitted for rate-limited calls (rejection happens before LLM)

**Tests to add:** (extend `aiService_rateLimit.test.js`)

Test cases:
6. `handleAiMessage` when `checkAndIncrementRateLimit` mock returns `false` → returns `RATE_LIMIT_TEXT`, Gemini mock NOT called
7. `handleAiMessage` when `checkAndIncrementRateLimit` mock returns `true` → continues to LLM call
8. Rate limit check failure (DB throws) → error caught, fall through to LLM (do not block user on infra error)
   - **Note from spec:** Spec doesn't address this; assumption is to degrade gracefully rather than block user. If DB is down, allow the call.

**Verification:**
```bash
cd famcare-backend && npm test
```

**Risks:**
- If DB is unavailable during rate check, the catch block in `handleAiMessage` would return `FALLBACK_TEXT`. This may erroneously block users. Consider a separate try/catch just for the rate check that allows fallthrough on error.

---

## 8. Safe Implementation Order

```
6-A (schema + migration) → 6-B (checkAndIncrementRateLimit + tests) → 6-C (wire into handleAiMessage)
```

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| Concurrent messages from same user | Documented race condition; acceptable for this domain |
| Bangkok midnight rollover during active session | `bangkokCalendarDate()` handles correctly — no additional logic needed |
| `lineUserId_date` Prisma compound key name | Verify Prisma generates this exact name after `prisma generate`; adjust if different |
| Rate limit blocks telemetry logging | Feature 5 telemetry should NOT run for rate-limited calls — this is correct behavior |
