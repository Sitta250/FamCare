# Feature 2: Ambiguity Resolution via LINE Quick Reply

> **Implementation order: 6**

---

## 1. Goal Summary

When an intent requires a `familyMemberId` but the LLM could not resolve one AND the user has more than one family member, send a LINE Quick Reply asking "ข้อมูลนี้เกี่ยวกับใครครับ?" with one button per family member. The button postback carries the pending intent. When the user taps a button, the postback handler re-runs `executeIntent()` with the resolved member.

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/src/services/aiService.js` | Add ambiguity detection; extract `executeIntent` for external call |
| `famcare-backend/src/webhook/handler.js` | Add `resolve_member` postback action handler; send Quick Reply message |
| `famcare-backend/src/lib/prisma.js` | No change |
| `@line/bot-sdk` | Use `quickReply` field in reply message; already installed |

---

## 3. Data Model Changes

None. The pending intent is encoded in postback data (URL-encoded JSON, ≤ 300 bytes). No server-side persistence needed for the pending intent at this stage.

**Assumption:** Intent JSON for common intents (add_appointment, log_medication, etc.) is small enough to fit in 300 bytes after URL encoding when non-essential fields (`note`, `reason`) are dropped. Verified: a minimal `add_appointment` intent JSON is ~120 bytes; URL-encoded ~150 bytes. Within limit.

---

## 4. API Changes

`handleAiMessage` — changed to return either a string (existing behavior) OR signal that a Quick Reply should be sent.

**Preferred approach:** Change `handleAiMessage` to return `{ type: 'text', text: string }` OR `{ type: 'quickReply', text: string, items: [{label, postbackData}] }`. The webhook handler reads the return type and calls the appropriate LINE API method.

**Alternative (simpler):** Have `handleAiMessage` throw a custom error or return a sentinel, and move the Quick Reply sending logic entirely into `handler.js`.

**Recommended:** Return a structured response object from `handleAiMessage`. The webhook handler already owns the LINE client and reply calls.

---

## 5. Frontend Changes

None. LINE Quick Reply renders natively in the LINE app.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| User has exactly 1 family member, `familyMemberId` is null | Auto-select — do not send Quick Reply (existing `resolveOrPickFirstMember` handles this) |
| User has 0 family members | Existing "ไม่พบข้อมูลสมาชิก" message returned |
| User has > 1 members, `familyMemberId` NOT null | Intent resolves normally — no Quick Reply |
| Postback data > 300 bytes after truncation | Drop `note` and `reason` fields from pending intent before encoding; if still > 300 bytes, store server-side (not in scope for this feature per spec — use PendingAction from Feature 3 pattern) |
| User taps Quick Reply for wrong person | No undo — they can re-send the message |
| `pendingIntent` in postback is malformed | Log warn, reply "ไม่สามารถประมวลผลคำสั่งได้" |
| Quick Reply has > 13 items (LINE limit) | Truncate to 13 (a user with 14+ elders is extremely unlikely in this domain) |

---

## 7. Implementation Tasks

### Task 2-A: Refactor `handleAiMessage` to Return Structured Response Object

**Purpose:** Change the return type of `handleAiMessage` from `string` to `{ type, text, items? }` so the caller can distinguish between a plain text reply and a Quick Reply message.

**Files affected:**
- `famcare-backend/src/services/aiService.js`
- `famcare-backend/src/webhook/handler.js` — update the single call site to unwrap the new format

**New return shapes:**
```js
// Plain text (existing behavior, now wrapped)
{ type: 'text', text: 'the reply string' }

