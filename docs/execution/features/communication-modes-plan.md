# Communication Modes — Implementation Plan

**Feature:** Private/Group chat modes, natural Thai language parsing, voice message → Cloudinary
**Target test file:** `famcare-backend/src/tests/communication_mode.test.js`
**Author:** Planning agent
**Date:** 2026-04-15

---

## 1. Goal Summary

Add a `chatMode` setting per user (`PRIVATE` | `GROUP`) that controls whether webhook-triggered
events and cron-based push notifications fan-out to caregivers, or stay scoped to the owner only.
Layer on top: a Thai language NLP parser that converts free-text messages (e.g. "นัดหมอพรุ่งนี้ 10 โมง")
into structured appointment data directly via the LINE chat, and upgrade the audio/voice handler
to download and upload the file to Cloudinary rather than storing a short-lived LINE content URL.

**Four user-visible behaviours to deliver:**

| # | Behaviour | Entry point |
|---|-----------|-------------|
| 1 | Private mode — owner's actions never fan-out to caregiver B (unless B explicitly opted in via prefs *and* chatMode=GROUP) | `getRecipients()`, `dispatchDueReminders()`, webhook fan-out |
| 2 | Group mode — dose missed/appointment reminder → push sent to all caregivers whose `notificationPrefs` opt them in | Same cron services, now gated by `chatMode` |
| 3 | Thai NLP — "นัดหมอ 15 มกราคม บ่าย 2 โมง" parsed into a real `Appointment` row | `handler.js`, new `thaiNlpService.js` |
| 4 | Voice message — audio downloaded from LINE, uploaded to Cloudinary, URL stored on `SymptomLog.voiceNoteUrl` | `handler.js` |

---

## 2. Existing Files / Modules Involved

| File | Relevance |
|------|-----------|
| `prisma/schema.prisma` | Add `ChatMode` enum + `chatMode` field to `User` |
| `src/services/userService.js` | Add `updateChatMode()` helper |
| `src/routes/me.js` | Add `PATCH /me` endpoint to expose `chatMode` setting |
| `src/webhook/handler.js` | Main change surface: Thai NLP routing, chatMode commands, voice Cloudinary upload, new fan-out calls |
| `src/services/thaiNlpService.js` | **New file** — pure Thai intent + datetime parser |
| `src/services/cloudinaryService.js` | `uploadBuffer()` already exists — reuse for voice upload |
| `src/services/caregiverNotifyService.js` | Add `fanoutToFamily()` for webhook-triggered group events |
| `src/services/reminderDispatchService.js` | Gate caregiver recipients behind owner `chatMode=GROUP` |
| `src/services/medicationReminderDispatchService.js` | Same gate in `getRecipients()` |
| `src/utils/datetime.js` | Read-only — use `bangkokCalendarDate()`, `toBangkokISO()` |
| `src/lib/prisma.js` | Read-only singleton |
| `src/tests/communication_mode.test.js` | **New test file** |

---

## 3. Data Model Changes

### 3a. New enum `ChatMode`

```prisma
enum ChatMode {
  PRIVATE
  GROUP
}
```

### 3b. New field on `User`

```prisma
model User {
  // ... existing fields ...
  chatMode    ChatMode  @default(PRIVATE)
}
```

**Migration name:** `add_chat_mode_to_user`

**Why `PRIVATE` as default:**
Opt-in is safer for PDPA compliance. New users start private; they must explicitly switch to GROUP.

**No changes** to `FamilyMember`, `FamilyAccess`, `SymptomLog`, or any other model.
`SymptomLog.voiceNoteUrl` already exists in the schema — the webhook currently writes to the
non-existent `attachmentUrl` field (schema mismatch bug). Task 4 fixes this.

---

## 4. API Changes

### 4a. `PATCH /me` — set chatMode (new endpoint)

```
PATCH /api/v1/me
Headers: x-line-userid: <lineUserId>
Body: { "chatMode": "GROUP" }
Response 200: { "data": { "id": "...", "chatMode": "GROUP", ... } }
```

