# Feature 1: Conversation Memory (Per User, Per Elder)

> **Implementation order: 5**

---

## 1. Goal Summary

Store the last 10 message pairs (user + bot) per `lineUserId:familyMemberId` scope in PostgreSQL. Inject this history as a `Conversation so far:` block at the top of every Gemini/DeepSeek prompt. Memory is scoped per LINE user AND per elder, isolated across users even if they share the same elder.

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | Add `ConversationMessage` model |
| `famcare-backend/src/services/aiService.js` | Load history → inject into prompt → save exchange after reply |
| `famcare-backend/src/utils/datetime.js` | No change needed |

No route or handler changes. Memory is entirely inside the AI pipeline.

---

## 3. Data Model Changes

**New Prisma model** — add to `prisma/schema.prisma`:

```prisma
enum ConversationRole {
  USER
  BOT
}

model ConversationMessage {
  id             String           @id @default(cuid())
  lineUserId     String
  familyMemberId String?
  role           ConversationRole
  content        String
  createdAt      DateTime         @default(now())

  @@index([lineUserId, familyMemberId, createdAt])
}
```

**Migration name:** `add_conversation_message`

**Hard cap enforcement:** On insert, delete rows beyond 20 (10 pairs) per scope using a sub-select ordered by `createdAt` ascending.

---

## 4. API Changes

`buildIntentPrompt(userMessage, familyMembers)` gains a new `history` parameter:
```js
function buildIntentPrompt(userMessage, familyMembers, history = [])
```

`history` is an array of `{ role: 'USER'|'BOT', content: string }` objects.

`handleAiMessage(userMessage, user, familyMembers)` — unchanged external signature. History loading and saving is internal.

---

## 5. Frontend Changes

None.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| No prior history | Omit `Conversation so far:` block entirely from prompt |
| `familyMemberId` null (pure `chat` intent) | Use most recently active elder for this user. Query: last `ConversationMessage` for `lineUserId` where `familyMemberId IS NOT NULL`, take its `familyMemberId`. If none, use key `lineUserId:none` (store with `familyMemberId: null`) |
| User switches elders mid-conversation | Intent resolves to new `familyMemberId` → history loaded for new scope → context resets naturally |
| Cap enforcement | After saving new pair, delete rows where `createdAt < (SELECT createdAt FROM ConversationMessage WHERE lineUserId=? AND familyMemberId=? ORDER BY createdAt DESC LIMIT 1 OFFSET 19)` — keep last 20 rows |
| Bot reply is FALLBACK_TEXT or rate-limit message | Still save both turns to memory (user message + bot response) |
| Memory save fails | Log error, do not throw — never block the reply |
| Scope key `lineUserId:none` in DB | Stored as `familyMemberId: null` — query using `familyMemberId: null` |

---

## 7. Implementation Tasks

### Task 1-A: Add `ConversationMessage` Model and Run Migration

**Purpose:** Create the DB table.

**Files affected:**
- `famcare-backend/prisma/schema.prisma`

**Dependencies:** None (but implement after Features 4–7 are stable)

**Schema:**
```prisma
enum ConversationRole {
  USER
  BOT
}

model ConversationMessage {
  id             String           @id @default(cuid())
  lineUserId     String
  familyMemberId String?
  role           ConversationRole
  content        String
  createdAt      DateTime         @default(now())

  @@index([lineUserId, familyMemberId, createdAt])
}
```

**Acceptance criteria:**
- `prisma migrate dev --name add_conversation_message` runs without error
- `prisma.conversationMessage` accessible on client
- Index exists on `(lineUserId, familyMemberId, createdAt)`

**Verification:**
```bash
cd famcare-backend && npx prisma migrate dev --name add_conversation_message && npx prisma generate
```

**Risks:** Composite index with nullable `familyMemberId` — PostgreSQL handles this correctly (nulls are distinct in unique indexes but not in regular indexes, which is what we want).

---

### Task 1-B: Implement `loadHistory(lineUserId, familyMemberId)` and `saveExchange(lineUserId, familyMemberId, userMsg, botReply)`