// Quick Reply (new)
{ type: 'quickReply', text: 'ข้อมูลนี้เกี่ยวกับใครครับ?', items: [{ label: 'แม่', postbackData: '...' }] }
```

**Webhook handler update:**
```js
const response = await handleAiMessage(event.message.text, user, familyMembers)
if (response.type === 'quickReply') {
  return replyWithQuickReply(client, event.replyToken, response.text, response.items)
} else {
  return reply(client, event.replyToken, response.text)
}
```

Add `replyWithQuickReply(client, replyToken, text, items)` to `handler.js`:
```js
function replyWithQuickReply(client, replyToken, text, items) {
  if (!client || !replyToken) return Promise.resolve()
  return client.replyMessage({
    replyToken,
    messages: [{
      type: 'text',
      text,
      quickReply: {
        items: items.map(item => ({
          type: 'action',
          action: { type: 'postback', label: item.label, data: item.postbackData },
        })),
      },
    }],
  })
}
```

**Acceptance criteria:**
- All existing `handleAiMessage` callers return `{ type: 'text', text: '...' }` in the happy path
- `handler.js` correctly dispatches on `response.type`
- Existing tests still pass (update mocks to expect `{ type, text }` shape)
- `reply()` in handler still works for `type: 'text'`

**Tests to add:** Update existing tests in any test file that mocks `handleAiMessage` to expect `{ type: 'text', text: '...' }`.

No new test file needed for this task — it's a structural refactor.

**Verification:**
```bash
cd famcare-backend && npm test
```

**Risks:** Any test that asserts `handleAiMessage` returns a string will fail — update them to check `response.text`.

---

### Task 2-B: Add Ambiguity Detection and Quick Reply Building in `handleAiMessage`

**Purpose:** After intent extraction and validation, check if `familyMemberId` is null AND user has >1 members. If so, build and return a Quick Reply response instead of executing the intent.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 2-A (structured return type must exist)

**Intents that require `familyMemberId`** (all except `chat`):
```js
const INTENTS_REQUIRING_MEMBER = new Set([
  'add_appointment','list_appointments','log_medication','list_medications',
  'log_health_metric','list_health_metrics','log_symptom','list_symptoms'
])
```

**Logic to add between validation and executeIntent:**
```js
if (
  INTENTS_REQUIRING_MEMBER.has(validation.intent.intent) &&
  !validation.intent.familyMemberId &&
  familyMembers.length > 1
) {
  return buildAmbiguityQuickReply(validation.intent, familyMembers)
}
```

**`buildAmbiguityQuickReply(intent, familyMembers)`:**
```js
function buildAmbiguityQuickReply(intent, familyMembers) {
  // Truncate non-essential fields before encoding
  const pendingIntent = { ...intent }
  delete pendingIntent.note
  delete pendingIntent.reason

  const encodedIntent = encodeURIComponent(JSON.stringify(pendingIntent))

  const items = familyMembers.slice(0, 13).map(m => ({
    label: m.name.slice(0, 20), // LINE label max 20 chars
    postbackData: JSON.stringify({
      action: 'resolve_member',
      familyMemberId: m.id,
      pendingIntent: encodedIntent,
    }),
  }))

  return { type: 'quickReply', text: 'ข้อมูลนี้เกี่ยวกับใครครับ?', items }
}
```

**Acceptance criteria:**
- When `familyMemberId` is null and user has 2+ members → returns `{ type: 'quickReply', ... }`
- When `familyMemberId` is null and user has 1 member → intent executed normally (auto-select)
- When `familyMemberId` is null and user has 0 members → existing "ไม่พบข้อมูลสมาชิก" message
- When `familyMemberId` is already set → no Quick Reply, intent executed normally
- `chat` intent with null `familyMemberId` → no Quick Reply (chat doesn't require a member)
- Postback data for each item contains `action: 'resolve_member'`
- `note` and `reason` stripped from `pendingIntent` before encoding

**Tests to add:**
`famcare-backend/src/tests/aiService_ambiguity.test.js`

Test cases:
1. `handleAiMessage` with 2 family members, intent has `familyMemberId: null` → `{ type: 'quickReply' }` returned
2. `handleAiMessage` with 1 family member, intent has `familyMemberId: null` → `{ type: 'text' }` returned (auto-select)
3. `handleAiMessage` with 2 family members, intent has `familyMemberId: 'abc'` → `{ type: 'text' }` returned
4. Quick reply `items` count matches `familyMembers.length` (up to 13)
5. Each item's `postbackData` parses to `{ action: 'resolve_member', familyMemberId, pendingIntent }`
6. `pendingIntent` in postback does not contain `note` or `reason` fields
7. `chat` intent with `familyMemberId: null` and 2 members → `{ type: 'text' }` returned (no Quick Reply)

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_ambiguity
```