- Validates `chatMode` is `PRIVATE` or `GROUP`; throws `400 BAD_REQUEST` otherwise
- Delegates to `updateChatMode(userId, chatMode)` in `userService.js`
- Returns full user profile (mirrors existing `GET /me` shape, adding `chatMode` field)

### 4b. `GET /me` — expose `chatMode` in response

Extend existing `GET /me` to include `chatMode` in the returned object.

### 4c. No new webhook API surface

Mode-switching via LINE chat uses the text command "โหมดกลุ่ม" / "โหมดส่วนตัว" handled inside
`handleTextMessage()` — no new HTTP route needed.

---

## 5. Frontend Changes

**None.** This is a backend-only feature. The iOS app may later surface `chatMode` via the
already-added `PATCH /me`, but that is out of scope here.

---

## 6. Edge Cases

| Edge case | Handling |
|-----------|----------|
| Owner has `chatMode=PRIVATE` but caregiver's `notificationPrefs.missedDoseAlerts=true` | Private wins — no push to caregiver |
| Owner switches to `chatMode=GROUP` mid-session; next cron tick fans out | Correct — chatMode is read fresh each cron tick from DB |
| Thai NLP receives garbled text with "นัด" but no parseable date | Falls back to existing "use the app" reply; no appointment created |
| "พรุ่งนี้" evaluated at midnight BKK crosses a date boundary | Use `bangkokCalendarDate()` for "today" baseline, not `new Date()` |
| Thai month without year ("15 มกราคม") | Assume current year; if resulting date is in the past, advance to next year |
| Audio message arrives but `CLOUDINARY_URL` is not set | Graceful fallback: store the raw LINE content URL as before, log a warning |
| Audio message arrives but LINE token is absent (dev mode) | Skip download, store raw URL |
| User has no owned family members when audio arrives | Log and skip (existing behaviour) |
| `chatMode` field missing from old User rows after migration | Prisma default `PRIVATE` applies to all existing rows via `@default(PRIVATE)` |
| Fan-out sends duplicate push (owner is also a caregiver on their own member) | De-duplicate recipients with `Set` as already done in `reminderDispatchService.js` |
| Thai NLP: "นัด" keyword appears but entire intent is uncertain | Return `intent: 'unknown'` if no parseable datetime; webhook replies with usage hint |

---

## 7. Implementation Tasks

---

### Task 1 — Schema: add `ChatMode` enum + `User.chatMode` field

**Purpose:** Introduce the persistent `chatMode` setting so it can be read by cron services and
the webhook handler.

**Likely files affected:**
- `prisma/schema.prisma`
- *(auto-generated)* `prisma/migrations/<timestamp>_add_chat_mode_to_user/migration.sql`

**Dependencies:** None (first task)

**Acceptance criteria:**
1. `schema.prisma` contains `enum ChatMode { PRIVATE GROUP }`
2. `User` model has `chatMode ChatMode @default(PRIVATE)`
3. `npx prisma migrate dev --name add_chat_mode_to_user` runs without errors
4. `npx prisma generate` completes; `PrismaClient.user.create({ data: { chatMode: 'GROUP' } })` is type-valid
5. All existing rows get `chatMode='PRIVATE'` via Prisma default

**Tests to add / run:**
- No unit tests needed for schema; Tasks 5 and 6 exercise this field indirectly
- Verification: `npx prisma db pull` after migration shows the new column

**Verification commands:**
```bash
cd famcare-backend
npx prisma migrate dev --name add_chat_mode_to_user
npx prisma generate
npm test   # existing suite must still pass
```

**Constraints:** No new npm packages. Follow existing Prisma patterns in `schema.prisma`.

**Risks:** Migration on a populated DB adds a nullable-then-filled column — safe because
Prisma writes the default. Confirm `npx prisma migrate status` shows no drift before running.

---

### Task 2 — Service + Route: `updateChatMode` + `PATCH /me`

**Purpose:** Let users (and the webhook text handler) toggle their `chatMode` via REST.

