# FamCare — Backend Test Checklist

> **How to use this:** Test with Bruno. Set a base variable `baseUrl = http://localhost:3000` and `lineUserId = test-user-001`. Check each item, mark ✅ or ❌. Fix before moving to next section.
> 
> **No LINE account yet:** All LINE push notifications will be skipped/logged — that's expected. Test everything else fully.

---

## 0. Setup

Before testing, confirm:
- [ ] Server starts without errors (`npm run dev`)
- [ ] Prisma Studio opens without errors (`npx prisma studio`)
- [ ] `GET /health` returns 200 (no header needed)
- [ ] `GET /api/v1/health` returns 200 (no header needed)
- [ ] Database is reachable (check Railway or local PostgreSQL)

---

## 1. Authentication Middleware

### 1.1 Missing header
- [ ] `GET /api/v1/me` with **no** `x-line-userid` header → `401 { error: 'Missing x-line-userid header', code: 'UNAUTHORIZED' }`

### 1.2 Empty header
- [ ] `GET /api/v1/me` with `x-line-userid: ` (blank/whitespace) → `401`

### 1.3 Valid header — new user auto-created
- [ ] `GET /api/v1/me` with `x-line-userid: test-user-001` → `200`
- [ ] Check Prisma Studio — a `User` row exists with `lineUserId = test-user-001`

### 1.4 Optional profile headers
- [ ] `GET /api/v1/me` with `x-line-userid: test-user-001`, `x-line-displayname: Test User`, `x-line-photourl: https://example.com/photo.jpg` → `200`
- [ ] Check Prisma Studio — `displayName` and `photoUrl` updated on that user

### 1.5 Same user, second request
- [ ] Call `GET /api/v1/me` again with same `lineUserId` → `200`, no duplicate user created in DB

### 1.6 Two different users
- [ ] Call with `x-line-userid: test-user-001` → creates/loads user A
- [ ] Call with `x-line-userid: test-user-002` → creates/loads user B
- [ ] Prisma Studio shows 2 separate `User` rows

---

## 2. Family Members

> Use `x-line-userid: test-user-001` for all owner requests.
> Use `x-line-userid: test-user-002` for caregiver/viewer requests.

### 2.1 Create family member
- [ ] `POST /api/v1/family-members` with valid body → `201`, returns member object
- [ ] Check Prisma Studio — `FamilyMember` row exists, `ownerId` = test-user-001's DB id
- [ ] `addedById` = test-user-001's DB id

### 2.2 Required fields validation
- [ ] `POST /api/v1/family-members` with missing `name` → `400`

