# Feature 9: User Onboarding Flow for New Users

> **Implementation order: 9 (last)**

---

## 1. Goal Summary

When a LINE user with zero family members sends any text message, skip Gemini entirely and instead show a two-button Quick Reply: "เพิ่มสมาชิกตอนนี้" (starts a guided add flow) and "เปิดแอป FamCare" (redirects to app). The guided add flow is a multi-step conversation managed via an `OnboardingSession` Prisma model. Existing text message processing is completely bypassed during onboarding.

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/prisma/schema.prisma` | Add `OnboardingSession` model |
| `famcare-backend/src/webhook/handler.js` | Check `OnboardingSession` at top of `handleTextMessage`; handle `onboard_start`, `onboard_app` postbacks |
| `famcare-backend/src/services/familyMemberService.js` | Existing `createFamilyMember(userId, body)` — call to create the member after onboarding |
| `famcare-backend/src/utils/datetime.js` | Use for Thai date parsing validation |

`aiService.js` is NOT modified for onboarding — the `familyMembers.length === 0` check lives in `handler.js`, before `handleAiMessage` is ever called.

---

## 3. Data Model Changes

**New Prisma model:**

```prisma
enum OnboardingStep {
  AWAITING_NAME
  AWAITING_DOB
}

model OnboardingSession {
  id         String          @id @default(cuid())
  lineUserId String          @unique
  step       OnboardingStep
  name       String?
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
}
```

**Migration name:** `add_onboarding_session`

**Notes:**
- `@unique` on `lineUserId` — one active session per user
- `updatedAt` used for the 10-minute abandonment check
- No `familyMemberId` here — not created yet

---

## 4. API Changes

`handleTextMessage` in `handler.js` gains a new routing layer at the top:

```
1. Check if active OnboardingSession exists for this user
   → If yes: route to onboarding handler (skip AI entirely)
2. Check if familyMembers is empty
   → If yes: send onboarding prompt (skip AI)
3. Normal AI flow (handleAiMessage)
```

No new REST routes. No changes to existing `/api/v1` routes.

---

## 5. Frontend Changes

None. LINE Quick Reply and plain text messages only.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| User abandons after 10 min (no activity) | On next message: check `updatedAt` — if `now - updatedAt > 10min`, delete session and restart from two-button prompt |
| User sends random text during `AWAITING_NAME` step | Treat entire message as the name (no validation on name content) |
| User sends unparseable date during `AWAITING_DOB` step | Reply asking for date in specified format; do NOT advance step |
| Date parsing: Thai date "15 มีนาคม 2500" | Convert Buddhist Era year (subtract 543) to CE. "2500 BE" → "1957 CE". The `datetime.js` utility may not handle this — add Thai Buddhist Era parsing logic |
| Thai date "15 มีนาคม 2569" (common for living elders) | 2569 BE → 2026 CE. Check if year > 2400 and subtract 543 |
| `onboard_app` postback | Just reply with a message; no session created |
| User has family members but sends `onboard_start` postback | Session created anyway — guard: skip onboarding start if members already exist |
| `createFamilyMember` fails | Reply error message, delete session |

---

## 7. Implementation Tasks

### Task 9-A: Add `OnboardingSession` Model and Migration

**Purpose:** Create the DB table.

**Files affected:**
- `famcare-backend/prisma/schema.prisma`

**Dependencies:** None

**Schema:**
```prisma
enum OnboardingStep {
  AWAITING_NAME
  AWAITING_DOB
}

model OnboardingSession {
  id         String         @id @default(cuid())
  lineUserId String         @unique
  step       OnboardingStep
  name       String?
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt
}
```

**Acceptance criteria:**
- `prisma migrate dev --name add_onboarding_session` runs without error
- `prisma.onboardingSession` accessible

**Verification:**
```bash
cd famcare-backend && npx prisma migrate dev --name add_onboarding_session && npx prisma generate
```

---

### Task 9-B: Add Thai Date Parsing Helper

**Purpose:** Parse Thai-language date strings (including Buddhist Era years) into UTC `Date` objects.

**Files affected:**
- `famcare-backend/src/utils/datetime.js` — add `parseThaiBuddhistDate(str)`

**Dependencies:** None

**Thai month names → month index:**
```js
const THAI_MONTHS = {
  'มกราคม':1,'กุมภาพันธ์':2,'มีนาคม':3,'เมษายน':4,'พฤษภาคม':5,'มิถุนายน':6,
  'กรกฎาคม':7,'สิงหาคม':8,'กันยายน':9,'ตุลาคม':10,'พฤศจิกายน':11,'ธันวาคม':12
}
```

**Parsing logic:**
```js
export function parseThaiBuddhistDate(str) {
  // Attempt: "15 มีนาคม 2500" or "15/03/2500" or "2500-03-15"
  // For BE years > 2400: subtract 543 to get CE
  // Returns a Date object (UTC) or null if unparseable
}
```

Also accept digit-only formats: `15/3/2569`, `2569-03-15`.

**Acceptance criteria:**
- `parseThaiBuddhistDate('15 มีนาคม 2500')` → Date of March 15, 1957 (CE)
- `parseThaiBuddhistDate('1 มกราคม 2569')` → Date of January 1, 2026 (CE)
- `parseThaiBuddhistDate('15/03/2569')` → Date of March 15, 2026 (CE)
- `parseThaiBuddhistDate('invalid')` → `null`
- CE years (< 2400) are not modified (e.g., `'1990-01-01'` → 1990 CE)

**Tests to add:**
`famcare-backend/src/tests/datetime_thai.test.js`

Test cases:
1. Full Thai month name + BE year → correct CE date
2. Numeric format with BE year → correct CE date
3. ISO format with BE year → correct CE date
4. Invalid string → `null`
5. CE year input (< 2400) → unchanged year
6. Year boundary: 2399 treated as CE, 2400+ treated as BE

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=datetime_thai
```