**Likely files affected:**
- `src/services/userService.js` — add `updateChatMode(userId, chatMode)`
- `src/routes/me.js` — add `PATCH /` handler; extend `GET /` to include `chatMode`

**Dependencies:** Task 1 (schema must have `chatMode` column)

**Acceptance criteria:**
1. `PATCH /api/v1/me` with `{ "chatMode": "GROUP" }` returns `200` with updated user object
   containing `chatMode: "GROUP"`
2. `PATCH /api/v1/me` with `{ "chatMode": "INVALID" }` returns `400` with `code: "BAD_REQUEST"`
3. `GET /api/v1/me` response includes `chatMode` field
4. `updateChatMode` throws `400 BAD_REQUEST` for invalid values
5. `updateChatMode` uses `prisma.user.update`, not `upsert`

**Tests to add / run:**
- Add to `src/tests/communication_mode.test.js` (Task 6 creates this file; these cases
  should be included there):
  - `PATCH /me` sets GROUP → 200
  - `PATCH /me` invalid value → 400
- Run: `npm test`

**Verification commands:**
```bash
cd famcare-backend
npm test -- --testPathPattern=communication_mode
```

**Constraints:** Follow existing `me.js` route shape. No new middleware. Throw errors;
do not call `res.status().json()` directly. Return `chatMode` in the same object as existing fields.

**Risks:** `GET /me` currently does not expose `chatMode`; adding it is a non-breaking additive change.

---

### Task 3 — New service: `thaiNlpService.js` — Thai intent + datetime parser

**Purpose:** Pure-function module that parses free-form Thai text into structured intent data
so the webhook can create appointments or switch modes without a Rich Menu.

**Likely files affected:**
- `src/services/thaiNlpService.js` — **new file**

**Dependencies:** None (pure logic, no Prisma, no LINE SDK)

**Return shape:**

```js
// parseIntent(text: string) →
{ intent: 'appointment', data: { title: string, appointmentAt: Date } }
{ intent: 'chatMode',    data: { mode: 'PRIVATE' | 'GROUP' } }
{ intent: 'unknown',     data: {} }
```

**Thai expressions to handle:**

| Expression | Meaning | Notes |
|-----------|---------|-------|
| "นัด", "นัดหมอ", "นัดพยาบาล", "นัดหมาย" | appointment keyword | trigger `appointment` intent |
| "วันนี้" | today | Bangkok calendar date |
| "พรุ่งนี้" | tomorrow | Bangkok calendar date + 1 day |
| "มะรืน" | day after tomorrow | Bangkok calendar date + 2 days |
| Thai month names มกราคม…ธันวาคม + numeric day | explicit date | e.g. "15 มกราคม" |
| "X โมง" | X AM (1-6 = 07:00-12:00, 7-11 = 07:00-11:00) | Thai 6-hour clock AM |
| "บ่าย X โมง" | X PM (บ่าย = afternoon, 1-5 = 13:00-17:00) | Thai 6-hour clock PM |
| "เที่ยง" | noon (12:00) | |
| "เย็น X โมง" | evening X (เย็น = 18:00-20:00 range) | map 1-4 = 18:00-21:00 |
| "โหมดกลุ่ม" | switch to GROUP | `chatMode` intent |
| "โหมดส่วนตัว" | switch to PRIVATE | `chatMode` intent |

**Date disambiguation:** Use `bangkokCalendarDate()` from `utils/datetime.js` as "today" baseline.
If explicit date (e.g. "15 มกราคม") resolves to a past date in current year, advance to next year.
If no date token found but appointment intent detected, set `appointmentAt = null`
(caller decides whether to prompt or use a default).