**Purpose:** Two focused Prisma helper functions for reading and writing conversation history, isolated from the prompt-building logic.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 1-A

**Implementation:**

```js
async function loadHistory(lineUserId, familyMemberId) {
  // familyMemberId may be null → query with null
  const rows = await prisma.conversationMessage.findMany({
    where: { lineUserId, familyMemberId: familyMemberId ?? null },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { role: true, content: true },
  })
  return rows // [{role:'USER',content:'...'}, {role:'BOT',content:'...'}]
}

async function saveExchange(lineUserId, familyMemberId, userMsg, botReply) {
  await prisma.conversationMessage.createMany({
    data: [
      { lineUserId, familyMemberId: familyMemberId ?? null, role: 'USER', content: userMsg },
      { lineUserId, familyMemberId: familyMemberId ?? null, role: 'BOT', content: botReply },
    ],
  })
  // Enforce cap: delete all but last 20 rows for this scope
  const toKeep = await prisma.conversationMessage.findMany({
    where: { lineUserId, familyMemberId: familyMemberId ?? null },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true },
  })
  const keepIds = toKeep.map(r => r.id)
  await prisma.conversationMessage.deleteMany({
    where: {
      lineUserId,
      familyMemberId: familyMemberId ?? null,
      id: { notIn: keepIds },
    },
  })
}
```

**Acceptance criteria:**
- `loadHistory` returns rows in ascending `createdAt` order
- `loadHistory` with `familyMemberId = null` returns only rows where DB `familyMemberId IS NULL`
- `saveExchange` creates exactly 2 rows (USER + BOT)
- `saveExchange` deletes rows beyond the 20-row cap
- After 25 calls to `saveExchange`, `loadHistory` returns exactly 20 rows

**Tests to add:**
`famcare-backend/src/tests/aiService_memory.test.js`

