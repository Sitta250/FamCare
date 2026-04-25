# Feature 3: Confirmation for Destructive Actions

> **Implementation order: 7**

---

## 1. Goal Summary

Before executing any delete or update intent, send a LINE Flex Message with a summary of the pending action and two buttons: "ยืนยัน" and "ยกเลิก". The pending intent is stored server-side (in a `PendingAction` Prisma model) because LINE Flex Message postback data has a 300-byte limit. On confirmation postback, execute the stored intent. On cancel, reply with "ยกเลิกแล้วครับ".

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | Add `PendingAction` model |
| `famcare-backend/src/services/aiService.js` | Detect destructive intents; store `PendingAction`; return Flex Message response |
| `famcare-backend/src/webhook/handler.js` | Add `confirm_destructive` and `cancel_destructive` postback handlers |

---

## 3. Data Model Changes

**New Prisma model** — add to `prisma/schema.prisma`:

```prisma
model PendingAction {
  id         String   @id @default(cuid())
  lineUserId String   @unique  // one pending action per user at a time
  intentJson String            // full intent as JSON string
  createdAt  DateTime @default(now())
}
```

**Notes:**
- `@unique` on `lineUserId` — only one pending action per user. New destructive intent replaces the old one.
- No explicit TTL — old actions will be overwritten. Stale actions (user never confirmed/cancelled) are cleaned up on next destructive action.

**Migration name:** `add_pending_action`

---

## 4. API Changes

`handleAiMessage` return type (established in Feature 2, Task 2-A) gains a new variant:
```js
{ type: 'flexMessage', altText: string, contents: object }
```

The `contents` field is a LINE Flex Message JSON object (bubble container).

`handler.js` must call `client.replyMessage` with `{ type: 'flex', altText, contents }` for this type.

---

## 5. Frontend Changes

None. LINE Flex Message renders natively.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| User sends two destructive messages back-to-back | Second one overwrites the first `PendingAction` (upsert on `lineUserId`) |
| User ignores confirmation and sends a new text message | The pending action remains in DB; the new text message is processed normally; the old pending action is orphaned. It is cleaned up next time a destructive intent is sent. |
| User taps "ยืนยัน" but underlying record was already deleted | `executeIntent` throws; catch it, reply "เกิดข้อผิดพลาด: ไม่พบข้อมูลที่ต้องการลบ" |
| `PendingAction.intentJson` is malformed on confirm | Log warn, reply Thai error, delete the row |
| Destructive intent with null `familyMemberId` | Ambiguity resolution (Feature 2) runs first and resolves the member BEFORE destructive check — correct order |

---

## 7. Implementation Tasks

### Task 3-A: Add `PendingAction` Model and Migration

**Purpose:** Create the DB table for server-side pending intent storage.

**Files affected:**
- `famcare-backend/prisma/schema.prisma`

**Dependencies:** None

**Schema:**
```prisma
model PendingAction {
  id         String   @id @default(cuid())
  lineUserId String   @unique
  intentJson String
  createdAt  DateTime @default(now())
}
```

**Acceptance criteria:**
- `prisma migrate dev --name add_pending_action` runs without error
- `prisma.pendingAction` accessible with `upsert`, `findUnique`, `delete`

**Verification:**
```bash
cd famcare-backend && npx prisma migrate dev --name add_pending_action && npx prisma generate
```

**Risks:** `@unique` on `lineUserId` means only one pending action per user globally. This matches the spec.

---

### Task 3-B: Implement Destructive Intent Detection and `PendingAction` Storage

**Purpose:** Identify destructive intents, store them in `PendingAction`, and return a Flex Message response from `handleAiMessage`.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 3-A; Feature 2 Task 2-A (structured return type)