**Acceptance criteria:**
1. `parseIntent('นัดหมอพรุ่งนี้ 10 โมง')` → `{ intent: 'appointment', data: { title: 'นัดหมอ', appointmentAt: <tomorrow 10:00 BKK> } }`
2. `parseIntent('นัดหมอ 15 มกราคม บ่าย 2 โมง')` → `{ intent: 'appointment', data: { ..., appointmentAt: <Jan 15 14:00 BKK> } }`
3. `parseIntent('โหมดกลุ่ม')` → `{ intent: 'chatMode', data: { mode: 'GROUP' } }`
4. `parseIntent('โหมดส่วนตัว')` → `{ intent: 'chatMode', data: { mode: 'PRIVATE' } }`
5. `parseIntent('สวัสดี')` → `{ intent: 'unknown', data: {} }`
6. `parseIntent('นัด')` with no time/date → `{ intent: 'appointment', data: { title: 'นัด', appointmentAt: null } }`

**Tests to add / run:**
- All 6 acceptance criteria as unit tests in `src/tests/communication_mode.test.js`
- No mocks needed — pure function

**Verification commands:**
```bash
cd famcare-backend
npm test -- --testPathPattern=communication_mode
```

**Constraints:** No new npm packages. No Prisma. No side effects. Uses
`bangkokCalendarDate()` from `../utils/datetime.js` for today's date baseline.

**Risks:** Thai 6-hour clock (นาฬิกาไทย) is ambiguous for times 7-11 (could be AM or PM).
**Decision:** treat bare "X โมง" (without บ่าย/เย็น/เช้า) for X=1-6 as morning (07:00-12:00),
for X=7-11 also morning in standard Thai usage. Add comment explaining this assumption.

---

### Task 4 — Webhook: voice message → Cloudinary upload + `voiceNoteUrl` fix

**Purpose:** Download audio from LINE's content API, upload to Cloudinary, store the
durable Cloudinary URL on `SymptomLog.voiceNoteUrl` (fixing existing schema mismatch:
webhook writes `attachmentUrl` but schema column is `voiceNoteUrl`).

**Likely files affected:**
- `src/webhook/handler.js` — rewrite `handleAudioMessage()`

**Dependencies:** Task 1 (none strictly needed; schema field `voiceNoteUrl` already exists)

**Implementation details:**

```
1. Call LINE getMessageContent API:
   GET https://api-data.line.me/v2/bot/message/{messageId}/content
   Authorization: Bearer {LINE_CHANNEL_ACCESS_TOKEN}
   → Returns binary stream

2. Read stream into Buffer

3. Call uploadBuffer(buffer, { folder: 'famcare/voice', resourceType: 'video', originalname: `${messageId}.m4a` })
   (LINE audio is AAC/M4A; Cloudinary resource_type 'video' handles audio)

4. Store result.secure_url on SymptomLog.voiceNoteUrl
   (not attachmentUrl — schema column is voiceNoteUrl)
```

**Fallback:** If `LINE_CHANNEL_ACCESS_TOKEN` is absent OR `CLOUDINARY_URL` is absent,
skip the download/upload and store the raw LINE content URL in `voiceNoteUrl` instead.
Log a `[webhook] voice upload skipped: missing token/cloudinary config` warning.

**HTTP download pattern** (no new package — use built-in `fetch` available in Node.js ≥ 18):
```js
const response = await fetch(contentUrl, {
  headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
})
const arrayBuffer = await response.arrayBuffer()
const buffer = Buffer.from(arrayBuffer)
```

**Acceptance criteria:**
1. When both `LINE_CHANNEL_ACCESS_TOKEN` and `CLOUDINARY_URL` are set, `handleAudioMessage()`
   calls `uploadBuffer()` and stores `result.secure_url` on `SymptomLog.voiceNoteUrl`
2. Stored field is `voiceNoteUrl`, NOT `attachmentUrl`
3. When token/cloudinary absent, raw LINE content URL is stored on `voiceNoteUrl` (graceful fallback)
4. Bot replies `🎤 รับบันทึกเสียงแล้ว ...` regardless of upload success
5. No unhandled promise rejections if upload fails — catch and log, still reply to user

**Tests to add / run:**
- In `src/tests/communication_mode.test.js`:
  - Mock `fetch` + `cloudinaryService.uploadBuffer`; verify `prisma.symptomLog.create` called with `voiceNoteUrl` = cloudinary URL
  - Mock with no token; verify fallback stores raw LINE URL on `voiceNoteUrl`