Test cases:
1. `loadHistory` with no rows → returns empty array
2. `loadHistory` returns rows in ascending order (oldest first)
3. `loadHistory` scoped to `lineUserId:memberId` does not return rows for different `memberId`
4. `saveExchange` creates 2 rows with correct `role` values
5. `saveExchange` when total rows > 20 → deletes oldest, keeps exactly 20
6. `loadHistory` with `familyMemberId = null` only returns rows where `familyMemberId IS NULL`

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_memory
```

**Constraints:**
- Mock `prisma.conversationMessage` using `jest.unstable_mockModule` per existing test pattern
- Cap enforcement using the `id NOT IN (...)` pattern is N+3 queries but correct; acceptable for ≤20 rows

**Risks:** Large `keepIds` array in `NOT IN` is safe since cap is always 20.

---

### Task 1-C: Inject History into Prompt and Resolve Scope

**Purpose:** Update `buildIntentPrompt` to accept and format history. Add scope resolution logic (find most recently active elder for `chat` intent).

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 1-B

**`buildIntentPrompt` change:**
```js
function buildIntentPrompt(userMessage, familyMembers, history = []) {
  let historyBlock = ''
  if (history.length > 0) {
    const lines = history.map(h => `${h.role === 'USER' ? 'User' : 'Bot'}: ${h.content}`).join('\n')
    historyBlock = `Conversation so far:\n${lines}\n\n`
  }
  return `${historyBlock}You are FamCare intent extractor...` // rest unchanged
}
```

**Scope resolution** (add helper):
```js
async function resolveMemoryScope(lineUserId, resolvedFamilyMemberId) {
  if (resolvedFamilyMemberId) return resolvedFamilyMemberId
  // Find most recently active elder for this user
  const last = await prisma.conversationMessage.findFirst({
    where: { lineUserId, familyMemberId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { familyMemberId: true },
  })
  return last?.familyMemberId ?? null // null → store under lineUserId:none scope
}
```

**Acceptance criteria:**
- `buildIntentPrompt` with empty history → no `Conversation so far:` block in output
- `buildIntentPrompt` with 3 history rows → block present with correct USER:/Bot: format
- History block appears at the top of the prompt, before the intent instructions
- `resolveMemoryScope` returns last active `familyMemberId` when current intent has none
- `resolveMemoryScope` returns `null` when no prior active elder exists

**Tests to add:** (extend `aiService_memory.test.js`)

Test cases:
7. `buildIntentPrompt` with `history=[]` → output does NOT contain 'Conversation so far:'
8. `buildIntentPrompt` with 2 rows → output contains 'Conversation so far:', 'User:', 'Bot:'
9. `resolveMemoryScope` with `resolvedFamilyMemberId='abc'` → returns `'abc'` immediately (no DB call)
10. `resolveMemoryScope` with `null`, DB has prior row with `familyMemberId='xyz'` → returns `'xyz'`
11. `resolveMemoryScope` with `null`, DB has no prior rows → returns `null`

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_memory
```

---

### Task 1-D: Wire Memory into `handleAiMessage`

**Purpose:** Integrate history load → prompt inject → save exchange into the main `handleAiMessage` flow.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Tasks 1-B, 1-C

**Flow change in `handleAiMessage`:**
```
1. rate limit check (Feature 6)
2. Resolve familyMemberId from intent (not yet known — load with null initially)
   Actually: load history AFTER intent is resolved — because scope requires familyMemberId
   Revised flow:
   a. Call LLM without history to get initial intent
   b. Resolve scope from intent.familyMemberId (or resolveMemoryScope for chat)
   c. Load history for that scope
   d. Rebuild prompt with history
   e. Call LLM again with history-enriched prompt → final intent
   f. Execute intent
   g. Save exchange (user message + bot reply) to that scope
```

**Simpler alternative (recommended):** Pre-load history using the last known scope before the first LLM call:
```
a. resolveMemoryScope(user.lineUserId, null) → get last active scope
b. loadHistory(lineUserId, lastScope) → get up to 20 rows
c. buildIntentPrompt(userMessage, familyMembers, history) → with history
d. Single LLM call → intent
e. Execute intent → reply
f. Determine final scope: intent.familyMemberId ?? lastScope ?? null
g. saveExchange(lineUserId, finalScope, userMessage, reply) — fire-and-forget with .catch()
```

This approach uses a single LLM call. The scope may be "last active elder" which is close enough for continuity — the spec says "use most recently active elder" for chat.

**Acceptance criteria:**
- `handleAiMessage` calls `loadHistory` before building prompt
- If history exists, `buildIntentPrompt` receives it
- After reply is sent, `saveExchange` is called (fire-and-forget — do not await in the critical path, but catch errors)
- Memory save failure does not affect user reply
- History for scope A does not appear when user is talking about scope B

**Tests to add:** (extend `aiService_memory.test.js`)

Test cases:
12. `handleAiMessage` → `loadHistory` called, history injected into prompt (verify via mock prompt capture)
13. After successful reply, `saveExchange` called with user message and bot reply
14. `saveExchange` failure → `handleAiMessage` still returns reply normally

**Verification:**
```bash
cd famcare-backend && npm test
```

**Risks:**
- Fire-and-forget `saveExchange` — use `.catch(err => console.error(...))` to avoid unhandled promise rejections
- The "resolve scope before LLM call" approach uses the last known scope for history, which may be slightly stale. Acceptable per spec.

---

## 8. Safe Implementation Order

```
1-A (schema) → 1-B (load/save helpers + tests) → 1-C (prompt injection + scope) → 1-D (wire into handleAiMessage)
```

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| Long conversation history bloats prompt token count | Cap is 20 rows (10 pairs) per spec — token budget is bounded |
| Memory across CAREGIVERs who share an elder | Spec: "Do not share memory across users even if they manage the same elder." The `lineUserId:familyMemberId` key guarantees this |
| `familyMemberId` is null in DB — Prisma `findMany` with `where: {familyMemberId: null}` | Prisma handles null equality correctly in `where` clauses |
| `saveExchange` is fire-and-forget — test may not see it unless test awaits | Use `jest.useFakeTimers` or add a small flush after `handleAiMessage` in tests |