**Risks:** Buddhist Era conversion assumes all years > 2400 are BE. Living adults in Thailand born in the 1930s–2000s will have BE years 2473–2543 (CE 1930–2000). This range is unambiguous.

---

### Task 9-C: Implement Onboarding Session Handlers

**Purpose:** Create functions to handle each step of the onboarding flow and the trigger logic in `handleTextMessage`.

**Files affected:**
- `famcare-backend/src/webhook/handler.js`

**Dependencies:** Tasks 9-A, 9-B

**New functions to add to `handler.js`:**

```js
// Check and clean up abandoned session (> 10 min)
async function getActiveOnboardingSession(lineUserId) {
  const session = await prisma.onboardingSession.findUnique({ where: { lineUserId } })
  if (!session) return null
  const ageMs = Date.now() - session.updatedAt.getTime()
  if (ageMs > 10 * 60 * 1000) {
    await prisma.onboardingSession.delete({ where: { lineUserId } })
    return null
  }
  return session
}

// Route text message during active onboarding
async function handleOnboardingText(event, user, session) {
  const client = getLineClient()
  const text = event.message.text.trim()

  if (session.step === 'AWAITING_NAME') {
    await prisma.onboardingSession.update({
      where: { lineUserId: user.lineUserId },
      data: { name: text, step: 'AWAITING_DOB' },
    })
    return reply(client, event.replyToken, 'เกิดวันที่เท่าไหร่ครับ? (ตัวอย่าง: 15 มีนาคม 2500)')
  }

  if (session.step === 'AWAITING_DOB') {
    const dob = parseThaiBuddhistDate(text)
    if (!dob) {
      return reply(client, event.replyToken, 'ไม่สามารถอ่านวันเกิดได้ กรุณาลองใหม่ เช่น "15 มีนาคม 2500"')
    }
    try {
      await createFamilyMember(user.id, { name: session.name, dateOfBirth: dob, relation: 'สมาชิก' })
      await prisma.onboardingSession.delete({ where: { lineUserId: user.lineUserId } })
      return reply(client, event.replyToken, `✅ เพิ่ม ${session.name} เรียบร้อยแล้ว ตอนนี้คุณสามารถเริ่มบันทึกข้อมูลสุขภาพได้เลยครับ`)
    } catch (err) {
      await prisma.onboardingSession.delete({ where: { lineUserId: user.lineUserId } }).catch(() => {})
      return reply(client, event.replyToken, 'เกิดข้อผิดพลาดในการเพิ่มสมาชิก กรุณาลองใหม่')
    }
  }
}
```

**Update `handleTextMessage`:**
```js
async function handleTextMessage(event) {
  const client = getLineClient()
  const lineUserId = await guardLineUserId(event, client)
  if (!lineUserId) return

  const user = await findOrCreateByLineUserId(lineUserId)

  // 1. Check for active onboarding session
  const session = await getActiveOnboardingSession(lineUserId)
  if (session) {
    return handleOnboardingText(event, user, session)
  }

  // 2. Check if user has family members
  const familyMembers = await listFamilyMembers(user.id)
  if (familyMembers.length === 0) {
    return sendOnboardingPrompt(client, event.replyToken)
  }

  // 3. Normal AI flow
  let text
  try {
    text = await handleAiMessage(event.message.text, user, familyMembers)
  } catch (err) {
    console.error('[webhook] AI message handling failed:', err.message)
    text = AI_FALLBACK_TEXT
  }

  // Handle structured response (Feature 2 + 3)
  if (typeof text === 'object') {
    // dispatch on type...
  }
  return reply(client, event.replyToken, typeof text === 'string' ? text : text.text)
}

function sendOnboardingPrompt(client, replyToken) {
  return replyWithQuickReply(client, replyToken, 'ยินดีต้อนรับ! กรุณาเพิ่มสมาชิกในครอบครัวเพื่อเริ่มใช้งาน', [
    { label: 'เพิ่มสมาชิกตอนนี้', postbackData: JSON.stringify({ action: 'onboard_start' }) },
    { label: 'เปิดแอป FamCare', postbackData: JSON.stringify({ action: 'onboard_app' }) },
  ])
}
```