- Run: `npm test -- --testPathPattern=communication_mode`

**Verification commands:**
```bash
cd famcare-backend
npm test -- --testPathPattern=communication_mode
```

**Constraints:** No new npm packages — use Node.js built-in `fetch`. Follow existing
`uploadBuffer` signature in `cloudinaryService.js`. No change to Prisma schema.

**Risks:** `fetch` is available globally in Node.js ≥ 18 (CLAUDE.md states Node ≥ 20). ✓
LINE audio content URL expires after 30 days — Cloudinary URL is permanent. This is
the primary motivator for the upload step.

---

### Task 5 — Fan-out gating: respect `chatMode` in cron services + webhook group fan-out

**Purpose:** Make caregiver notifications conditional on the family member owner's `chatMode`.
In `PRIVATE` mode, only the owner receives pushes. In `GROUP` mode, caregivers receive
pushes filtered by their `notificationPrefs` (existing behaviour). Also add webhook-triggered
fan-out when a user creates an appointment via Thai NLP in GROUP mode.

**Likely files affected:**
- `src/services/medicationReminderDispatchService.js` — modify `getRecipients()` to gate caregivers
- `src/services/reminderDispatchService.js` — modify `dispatchDueReminders()` recipient loop
- `src/services/caregiverNotifyService.js` — add `fanoutToFamily(familyMemberId, actorUserId, messageText, eventType)`
- `src/webhook/handler.js` — call `fanoutToFamily()` after successful appointment creation via NLP

**Implementation details:**

#### 5a. `getRecipients()` in `medicationReminderDispatchService.js`

Add owner's `chatMode` to the select:
```js
select: {
  missedDoseAlertsEnabled: true,
  owner: { select: { lineUserId: true, chatMode: true } },
  accessList: { ... }
}
```

Then gate caregiver loop:
```js
const recipients = [member.owner.lineUserId]  // owner always receives
if (member.owner.chatMode === 'GROUP') {
  for (const a of member.accessList) {
    const prefs = parseNotificationPrefs(a.notificationPrefs)
    if (prefs[eventType]) recipients.push(a.grantedTo.lineUserId)
  }
}
```

#### 5b. `dispatchDueReminders()` in `reminderDispatchService.js`

Add `chatMode: true` to `owner` select. Wrap the caregiver loop in `if (familyMember.owner.chatMode === 'GROUP')`.

#### 5c. `fanoutToFamily()` in `caregiverNotifyService.js`

New exported function:
```js
export async function fanoutToFamily(familyMemberId, actorUserId, messageText, eventType = 'appointmentReminders')
```

- Fetches `FamilyMember` with `owner.chatMode`, `owner.lineUserId`, and
  `accessList` (role=CAREGIVER, notificationPrefs, grantedTo.lineUserId)
- If `owner.chatMode !== 'GROUP'`: return early (no fan-out)
- Collect recipients: skip `actorUserId` (they triggered the event), include owner unless actor
  is owner, include caregivers filtered by `notificationPrefs[eventType]`
- Send push to each recipient fire-and-forget via `.catch()`

#### 5d. Webhook handler wires in `fanoutToFamily()`

After `createAppointment()` succeeds in the Thai NLP path, add:
```js
fanoutToFamily(member.id, user.id, `📅 ${user.displayName} เพิ่มนัดหมาย "${appt.title}"`, 'appointmentReminders').catch(() => {})
```

**Acceptance criteria:**
1. `getRecipients()` with owner `chatMode='PRIVATE'` returns only `[owner.lineUserId]`
2. `getRecipients()` with owner `chatMode='GROUP'` returns owner + opted-in caregivers
3. `dispatchDueReminders()` with owner `chatMode='PRIVATE'` sends push to owner only
4. `fanoutToFamily()` with `chatMode='PRIVATE'` calls `sendLinePushToUser` zero extra times
5. `fanoutToFamily()` with `chatMode='GROUP'` and caregiver opted in → push sent to caregiver
6. Actor excluded from fan-out recipients

