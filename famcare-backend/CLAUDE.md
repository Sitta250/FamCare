# CLAUDE.md — FamCare Backend

Agent context for working in this repository. Read this before writing any code.

---

## Project Overview

**FamCare** is a LINE-based family health coordination platform. Thai families use it to track medications, appointments, health metrics, and medical documents for family members. The backend is a REST API consumed by a native iOS app, with a LINE bot for push notifications and quick actions.

**No frontend lives here.** This is backend-only (Express + PostgreSQL).

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 20, ESM modules (`"type": "module"`) |
| Framework | Express.js 4 |
| ORM | Prisma 6 + PostgreSQL |
| Auth | LINE Login — `lineUserId` is the primary user identity |
| LINE Bot | `@line/bot-sdk` v11 — push notifications + webhook |
| Scheduler | `node-cron` v4 — minute-by-minute cron jobs |
| Testing | Jest 29 + supertest (ESM via `--experimental-vm-modules`) |
| Dev server | Nodemon |

---

## Project Structure

```
famcare-backend/
├── prisma/
│   └── schema.prisma          # Single source of truth for all models
├── src/
│   ├── index.js               # Express app entry, server boot
│   ├── lib/
│   │   └── prisma.js          # Prisma client singleton
│   ├── middleware/
│   │   ├── auth.js            # requireLineUser — extracts LINE headers, upserts user
│   │   └── errorHandler.js    # Global error handler
│   ├── routes/
│   │   ├── index.js           # Aggregates all routers under /api/v1
│   │   ├── medications.js
│   │   ├── appointments.js
│   │   ├── healthMetrics.js
│   │   ├── familyMembers.js
│   │   ├── familyAccess.js
│   │   ├── symptomLogs.js
│   │   ├── documents.js
│   │   └── me.js
│   ├── services/              # All business logic lives here — thin routes, fat services
│   │   ├── accessService.js
│   │   ├── medicationService.js
│   │   ├── appointmentService.js
│   │   ├── healthMetricService.js
│   │   ├── symptomLogService.js
│   │   ├── documentService.js
│   │   ├── familyMemberService.js
│   │   ├── familyAccessService.js
│   │   ├── reminderService.js
│   │   ├── reminderDispatchService.js
│   │   ├── medicationReminderDispatchService.js
│   │   ├── linePushService.js
│   │   ├── caregiverNotifyService.js
│   │   ├── userService.js
│   │   ├── emergencyInfoService.js
│   │   ├── preAppointmentReportService.js
│   │   └── ocrService.js
│   ├── jobs/
│   │   └── cron.js            # Registers all cron jobs on startup
│   ├── utils/
│   │   └── datetime.js        # Bangkok timezone helpers (see below)
│   ├── webhook/
│   │   └── handler.js         # LINE webhook event dispatcher
│   └── tests/
│       ├── appointment_management.test.js
│       ├── appointment_reminder.test.js
│       └── family.test.js
```

---

## Authentication

Every REST request must include LINE identity headers. The `requireLineUser` middleware (applied to all `/api/v1` routes) handles this:

```
x-line-userid       → lineUserId (required)
x-line-displayname  → display name (optional, used on first create)
x-line-photourl     → photo URL (optional)
```

- User is **upserted** on every request via `findOrCreateByLineUserId()` in `userService.js`
- `req.user` is the full Prisma `User` record after middleware runs
- The LINE webhook (`/webhook`) uses `@line/bot-sdk` signature verification instead

---

## Access Control

Three roles per family member, enforced in `accessService.js`:

| Role | Who | Can |
|------|-----|-----|
| `OWNER` | User who created the `FamilyMember` | Everything — read, write, delete, manage access |
| `CAREGIVER` | Granted via `FamilyAccess` | Read + write; cannot delete or manage access |
| `VIEWER` | Granted via `FamilyAccess` | Read only |

**Always call these before any data operation:**
```js
import { assertCanReadMember, assertCanWriteMember, assertOwnerForMember } from './accessService.js'

await assertCanReadMember(actorUserId, familyMemberId)   // OWNER | CAREGIVER | VIEWER
await assertCanWriteMember(actorUserId, familyMemberId)  // OWNER | CAREGIVER only
await assertOwnerForMember(actorUserId, familyMemberId)  // OWNER only
```