**Risks:**
- `JSON.stringify(postbackData)` for items could exceed 300 bytes if member IDs are long (cuid = 25 chars) and intent is complex. Verify with: `JSON.stringify({action:'resolve_member',familyMemberId:'clxxxxxxxxxxxxxxxxxxxxx',pendingIntent:encodedIntent}).length`

---

### Task 2-C: Handle `resolve_member` Postback in `handler.js`

**Purpose:** When the user taps a Quick Reply button, the postback `action: 'resolve_member'` arrives. Decode the pending intent, inject the resolved `familyMemberId`, and call `executeIntent` directly.

**Files affected:**
- `famcare-backend/src/webhook/handler.js`

**Dependencies:** Task 2-A, Task 2-B

**Note:** `executeIntent` must be exported from `aiService.js` for this task. Currently it is unexported.

**Change to `aiService.js`:** Export `executeIntent`:
```js
export { executeIntent }
```

**Handler change — add to `handlePostback`:**
```js
if (action === 'resolve_member') {
  const { familyMemberId, pendingIntent: encodedIntent } = data
  let intent
  try {
    intent = JSON.parse(decodeURIComponent(encodedIntent))
  } catch {
    return reply(client, event.replyToken, 'ไม่สามารถประมวลผลคำสั่งได้')
  }

  intent.familyMemberId = familyMemberId // inject resolved member

  const user = await findOrCreateByLineUserId(lineUserId)
  const familyMembers = await listFamilyMembers(user.id)

  try {
    const result = await executeIntent(intent, user.id, familyMembers)
    return reply(client, event.replyToken, result)
  } catch (err) {
    console.error('[webhook] resolve_member executeIntent failed:', err.message)
    return reply(client, event.replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่')
  }
}
```

**Acceptance criteria:**
- `resolve_member` postback → `executeIntent` called with `familyMemberId` injected
- Reply matches the result of `executeIntent`
- Malformed `pendingIntent` → Thai error message, no crash
- User and family members loaded fresh on postback (not stale from original message)

**Tests to add:**
`famcare-backend/src/tests/handler_ambiguity.test.js`

Use `supertest` + `jest.unstable_mockModule` pattern from `appointment_management.test.js`.

Test cases:
8. POST to `/webhook` with `resolve_member` postback → `executeIntent` called with correct `familyMemberId`
9. `resolve_member` with malformed `pendingIntent` → replies with Thai error, no crash
10. `resolve_member` with valid intent → `reply()` called with `executeIntent` result

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=handler_ambiguity
cd famcare-backend && npm test
```

**Risks:**
- `executeIntent` is currently unexported — this export must be added carefully since it bypasses validation. Document that callers of `executeIntent` directly (postback handlers) are responsible for pre-validation.
- Postback data size: the `pendingIntent` URL-encoded JSON + `familyMemberId` + `action` must fit in 300 bytes LINE limit. Add an assertion in `buildAmbiguityQuickReply` that logs a warning if any item's `postbackData` exceeds 300 chars.

---

## 8. Safe Implementation Order

```
2-A (refactor return type) → 2-B (ambiguity detection + Quick Reply build) → 2-C (postback handler)
```

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| LINE Quick Reply label max 20 chars | Slice member name to 20 chars in `buildAmbiguityQuickReply` |
| LINE Quick Reply max 13 items | Slice `familyMembers` to 13 in `buildAmbiguityQuickReply` |
| Postback data 300-byte limit | Strip `note`/`reason`; add a size assertion with warning log |
| `executeIntent` exported exposes internal function | Document clearly in JSDoc that it assumes a pre-validated intent |
| Memory (Feature 1) — should we save ambiguity prompt to memory? | No — the "question" turn is not saved. Only save the final resolved exchange after the postback executes |