**Tests to add / run:**
- All 6 acceptance criteria covered in `src/tests/communication_mode.test.js`
  - "Private mode: action by user A does not notify user B even if B has access"
  - "Group fan-out: dose missed → all opted-in caregivers receive push"
- Run: `npm test`

**Verification commands:**
```bash
cd famcare-backend
npm test
```

**Constraints:** Do not change the function signatures of `getRecipients` or `dispatchDueReminders`
(they have no external callers other than cron). `fanoutToFamily` is a new export. No new packages.

**Risks:** `chatMode` default is `PRIVATE` — existing tests that assert caregivers receive
reminders will break unless test data sets `chatMode: 'GROUP'`. **Action:** update all
existing test fixtures that include caregiver recipients to set `owner.chatMode = 'GROUP'`.
Scope the fix to test fixture data, not production logic.

---

### Task 6 — Webhook handler: Thai NLP routing + chatMode command handling

**Purpose:** Wire `thaiNlpService.parseIntent()` into `handleTextMessage()` so users can
create appointments and switch modes from the LINE chat. Also integrate `fanoutToFamily()`
for appointment creation.

**Likely files affected:**
- `src/webhook/handler.js` — rewrite `handleTextMessage()`

**Dependencies:** Task 2 (chatMode on User), Task 3 (thaiNlpService), Task 5 (fanoutToFamily)

**New `handleTextMessage()` flow:**

```
1. parseIntent(text)

2. if intent === 'chatMode':
     user = findOrCreateByLineUserId(lineUserId)
     updateChatMode(user.id, data.mode)
     reply("✅ เปลี่ยนเป็นโหมด...")

3. if intent === 'appointment':
     if data.appointmentAt === null:
       reply("📅 กรุณาระบุวันและเวลาของนัดหมาย เช่น 'นัดหมอพรุ่งนี้ 10 โมง'")
     else:
       user = findOrCreateByLineUserId(lineUserId)
       member = first owned family member (same lookup as audio handler)
       if no member: reply("กรุณาเพิ่มสมาชิกในครอบครัวก่อน")
       else:
         appt = createAppointment(user.id, { familyMemberId: member.id, title, appointmentAt })
         reply("✅ เพิ่มนัดหมาย ...")
         fanoutToFamily(member.id, user.id, ...).catch()

4. if intent === 'unknown':
     reply("สวัสดี! ส่ง 'นัดหมอพรุ่งนี้ 10 โมง' เพื่อเพิ่มนัดหมาย\nหรือ 'โหมดกลุ่ม'/'โหมดส่วนตัว' เพื่อตั้งค่าการแจ้งเตือน")
```

**Acceptance criteria:**
1. "นัดหมอ 15 มกราคม บ่าย 2 โมง" → `createAppointment` called with correct `appointmentAt`
2. "โหมดกลุ่ม" → `updateChatMode` called with `'GROUP'`; bot replies confirmation
3. Unknown text → bot replies with usage hint (no appointment created)
4. Appointment intent with no parseable datetime → bot prompts user for date/time
5. Appointment created → `fanoutToFamily` called (fire-and-forget)
6. Old "นัด" keyword still triggers appointment intent (regression-safe)

**Tests to add / run:**
- In `src/tests/communication_mode.test.js` (webhook integration section):
  - Thai text parsing → appointment created (mock `createAppointment`)
  - `updateChatMode` called for mode commands
  - Unknown intent reply
- Run: `npm test`

**Verification commands:**
```bash
cd famcare-backend
npm test -- --testPathPattern=communication_mode
```

**Constraints:** Keep `handlePostback()` and `handleAudioMessage()` untouched (unless fixing
`voiceNoteUrl` bug from Task 4). Follow existing fire-and-forget `.catch()` pattern.

**Risks:** `createAppointment()` requires `familyMemberId` — if user has no owned member,
we must reply gracefully instead of throwing. Guard this explicitly.