**Destructive intent set** (current scope per spec — these intents don't exist yet but prep is needed):
```js
const DESTRUCTIVE_INTENTS = new Set([
  'delete_appointment',
  'delete_medication',
  'delete_symptom',
  'update_appointment', // only when field changes included
])
```

**Note:** Per spec, current intents (add/list/log) are NOT destructive. This feature prepares the pattern for when delete/update intents are added (Feature 8). The confirmation flow itself must work for any intent added to `DESTRUCTIVE_INTENTS`.

**Implementation in `handleAiMessage`** (after ambiguity check, before executeIntent):
```js
if (DESTRUCTIVE_INTENTS.has(validation.intent.intent)) {
  return await storePendingAndBuildConfirmation(user.lineUserId, validation.intent, familyMembers)
}
```

**`storePendingAndBuildConfirmation(lineUserId, intent, familyMembers)`:**
```js
async function storePendingAndBuildConfirmation(lineUserId, intent, familyMembers) {
  // Store server-side
  await prisma.pendingAction.upsert({
    where: { lineUserId },
    create: { lineUserId, intentJson: JSON.stringify(intent) },
    update: { intentJson: JSON.stringify(intent), createdAt: new Date() },
  })

  const summary = buildDestructiveSummary(intent, familyMembers)
  const flexContents = buildConfirmFlexBubble(summary)

  return {
    type: 'flexMessage',
    altText: `ยืนยัน: ${summary}`,
    contents: flexContents,
  }
}
```

**`buildDestructiveSummary(intent, familyMembers)`** — returns a Thai summary string:
```js
// e.g. "ลบนัดหมาย 'นัดหมอ' ของแม่"
// e.g. "ลบยา 'ยาเบาหวาน' ของพ่อ"
```

**`buildConfirmFlexBubble(summary)`** — returns a LINE Flex Message Bubble JSON:
```js
{
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [
    { type: 'text', text: summary, wrap: true, size: 'md' }
  ]},
  footer: { type: 'box', layout: 'horizontal', contents: [
    { type: 'button', style: 'primary', color: '#FF4444',
      action: { type: 'postback', label: 'ยืนยัน', data: JSON.stringify({ action: 'confirm_destructive' }) } },
    { type: 'button', style: 'secondary',
      action: { type: 'postback', label: 'ยกเลิก', data: JSON.stringify({ action: 'cancel_destructive' }) } },
  ]}
}
```

Note: confirm button postback data is just `{"action":"confirm_destructive"}` — the intent is on the server.

**Acceptance criteria:**
- Destructive intent → `PendingAction` upserted in DB with correct `intentJson`
- Returns `{ type: 'flexMessage', altText, contents }`
- `contents` is valid Flex Bubble JSON with two buttons
- Non-destructive intent → PendingAction NOT created, executeIntent called normally

**Tests to add:**
`famcare-backend/src/tests/aiService_confirmation.test.js`

Test cases:
1. `handleAiMessage` with `delete_appointment` intent → `prisma.pendingAction.upsert` called, returns `{ type: 'flexMessage' }`
2. `handleAiMessage` with `add_appointment` intent → `prisma.pendingAction.upsert` NOT called, returns `{ type: 'text' }`
3. Flex contents include button with `action: 'confirm_destructive'`
4. Flex contents include button with `action: 'cancel_destructive'`
5. Second destructive intent from same user → upsert overwrites first

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_confirmation
```

**Risks:**
- LINE Flex Message JSON must be valid per LINE spec. Test with LINE's Flex Message Simulator before production.
- `buildDestructiveSummary` must handle all current and future destructive intents gracefully — add a default case.

---

### Task 3-C: Handle `confirm_destructive` and `cancel_destructive` Postbacks

**Purpose:** Add postback handlers in `handler.js` for confirmation and cancellation.

**Files affected:**
- `famcare-backend/src/webhook/handler.js`
- `famcare-backend/src/services/aiService.js` — ensure `executeIntent` is exported (done in Feature 2)

**Dependencies:** Tasks 3-A, 3-B; Feature 2 Task 2-C (executeIntent must be exported)

**Handler for `confirm_destructive`:**
```js
if (action === 'confirm_destructive') {
  const user = await findOrCreateByLineUserId(lineUserId)

  const pending = await prisma.pendingAction.findUnique({ where: { lineUserId } })
  if (!pending) {
    return reply(client, event.replyToken, 'ไม่พบคำสั่งที่รอยืนยัน')
  }

  // Delete before executing (prevents double-execution)
  await prisma.pendingAction.delete({ where: { lineUserId } })

  let intent
  try {
    intent = JSON.parse(pending.intentJson)
  } catch {
    return reply(client, event.replyToken, 'ไม่สามารถประมวลผลคำสั่งได้')
  }

  const familyMembers = await listFamilyMembers(user.id)
  try {
    const result = await executeIntent(intent, user.id, familyMembers)
    return reply(client, event.replyToken, result)
  } catch (err) {
    console.error('[webhook] confirm_destructive failed:', err.message)
    return reply(client, event.replyToken, `เกิดข้อผิดพลาด: ${err.message}`)
  }
}
```

**Handler for `cancel_destructive`:**
```js
if (action === 'cancel_destructive') {
  // Optionally clean up pending action (best-effort)
  const user = await findOrCreateByLineUserId(lineUserId)
  await prisma.pendingAction.deleteMany({ where: { lineUserId: user.lineUserId } }).catch(() => {})
  return reply(client, event.replyToken, 'ยกเลิกแล้วครับ')
}
```

**`handler.js` update for `flexMessage` response type:**
```js
const response = await handleAiMessage(...)
if (response.type === 'flexMessage') {
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'flex', altText: response.altText, contents: response.contents }],
  })
}
```

**Acceptance criteria:**
- `confirm_destructive` → loads `PendingAction`, deletes it, calls `executeIntent`, replies with result
- `confirm_destructive` with no pending action → replies "ไม่พบคำสั่งที่รอยืนยัน"
- `cancel_destructive` → replies "ยกเลิกแล้วครับ", deletes `PendingAction` (best-effort)
- `PendingAction` is deleted BEFORE `executeIntent` to prevent double-execution
- Handler sends Flex Message when `handleAiMessage` returns `{ type: 'flexMessage' }`

**Tests to add:**
`famcare-backend/src/tests/handler_confirmation.test.js`

Test cases:
6. `confirm_destructive` postback with valid pending action → `executeIntent` called, correct reply sent
7. `confirm_destructive` with no pending action → "ไม่พบคำสั่งที่รอยืนยัน" reply
8. `cancel_destructive` postback → "ยกเลิกแล้วครับ" reply, `pendingAction.deleteMany` called
9. Text message after destructive action (no confirmation) → normal AI processing, pending action NOT cleared by text message handler

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=handler_confirmation
cd famcare-backend && npm test
```

**Risks:**
- Delete-before-execute pattern prevents double-execution but means if `executeIntent` throws, the pending action is gone. This is intentional (user must re-send the command).
- `listFamilyMembers` is called on confirm postback — ensure this function is imported in `handler.js` (it already is per existing code).

---

## 8. Safe Implementation Order

```
3-A (schema) → 3-B (detection + storage + Flex build + tests) → 3-C (postback handlers + tests)
```

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| No current destructive intents exist (Feature 8 adds them) | Feature 3 establishes the pattern; tests use mock destructive intents (`delete_appointment`, etc.) |
| `DESTRUCTIVE_INTENTS` set must be updated when Feature 8 adds new intents | Document this clearly in the constant's JSDoc |
| LINE Flex Message spec may differ from what's documented | Test in LINE Flex Simulator before production |
| Stale pending actions from users who never respond | They are silently overwritten on next destructive intent; no cleanup cron needed |
| Cancel postback should clear pending action — but what if `lineUserId` differs from what was stored? | `lineUserId` is sourced from the LINE event (`getLineUserId(event)`) — same as when stored |