**Acceptance criteria:**
- Message from user with `OnboardingSession(step=AWAITING_NAME)` → bot asks for DOB, session updated
- Message from user with `OnboardingSession(step=AWAITING_DOB)`, valid date → `createFamilyMember` called, session deleted, success message
- Message from user with `OnboardingSession(step=AWAITING_DOB)`, invalid date → bot asks again, session NOT advanced
- Session older than 10 min → treated as no session, onboarding prompt shown
- User with 0 family members, no session → onboarding Quick Reply shown
- User with ≥1 family members → normal AI flow

**Tests to add:**
`famcare-backend/src/tests/handler_onboarding.test.js`

Test cases:
1. Text message, 0 family members, no session → Quick Reply with 2 buttons sent
2. Text message, active session `AWAITING_NAME` → DOB question replied, session updated
3. Text message, active session `AWAITING_DOB`, valid Thai date → `createFamilyMember` called, success reply, session deleted
4. Text message, active session `AWAITING_DOB`, invalid date → error reply, session NOT deleted
5. Text message, session `updatedAt` > 10 min ago → session deleted, onboarding prompt shown
6. Text message, ≥1 family members → `handleAiMessage` called (normal flow)

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=handler_onboarding
```

**Risks:**
- `createFamilyMember` requires a `relation` field (schema shows `relation: String` non-nullable). Default to `'สมาชิก'` during onboarding since relation is not collected in the flow.
- `listFamilyMembers` call is added to `handleTextMessage` — previously it was only called inside `handleAiMessage`. This adds one DB query for every text message. Acceptable for this scale.

---

### Task 9-D: Add `onboard_start` and `onboard_app` Postback Handlers

**Purpose:** Create the initial `OnboardingSession` when user taps "เพิ่มสมาชิกตอนนี้", and send the redirect message for "เปิดแอป FamCare".

**Files affected:**
- `famcare-backend/src/webhook/handler.js`

**Dependencies:** Task 9-A, Task 9-C

**Add to `handlePostback`:**
```js
if (action === 'onboard_start') {
  const user = await findOrCreateByLineUserId(lineUserId)
  // Guard: if user already has members, onboarding not needed
  const members = await listFamilyMembers(user.id)
  if (members.length > 0) {
    return reply(client, event.replyToken, 'คุณมีสมาชิกในครอบครัวแล้ว พิมพ์คำถามได้เลยครับ')
  }
  await prisma.onboardingSession.upsert({
    where: { lineUserId },
    create: { lineUserId, step: 'AWAITING_NAME' },
    update: { step: 'AWAITING_NAME', name: null },
  })
  return reply(client, event.replyToken, 'ชื่อสมาชิกที่ต้องการดูแลคือใครครับ?')
}

if (action === 'onboard_app') {
  return reply(client, event.replyToken, 'กรุณาเปิดแอป FamCare เพื่อเพิ่มสมาชิกในครอบครัว หลังจากนั้นกลับมาคุยกับบอทได้เลยครับ')
}
```

**Acceptance criteria:**
- `onboard_start` with 0 members → creates `OnboardingSession(AWAITING_NAME)`, asks for name
- `onboard_start` with existing members → replies message directing to normal use
- `onboard_app` → Thai redirect message

**Tests to add:** (extend `handler_onboarding.test.js`)

Test cases:
7. `onboard_start` postback, 0 members → session created, name question sent
8. `onboard_start` postback, 1+ members → "คุณมีสมาชิกแล้ว" reply, no session created
9. `onboard_app` postback → Thai app redirect message

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=handler_onboarding
cd famcare-backend && npm test
```

---

## 8. Safe Implementation Order

```
9-A (schema) → 9-B (Thai date parser + tests) → 9-C (onboarding session handlers + tests) → 9-D (postback handlers)
```

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| `relation` field is required on `FamilyMember` — spec doesn't mention collecting it | Default to `'สมาชิก'` in onboarding; user can edit via app |
| Buddhist Era date parsing edge cases | Task 9-B covers this with dedicated unit tests |
| Onboarding session check adds DB query per text message | One `findUnique` query — negligible at this scale |
| User has 0 members but sends `onboard_start` twice | `upsert` resets session to `AWAITING_NAME` safely |
| Feature 6 rate limiting: does onboarding count? | No — onboarding bypasses `handleAiMessage` entirely, so rate limit is never checked |
| Feature 1 memory: should onboarding messages be stored? | No — `ConversationMessage` is only written inside `handleAiMessage`, which is bypassed during onboarding |