---

### Task 7 — Tests: `src/tests/communication_mode.test.js`

**Purpose:** Write all required test cases. Tests should run against unit-level mocks
(no real DB, no real LINE, no real Cloudinary) following existing patterns from
`family_coordination.test.js`.

**Likely files affected:**
- `src/tests/communication_mode.test.js` — **new file**

**Dependencies:** Tasks 1–6 (all implementation must exist for tests to pass)

**Test cases to cover:**

```
describe('PATCH /me — chatMode')
  ✓ sets chatMode to GROUP returns 200 with updated profile
  ✓ invalid chatMode value returns 400

describe('thaiNlpService — parseIntent')
  ✓ "นัดหมอพรุ่งนี้ 10 โมง" → appointment intent, correct appointmentAt
  ✓ "นัดหมอ 15 มกราคม บ่าย 2 โมง" → appointment intent, Jan 15 14:00 BKK
  ✓ "โหมดกลุ่ม" → chatMode intent, mode GROUP
  ✓ "โหมดส่วนตัว" → chatMode intent, mode PRIVATE
  ✓ "สวัสดี" → unknown intent

describe('Private mode — no fan-out')
  ✓ getRecipients() with chatMode=PRIVATE returns only owner, not caregiver with opted-in prefs
  ✓ dispatchDueReminders() with chatMode=PRIVATE → sendLinePushToUser called once (owner only)
  ✓ fanoutToFamily() with chatMode=PRIVATE → sendLinePushToUser NOT called for caregiver

describe('Group fan-out — dose missed')
  ✓ getRecipients() with chatMode=GROUP and caregiver missedDoseAlerts=true → caregiver included
  ✓ dispatchDueReminders() with chatMode=GROUP → caregiver push sent

describe('Voice message → Cloudinary')
  ✓ audio event with token+cloudinary → uploadBuffer called, SymptomLog.create with voiceNoteUrl=cloudinaryUrl
  ✓ audio event without token → fallback stores raw LINE URL on voiceNoteUrl (not attachmentUrl)

describe('Thai NLP webhook routing')
  ✓ "นัดหมอพรุ่งนี้ 10 โมง" text message → createAppointment called with parsed datetime
  ✓ unknown intent text → reply contains usage hint, createAppointment NOT called
  ✓ "โหมดกลุ่ม" text → updateChatMode called with GROUP
```

**Mock modules (following `family_coordination.test.js` pattern):**
```js
jest.unstable_mockModule('../lib/prisma.js', ...)
jest.unstable_mockModule('../services/linePushService.js', ...)
jest.unstable_mockModule('../services/cloudinaryService.js', ...)
jest.unstable_mockModule('../services/appointmentService.js', ...)
jest.unstable_mockModule('../services/userService.js', ...)
// global fetch mock: jest.spyOn(global, 'fetch').mockResolvedValue(...)
```

**Acceptance criteria:**
1. `npm test` exits 0
2. All 16 test cases above are present and passing
3. No real DB, LINE, or Cloudinary calls
4. `jest.clearAllMocks()` in `beforeEach`

**Verification commands:**
```bash
cd famcare-backend
npm test
# must show 0 failures, all communication_mode tests pass
```

**Constraints:** No new npm packages. ESM mocks via `jest.unstable_mockModule`. Follow
exact `describe/test` naming used in `family_coordination.test.js`. If any test requires
a real migration (Task 1) to have run, mock Prisma instead.

**Risks:** `thaiNlpService` tests need a reliable "today" — inject `bangkokCalendarDate`
via a controlled mock or pass the current date as a parameter to `parseIntent()` for
testability. Consider adding an optional second argument `parseIntent(text, now = new Date())`
to make date-relative parsing deterministic in tests.

---

## 8. Safest Implementation Order

```
Task 1 → Task 3 → Task 2 → Task 4 → Task 5 → Task 6 → Task 7
```

**Rationale:**