---

## Error Handling Convention

Throw plain objects with `status` and `code` attached:

```js
throw Object.assign(new Error('name is required'), { status: 400, code: 'BAD_REQUEST' })
throw Object.assign(new Error('Not found'), { status: 404, code: 'NOT_FOUND' })
throw Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
```

The global error handler in `middleware/errorHandler.js` picks up `err.status` and `err.code` and returns:
```json
{ "error": "message", "code": "ERROR_CODE" }
```

**Do not** use `res.status(400).json(...)` directly in routes — always throw and let the handler catch.

---

## Response Shape Convention

```js
res.json({ data: result })           // 200 for GET / PATCH / PUT
res.status(201).json({ data: result }) // 201 for POST (created)
res.status(204).send()               // 204 for DELETE
```

---

## Service Layer Rules

- **Routes are thin.** Parse query/body params, call one service function, return result. No business logic in routes.
- **Services own all logic.** Permission checks, validation, Prisma calls, date formatting, side-effects all go in services.
- **Format dates before returning.** Call `toBangkokISO(date)` on every `DateTime` field before sending to client. Never return raw UTC `Date` objects.
- **Caregiver notifications.** When a caregiver (not owner) creates medication, health metric, or symptom log, call `notifyOwnerIfCaregiver(familyMemberId, actorUserId, message)` — fire-and-forget with `.catch()`.
- **Transactions.** Use `prisma.$transaction(async (tx) => {...})` for multi-step writes. See `updateMedicationSchedule` for the pattern.

---

## Timezone Rules — CRITICAL

All `DateTime` values are stored in UTC. Bangkok is UTC+7, **no DST**.

Use these utilities from `src/utils/datetime.js`:

| Function | Use for |
|----------|---------|
| `toBangkokISO(date)` | Format any DB date for API response (returns `...+07:00` string) |
| `bangkokCalendarDate(date?)` | Get today's `YYYY-MM-DD` in Bangkok (used by cron for idempotency keys) |
| `bangkokClockHm(date?)` | Get current `HH:mm` in Bangkok (used to match `MedicationSchedule.timeLocal`) |
| `utcInstantFromBangkokYmdHm(ymd, hm)` | Convert Bangkok `YYYY-MM-DD` + `HH:mm` → UTC `Date` for Prisma queries |

**Never use `new Date(dateString)` for Bangkok date boundaries** — it interprets bare dates as UTC midnight, which is 7 hours off.

---

## Cron Jobs (`src/jobs/cron.js`)

Two jobs run every minute:

1. **Appointment reminder dispatch** — sends LINE push for due reminders (`sent: false`, `scheduledAt <= now + 5min`)
2. **Medication reminder + missed-dose dispatch** — matches current `HH:mm` Bangkok to `MedicationSchedule.timeLocal`; checks missed doses 2 hours after scheduled time

**Idempotency:** Both jobs use date strings (`lastSentDate`, `lastMissedSentDate`) to prevent duplicate sends per day. Always follow this pattern for new alert types.

---

## LINE Integration

**Push notifications** → `sendLinePushToUser(lineUserId, text)` in `linePushService.js`

**Webhook postback data format** (JSON string in `event.postback.data`):
```json
{ "action": "add_appointment", "familyMemberId": "...", "title": "...", "appointmentAt": "..." }
{ "action": "log_medication", "medicationId": "...", "status": "TAKEN", "takenAt": "..." }
{ "action": "list_appointments", "familyMemberId": "..." }
```

Webhook handler lives in `src/webhook/handler.js`. It:
- Always responds `200` immediately (LINE requires fast ack)
- Processes events after responding
- Calls `findOrCreateByLineUserId(lineUserId)` to resolve LINE user → internal `User.id` before calling any service

---

## Data Models (key relationships)

```
User ──owns──▶ FamilyMember ──has──▶ Medication ──has──▶ MedicationLog
                   │                      └──────────▶ MedicationSchedule
                   ├──has──▶ Appointment ──has──▶ Reminder
                   ├──has──▶ HealthMetric
                   ├──has──▶ SymptomLog
                   ├──has──▶ Document
                   └──has──▶ EmergencyContact

User ──grants──▶ FamilyAccess (role: CAREGIVER | VIEWER) ──for──▶ FamilyMember
```