### 2.3 List family members
- [ ] `GET /api/v1/family-members` → returns only members owned by test-user-001 (not test-user-002's)

### 2.4 Get single family member
- [ ] `GET /api/v1/family-members/:id` (own member) → `200`
- [ ] `GET /api/v1/family-members/:id` (nonexistent id) → `404`
- [ ] `GET /api/v1/family-members/:id` (another user's member, no access granted) → `403`

### 2.5 Update family member
- [ ] `PUT /api/v1/family-members/:id` (own member) → `200`, fields updated in DB
- [ ] `PUT /api/v1/family-members/:id` (another user's member) → `403`

### 2.6 Delete family member
- [ ] `DELETE /api/v1/family-members/:id` (own member) → `200`
- [ ] Check Prisma Studio — row is gone
- [ ] `DELETE /api/v1/family-members/:id` (already deleted) → `404`
- [ ] `DELETE /api/v1/family-members/:id` (another user's member) → `403`

---

## 3. Family Access (Caregiver / Viewer Invites)

> Owner = test-user-001, Invitee = test-user-002

### 3.1 Grant caregiver access
- [ ] `POST /api/v1/family-members/:id/access` with `{ grantedToLineUserId: 'test-user-002', role: 'CAREGIVER' }` → `201`
- [ ] Check Prisma Studio — `FamilyAccess` row exists with correct `familyMemberId`, `role = CAREGIVER`

### 3.2 Grant viewer access
- [ ] Same as above with `role: 'VIEWER'` → `201`

### 3.3 Invalid role
- [ ] `POST` with `role: 'ADMIN'` → `400`

### 3.4 Duplicate access grant
- [ ] Grant caregiver to test-user-002 twice for same member → second request returns `409` or updates existing row (confirm which behavior, not a silent duplicate)

### 3.5 Caregiver can read granted member
- [ ] As test-user-002: `GET /api/v1/family-members/:id` (the granted member) → `200`

### 3.6 Caregiver cannot read non-granted member
- [ ] As test-user-002: `GET /api/v1/family-members/:otherId` (a different member of test-user-001, no access granted) → `403`

### 3.7 Viewer cannot write
- [ ] Grant test-user-002 as VIEWER on a member
- [ ] As test-user-002: `POST /api/v1/appointments` for that member → `403`

### 3.8 Caregiver can write
- [ ] Grant test-user-002 as CAREGIVER on a member
- [ ] As test-user-002: `POST /api/v1/appointments` for that member → `201`
- [ ] Check Prisma Studio — `addedByUserId` = test-user-002's DB id (not owner's)

### 3.9 Revoke access
- [ ] `DELETE /api/v1/family-members/:id/access/:accessId` (as owner) → `200`
- [ ] As test-user-002: `GET /api/v1/family-members/:id` → `403` (access gone)

### 3.10 Non-owner cannot grant access
- [ ] As test-user-002 (caregiver): try to `POST` access for another user → `403`

---

## 4. Appointments

### 4.1 Create appointment
- [ ] `POST /api/v1/appointments` with valid body → `201`
- [ ] Check Prisma Studio — `Appointment` row exists, `addedByUserId` set correctly
- [ ] Check `Reminder` rows created — should be 4 rows (7d, 2d, 1d, 2h before `appointmentAt`)

### 4.2 Reminder timing correctness
- [ ] Create appointment with `appointmentAt` = 8 days from now
- [ ] Check Prisma Studio `Reminder` table — verify `scheduledAt` values:
  - 7 days before = 1 day from now ✓
  - 2 days before = 6 days from now ✓
  - 1 day before = 7 days from now ✓
  - 2 hours before = 7 days 22 hours from now ✓
- [ ] All reminders have `sent: false`

### 4.3 Required fields
- [ ] `POST` missing `appointmentAt` → `400`
- [ ] `POST` missing `familyMemberId` → `400`
- [ ] `POST` with `familyMemberId` belonging to another user (no access) → `403`

### 4.4 List appointments
- [ ] `GET /api/v1/appointments` → returns only appointments for members the requesting user has access to
- [ ] test-user-002 (caregiver) can see appointments for granted member
- [ ] test-user-002 cannot see appointments for non-granted members

### 4.5 Update appointment
- [ ] `PUT /api/v1/appointments/:id` change `appointmentAt` → `200`
- [ ] Check Prisma Studio — old `Reminder` rows deleted, 4 new ones created with updated times
- [ ] `PUT` by caregiver → `200`, `addedByUserId` still original creator (not overwritten)
- [ ] `PUT` by viewer → `403`

### 4.6 Cancel / complete appointment
- [ ] `PATCH /api/v1/appointments/:id` with `{ status: 'COMPLETED', postNotes: 'All good' }` → `200`
- [ ] `PATCH` with `{ status: 'CANCELLED' }` → `200`
- [ ] `PATCH` with invalid status → `400`

### 4.7 Delete appointment
- [ ] `DELETE /api/v1/appointments/:id` as owner → `200`
- [ ] `DELETE` as caregiver (who added it) → confirm behavior (allowed or owner-only — be consistent)
- [ ] `DELETE` as viewer → `403`

### 4.8 Past appointment reminder edge case
- [ ] Create appointment with `appointmentAt` = 1 hour from now
- [ ] Check Prisma Studio — reminders for 7d, 2d, 1d before should NOT be created (they're in the past), only 2h reminder exists

---

## 5. Medications

### 5.1 Create medication
- [ ] `POST /api/v1/medications` with valid body → `201`
- [ ] Check Prisma Studio — `active: true`, `addedByUserId` set

### 5.2 Required fields
- [ ] Missing `name` → `400`
- [ ] Missing `familyMemberId` → `400`
- [ ] `familyMemberId` with no access → `403`

### 5.3 List medications
- [ ] `GET /api/v1/medications?familyMemberId=:id` → returns active medications only by default
- [ ] Caregiver can list medications for granted member
- [ ] Viewer can list medications for granted member

### 5.4 Deactivate medication
- [ ] `PATCH /api/v1/medications/:id` with `{ active: false }` → `200`
- [ ] Check Prisma Studio — `active: false`
- [ ] Does not appear in default active-only list

### 5.5 Medication log — taken
- [ ] `POST /api/v1/medications/:id/log` with `{ status: 'TAKEN', takenAt: '<now>' }` → `201`
- [ ] Check Prisma Studio — `MedicationLog` row, `loggedByUserId` = requester

### 5.6 Medication log — missed
- [ ] `POST /api/v1/medications/:id/log` with `{ status: 'MISSED', takenAt: '<now>' }` → `201`

### 5.7 Invalid log status
- [ ] `POST` with `{ status: 'FORGOTTEN' }` → `400`

### 5.8 Log for inactive medication
- [ ] Try to log a medication where `active: false` → confirm behavior (`400` or allowed — be consistent)

---

## 6. Health Metrics

### 6.1 Create metric
- [ ] `POST /api/v1/health-metrics` with `{ familyMemberId, type: 'BLOOD_PRESSURE', value: 120, unit: 'mmHg', measuredAt: '<now>' }` → `201`
- [ ] Check all `MetricType` enum values work: `BLOOD_SUGAR`, `WEIGHT`, `TEMPERATURE`, `CUSTOM`

### 6.2 Invalid type
- [ ] `POST` with `type: 'CHOLESTEROL'` (not in enum) → `400`

### 6.3 List metrics
- [ ] `GET /api/v1/health-metrics?familyMemberId=:id` → returns metrics sorted by `measuredAt` descending
- [ ] Filter by type: `GET /api/v1/health-metrics?familyMemberId=:id&type=BLOOD_PRESSURE` → only blood pressure records

### 6.4 Access control
- [ ] Viewer can read metrics → `200`
- [ ] Viewer cannot create metrics → `403`
- [ ] No access → `403`

---

## 7. Documents

### 7.1 Upload document
- [ ] `POST /api/v1/documents` with `familyMemberId`, `type: 'PRESCRIPTION'`, `cloudinaryUrl: 'https://res.cloudinary.com/...'` → `201`
- [ ] Check all `DocumentType` enum values work

### 7.2 Invalid type
- [ ] `POST` with `type: 'SELFIE'` → `400`

### 7.3 List documents
- [ ] `GET /api/v1/documents?familyMemberId=:id` → returns documents, newest first

### 7.4 Delete document
- [ ] `DELETE /api/v1/documents/:id` as owner → `200`
- [ ] `DELETE` as caregiver → confirm behavior (allowed or owner-only)
- [ ] `DELETE` as viewer → `403`

---

## 8. Symptom Logs

### 8.1 Create symptom log
- [ ] `POST /api/v1/symptom-logs` with `{ familyMemberId, description: 'Headache', severity: 7, loggedAt: '<now>' }` → `201`

### 8.2 Severity validation
- [ ] `severity: 0` → `400` (must be 1–10)
- [ ] `severity: 11` → `400`
- [ ] `severity: 10` → `201` (valid boundary)
- [ ] `severity: 1` → `201` (valid boundary)

### 8.3 List symptom logs
- [ ] `GET /api/v1/symptom-logs?familyMemberId=:id` → returns logs sorted by `loggedAt` descending

---

## 9. Reminder / Cron System

> No LINE account yet — push sends will be skipped. Test the scheduling logic only.

### 9.1 Reminder rows created on appointment creation
- [ ] Already covered in section 4.1 and 4.2

### 9.2 Reminder rows updated when appointment time changes
- [ ] Already covered in section 4.5

### 9.3 Cron job runs without crashing
- [ ] Check server logs — every minute you should see a cron tick log (no errors)
- [ ] No unhandled promise rejections in logs when LINE token is missing

### 9.4 Mark reminder as sent (manual test)
- [ ] In Prisma Studio, set a `Reminder.scheduledAt` to 1 minute ago (`sent: false`)
- [ ] Wait for next cron tick (up to 1 minute)
- [ ] Check Prisma Studio — `sent` is now `true`
- [ ] Check server logs — push was attempted (skipped/logged because no LINE token, but no crash)

### 9.5 Sent reminders not re-sent
- [ ] Set a `Reminder` with `sent: true` and `scheduledAt` in the past
- [ ] Wait for cron tick
- [ ] Confirm it is NOT processed again (check logs)

### 9.6 Medication reminder tick
- [ ] In Prisma Studio, set a `MedicationSchedule` time to fire in the next minute
- [ ] Wait for cron tick
- [ ] Check logs — medication reminder attempted, no crash

---

## 10. General Edge Cases

### 10.1 Malformed JSON body
- [ ] `POST` any endpoint with `Content-Type: application/json` but invalid JSON → `400`

### 10.2 Unknown route
- [ ] `GET /api/v1/doesnotexist` → `404`

### 10.3 Wrong HTTP method
- [ ] `DELETE /api/v1/me` (if not implemented) → `404` or `405`

### 10.4 Very long strings
- [ ] `POST /api/v1/family-members` with `name` = 10,000 character string → `400` or truncated gracefully (not a 500)

### 10.5 SQL injection attempt
- [ ] `GET /api/v1/family-members` with header `x-line-userid: ' OR 1=1 --` → should create/load a user with that literal string as lineUserId, not expose other users' data

### 10.6 Server restart persistence
- [ ] Create a family member
- [ ] Stop and restart the server
- [ ] `GET /api/v1/family-members` → data still there (confirms DB persistence, not in-memory)

### 10.7 Concurrent same-user requests
- [ ] Send 3 simultaneous `GET /api/v1/me` requests with same `lineUserId`
- [ ] Check Prisma Studio — only 1 `User` row created (no race condition duplicates)

---

## 11. Pre-Production Checks

These are not functional tests but confirm you're production-ready:

- [ ] `NODE_ENV=production npm start` runs without errors
- [ ] `.env` is in `.gitignore` — confirm secrets are not committed
- [ ] `POST /webhook` without `LINE_CHANNEL_SECRET` set → still returns `200` to LINE (not a 500)
- [ ] `POST /webhook` with wrong signature (when `LINE_CHANNEL_SECRET` is set) → `401`
- [ ] Health endpoint `GET /health` responds in under 200ms (Railway health check will use this)

---

## Quick Bruno Setup

Create these variables in Bruno's environment:
```
baseUrl    = http://localhost:3000
userId1    = test-user-001
userId2    = test-user-002
```

Header template to reuse:
```
x-line-userid: {{userId1}}
Content-Type: application/json
```