| Step | Why this order |
|------|---------------|
| Task 1 first | Schema migration must exist before any service reads `chatMode` |
| Task 3 second | Pure function with zero dependencies — can be developed and unit-tested in isolation before wiring into the webhook |
| Task 2 third | `updateChatMode()` and `PATCH /me` needed before the webhook handler uses them |
| Task 4 fourth | Voice fix is self-contained; can be merged independently |
| Task 5 fifth | Fan-out gating reads `chatMode` from DB (Task 1 required) and `fanoutToFamily` needed by Task 6 |
| Task 6 sixth | Wires everything together in `handler.js` |
| Task 7 last | Tests validate all previous tasks; no point writing them before the implementation exists |

Tasks 3 and 4 have no cross-dependency and can be worked on in parallel.

---

## 9. Global Risks and Ambiguities

### Risk 1 — Existing tests will break after Task 5

**Problem:** Several existing tests in `family_coordination.test.js`,
`appointment_reminder.test.js`, and `medication_dispatch.test.js` likely set up mock data
where the owner sends push notifications to caregivers. After Task 5, those tests need
`owner.chatMode = 'GROUP'` in their fixture data or the assertions will fail (push count drops
from 2 to 1).

**Mitigation:** When implementing Task 5, run `npm test` immediately and fix any existing tests
whose fixture data needs `chatMode: 'GROUP'` added. Do **not** change the production logic;
only update fixture objects in test files.

---

### Risk 2 — `attachmentUrl` vs `voiceNoteUrl` schema mismatch

**Problem:** `handler.js` line 172 writes `attachmentUrl: contentUrl` but `SymptomLog` in
`schema.prisma` has no `attachmentUrl` column — the column is `voiceNoteUrl`. Prisma will
silently ignore unknown fields at runtime in some configurations, or throw in strict mode.

**Mitigation:** Task 4 explicitly fixes this by using `voiceNoteUrl`. No separate migration
needed — the schema field already exists.

---

### Risk 3 — Thai 6-hour clock ambiguity

**Problem:** "7 โมง" in Thai can mean 07:00 (เช้า/morning) or 13:00 (บ่าย). Without the
prefix, the parser must make an assumption.

**Decision:** Assume morning for bare "X โมง" (13:00 would say "บ่าย 1 โมง"). Document
this in `thaiNlpService.js`. If the user sends "นัดหมอ 7 โมง" and gets a 07:00 appointment
when they meant 13:00, they can correct it via the app.

---

### Risk 4 — Private mode semantics: "unless B opted in"

**Problem:** The feature description says "private mode: user A's actions don't notify B
*unless B opted in*". This is ambiguous — does `notificationPrefs` override `chatMode`?

**Decision:** `chatMode` takes precedence. If owner is `PRIVATE`, no caregiver receives push
regardless of their `notificationPrefs`. The `notificationPrefs` filtering layer only applies
when `chatMode='GROUP'`. This is the simpler, safer interpretation (PDPA-aligned). Document
this decision in `caregiverNotifyService.js` with a comment.

---

### Risk 5 — `PATCH /me` missing from CLAUDE.md route table

**Problem:** `CLAUDE.md` lists `GET/PATCH /me` in the route table, but the current `me.js`
only has `GET` and `DELETE`. Task 2 adds `PATCH` — this is consistent with the documented
contract but needs implementation.

**Mitigation:** This is expected; CLAUDE.md documents the intended API surface.

---

### Risk 6 — No Claude API / external NLP dependency

**Problem:** The feature brief mentions "call Claude API" as one option for Thai NLP. The
CLAUDE.md constraint says "do not add new npm dependencies without a clear reason."

**Decision:** Implement as a pure regex/keyword parser (Task 3). This covers all required
test cases without adding `@anthropic-ai/sdk` or any HTTP client dependency. If richer NLP
is needed later, `thaiNlpService.js` can be swapped out behind the same interface.

---

## 10. Output File

This document is saved at:

```
docs/execution/features/communication-modes-plan.md
```

The executing agent should work through Tasks 1–7 in the order given in Section 8, running
`npm test` after each task before proceeding to the next.