**Soft delete:** `FamilyMember` uses `isDeleted: Boolean @default(false)`. All other models use hard delete (cascade from parent).

**Cascade:** Deleting a `FamilyMember` cascades to all child records. Deleting a `Medication` cascades to `MedicationLog` and `MedicationSchedule`.

---

## Enum Reference

```
AccessRole:         CAREGIVER | VIEWER
AppointmentStatus:  UPCOMING | COMPLETED | CANCELLED | MISSED
ReminderType:       SEVEN_DAYS | TWO_DAYS | ONE_DAY | TWO_HOURS | CUSTOM
MedicationStatus:   TAKEN | MISSED | SKIPPED
MetricType:         BLOOD_PRESSURE | BLOOD_SUGAR | WEIGHT | TEMPERATURE | CUSTOM
DocumentType:       PRESCRIPTION | LAB_RESULT | DOCTOR_NOTE | BILL | XRAY | OTHER
```

---

## API Routes

Base prefix: `/api/v1`

```
GET/POST   /medications                      — list (query: familyMemberId) / create
GET/PATCH/DELETE /medications/:id
GET/POST   /medications/:id/logs             — dose history / log a dose
GET/PUT    /medications/:id/schedule         — reminder times (HH:mm array)

GET/POST   /appointments                     — list (query: familyMemberId, status, from, to) / create
GET/PATCH/DELETE /appointments/:id
GET        /appointments/:id/pre-appointment-report

GET/POST   /health-metrics                   — query: familyMemberId, type, from, to
GET/PATCH/DELETE /health-metrics/:id

GET/POST   /family-members
GET/PATCH/DELETE /family-members/:id
GET        /family-members/:id/emergency-info
GET/POST/DELETE /family-members/:memberId/access

GET/POST   /symptom-logs                     — query: familyMemberId
GET/PATCH/DELETE /symptom-logs/:id

GET/POST   /documents
GET/DELETE /documents/:id

GET/PATCH  /me

POST       /webhook                          — LINE webhook (no /api/v1 prefix)
```

---

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

**Test files:** `src/tests/*.test.js`

**Pattern** (follow `appointment_management.test.js`):
- Mock `prisma` at the module level with `jest.mock`
- Mock `src/services/linePushService.js` to prevent real LINE calls
- Use `supertest` for HTTP-level tests
- Call `jest.clearAllMocks()` in `beforeEach`
- ESM note: use `jest.unstable_mockModule` for ESM mocks if needed

---

## Common Commands

```bash
npm run dev                                      # start dev server (nodemon)
npm start                                        # production start
npm test                                         # run tests

npx prisma migrate dev --name <migration-name>   # create + apply migration
npx prisma migrate deploy                        # apply in production
npx prisma generate                              # regenerate Prisma client after schema change
npx prisma studio                                # browse DB in browser
```

---

## Environment Variables

```
DATABASE_URL              PostgreSQL connection string (Railway auto-provides)
LINE_CHANNEL_SECRET       For webhook signature verification
LINE_CHANNEL_ACCESS_TOKEN For push/reply messages
PORT                      Server port (default: 3000)
```

Copy `.env.example` → `.env` for local development.

---

## Key Constraints & Decisions

- **Bangkok timezone everywhere.** All user-facing dates must be in `+07:00`. Never return raw UTC.
- **LINE is the only auth provider.** No passwords, no JWT, no sessions.
- **No frontend in this repo.** iOS app and web dashboard are separate.
- **`quantity` on medications is client-managed.** The backend does not auto-decrement when a dose is logged. Clients call `PATCH /medications/:id` to update stock.
- **`missedDoseAlertsEnabled` on `FamilyMember`.** Defaults to `true`. Check this flag before sending missed-dose LINE alerts.
- **PDPA compliance.** `userService.js` has `deleteUserAndData()` for cascading full-account deletion. Respect Thai personal data law in new features.
- **Do not add new npm dependencies** without a clear reason. The dep list is intentionally minimal.
