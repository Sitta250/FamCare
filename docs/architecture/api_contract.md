# FamCare REST API Contract (iOS)

Generated from the code as of this readiness audit. The iOS app is the first (and for now only) client, so every response shape below is what `famcare-backend` returns today.

- Base URL: `https://<host>/api/v1`
- Content types: `application/json` for most endpoints; `multipart/form-data` where noted
- Timezone: all `DateTime` fields are serialized with a **Bangkok offset (`+07:00`)**. Clients may send either `+07:00` or `Z` / UTC when writing — the server normalizes via `toBangkokISO` / Bangkok calendar helpers.
- All JSON responses follow one of two envelopes:
  - Success: `{ "data": <payload> }` (2xx)
  - Error: `{ "error": <message>, "code": <error_code> }` (4xx / 5xx)

> See [`docs/product/prd.md`](../product/prd.md) for product scope and [`docs/execution/READINESS_AUDIT.md`](../execution/READINESS_AUDIT.md) for the feature-to-code matrix.

---

## 1. Auth

Authentication is header-based and is performed by [`requireLineUser`](../../famcare-backend/src/middleware/auth.js) on every `/api/v1/*` route.

| Header | Required | Notes |
|--------|----------|-------|
| `x-line-userid` | **Yes** | LINE user id from LINE Login / LIFF. Missing or blank → `401 { code: "UNAUTHORIZED" }`. |
| `x-line-displayname` | Optional | Used to populate `User.displayName` on first request. |
| `x-line-photourl` | Optional | Used to populate `User.photoUrl` on first request. |

The server auto-creates a `User` row the first time a `lineUserId` appears — no separate signup endpoint.

### CORS

`src/index.js` does not configure CORS. That is intentional for the iOS-first launch: native requests are not subject to the browser same-origin policy. A future web dashboard will need a `cors` middleware and an explicit allow-list.

---

## 2. Error codes

| HTTP | `code` | Meaning |
|------|--------|---------|
| 400 | `BAD_REQUEST` | Missing / invalid input. Also returned for Multer non-size errors. |
| 401 | `UNAUTHORIZED` | Missing `x-line-userid`. |
| 403 | `FORBIDDEN` | Authenticated user has no `FamilyAccess` for the target member. |
| 404 | `NOT_FOUND` | Entity missing or soft-deleted. |
| 413 | `FILE_TOO_LARGE` | Upload > 10 MB. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Upload MIME outside the whitelist. |
| 422 | `INVALID_ACCOMPANIED_USER` | `accompaniedByUserId` has no access to the member. |
| 500 | `INTERNAL_ERROR` | Unhandled — logged server-side. |

---

## 3. Enum reference

Generated from [`prisma/schema.prisma`](../../famcare-backend/prisma/schema.prisma).

| Enum | Values |
|------|--------|
| `AccessRole` | `CAREGIVER`, `VIEWER` |
| `AppointmentStatus` | `UPCOMING`, `COMPLETED`, `CANCELLED`, `MISSED` |
| `ReminderType` | `SEVEN_DAYS`, `TWO_DAYS`, `ONE_DAY`, `TWO_HOURS`, `CUSTOM` |
| `MedicationStatus` | `TAKEN`, `MISSED`, `SKIPPED` |
| `MetricType` | `BLOOD_PRESSURE`, `BLOOD_SUGAR`, `WEIGHT`, `TEMPERATURE`, `CUSTOM` |
| `DocumentType` | `PRESCRIPTION`, `LAB_RESULT`, `DOCTOR_NOTE`, `BILL`, `XRAY`, `OTHER` |
| `ChatMode` | `PRIVATE`, `GROUP` |

Derived (computed server-side, not in Prisma):

| Name | Values |
|------|--------|
| Insurance `status` | `ACTIVE` (>30d), `EXPIRING` (≤30d), `EXPIRED` (<0d), `null` if no `expirationDate` |

---

## 4. Account (PRD §11 + account)

### `GET /me`

Returns the authenticated user. Auto-creates the `User` row if new.

```json
{
  "data": {
    "id": "clx0…",
    "lineUserId": "U1234…",
    "displayName": "Somchai",
    "photoUrl": "https://…",
    "phone": null,
    "chatMode": "PRIVATE",
    "createdAt": "2026-01-10T14:32:00.000+07:00"
  }
}
```

### `PATCH /me`

Body: `{ "chatMode": "PRIVATE" | "GROUP" }`. Invalid value → 400.

### `DELETE /me`

PDPA hard delete. Returns `{ "data": { "deleted": true } }`. Same `lineUserId` can re-auth to a fresh empty account afterwards.

---

## 5. Family members (PRD §1)

### `GET /family-members`

Returns members owned by the caller **plus** members the caller has `FamilyAccess` to.

```json
{ "data": [
  {
    "id": "clx…",
    "ownerId": "clx…",
    "addedById": "clx…",
    "name": "คุณพ่อสมชาย",
    "relation": "father",
    "dateOfBirth": "1955-03-14T00:00:00.000+07:00",
    "bloodType": "B",
    "allergies": "penicillin",
    "conditions": "type-2 diabetes",
    "photoUrl": null,
    "preferredHospital": "Bumrungrad",
    "missedDoseAlertsEnabled": true,
    "createdAt": "2026-01-10T14:32:00.000+07:00",
    "role": "OWNER"
  }
]}
```

`role` is `"OWNER" | "CAREGIVER" | "VIEWER"` — computed from `FamilyAccess`.

### `POST /family-members`

Body:

```json
{
  "name": "คุณพ่อสมชาย",
  "relation": "father",
  "dateOfBirth": "1955-03-14",
  "bloodType": "B",
  "allergies": "penicillin",
  "conditions": "type-2 diabetes",
  "preferredHospital": "Bumrungrad",
  "missedDoseAlertsEnabled": true
}
```

### `GET /family-members/:id`, `PATCH /family-members/:id`, `DELETE /family-members/:id`

- `PATCH` accepts any subset of the create body.
- `DELETE` is a **soft delete** (`isDeleted = true`). Subsequent reads return 404 and lists exclude it.

---

## 6. Family access — coordination (PRD §10)

Mounted at `/api/v1/family-members/:memberId/access`.

### `GET /family-members/:memberId/access`

```json
{ "data": [
  {
    "id": "clx…",
    "grantedByUserId": "clx…",
    "grantedToUserId": "clx…",
    "grantedToLineUserId": "U5678…",
    "grantedToDisplayName": "Somsak",
    "familyMemberId": "clx…",
    "role": "CAREGIVER",
    "notificationPrefs": "{\"appointments\":true,\"medicationReminders\":true,\"healthAlerts\":true}",
    "createdAt": "2026-01-10T14:32:00.000+07:00"
  }
]}
```

### `POST /family-members/:memberId/access`

```json
{
  "grantedToLineUserId": "U5678…",
  "role": "CAREGIVER",
  "notificationPrefs": { "appointments": true, "medicationReminders": true, "healthAlerts": true }
}
```

### `PATCH /family-members/:memberId/access/:grantedToUserId`

Update notification prefs only. Body: `{ "notificationPrefs": { … } }`.

### `DELETE /family-members/:memberId/access/:grantedToUserId`

Revokes access (204).

---

## 7. Appointments (PRD §2)

### `GET /appointments`

Query params (all optional):

| Param | Notes |
|-------|-------|
| `familyMemberId` | Scope to one member. |
| `status` | `AppointmentStatus` enum. |
| `from`, `to` | ISO timestamps. |
| `accompaniedByUserId` | Filter to appts where given user is accompanying. |
| `view` | `upcoming` → auto filters `appointmentAt >= now` and excludes `CANCELLED`. `calendar` → groups by Bangkok calendar date. |

Default `view` returns a flat array. `view=calendar` returns `{ "2026-06-01": [appt, …], "2026-06-04": [appt, …] }`.

Flat response:

```json
{ "data": [
  {
    "id": "clx…",
    "familyMemberId": "clx…",
    "addedByUserId": "clx…",
    "accompaniedByUserId": null,
    "title": "พบแพทย์ตรวจเบาหวาน",
    "appointmentAt": "2026-06-01T10:00:00.000+07:00",
    "doctor": "นพ.สมชาย",
    "hospital": "Bumrungrad",
    "reason": "ติดตามค่าน้ำตาล",
    "preNotes": "งดอาหาร 8 ชม.",
    "postNotes": null,
    "whoBringsNote": "ลูกชาย",
    "reminderOffsetsJson": null,
    "status": "UPCOMING",
    "createdAt": "2026-04-21T09:00:00.000+07:00"
  }
]}
```

### `POST /appointments`

```json
{
  "familyMemberId": "clx…",
  "title": "พบแพทย์ตรวจเบาหวาน",
  "appointmentAt": "2026-06-01T10:00:00+07:00",
  "doctor": "นพ.สมชาย",
  "hospital": "Bumrungrad",
  "reason": "ติดตามค่าน้ำตาล",
  "preNotes": "งดอาหาร 8 ชม.",
  "whoBringsNote": "ลูกชาย",
  "accompaniedByUserId": "clx…",
  "reminderOffsets": ["SEVEN_DAYS", "TWO_DAYS", "ONE_DAY", "TWO_HOURS"]
}
```

Creating / updating an appointment triggers [`syncRemindersForAppointment`](../../famcare-backend/src/services/reminderService.js) which materializes `Reminder` rows for each offset. Background cron (`jobs/cron.js`) picks these up — **no direct reminder HTTP surface** (PRD §3).

### `GET /appointments/:id` / `PATCH /appointments/:id` / `DELETE /appointments/:id`

Standard REST. `PATCH` with `status: "CANCELLED" | "COMPLETED"` stops further reminders.

### `GET /appointments/:id/pre-appointment-report` (PRD §9)

Read-only aggregate for the 14 days preceding the appointment — symptoms, metrics, dose adherence, new medications.

```json
{ "data": {
  "appointmentId": "clx…",
  "memberId": "clx…",
  "window": { "from": "2026-05-18T00:00:00.000+07:00", "to": "2026-06-01T10:00:00.000+07:00" },
  "symptomLogs": [ … ],
  "healthMetrics": [ … ],
  "medicationAdherence": { "taken": 38, "missed": 4, "skipped": 0, "adherenceRate": 0.90 },
  "newMedications": [ … ]
}}
```

---

## 8. Medications (PRD §4)

All endpoints mounted at `/api/v1/medications`.

- `GET /medications?familyMemberId=…&active=true|false` — list
- `POST /medications` — create
- `GET /medications/:id`
- `PATCH /medications/:id`
- `DELETE /medications/:id`
- `GET /medications/:id/schedule` — array of `{ id, timeLocal: "HH:mm" }`
- `PUT /medications/:id/schedule` — body `{ "times": ["08:00", "20:00"] }` (replace whole schedule)
- `GET /medications/:id/logs?from=&to=&limit=&cursor=` — paginated
- `POST /medications/:id/logs` — body `{ "status": "TAKEN" | "MISSED" | "SKIPPED", "takenAt": "2026-04-22T08:05:00+07:00" }`
- `GET /medications/:id/adherence?from=&to=` — `{ "taken": n, "missed": n, "skipped": n, "adherenceRate": 0…1 }`

Create body:

```json
{
  "familyMemberId": "clx…",
  "name": "Metformin",
  "dosage": "500mg",
  "frequency": "twice daily",
  "instructions": "after meal",
  "startDate": "2026-04-01",
  "endDate": null,
  "quantity": 60,
  "lowStockThreshold": 7,
  "reminderTimes": ["08:00", "20:00"]
}
```

Cron jobs fire medication reminders and low-stock alerts using `FamilyAccess.notificationPrefs` as the recipient filter (PRD §10). Missed-dose alerts respect `FamilyMember.missedDoseAlertsEnabled`.

---

## 9. Health metrics (PRD §6)

Mounted at `/api/v1/health-metrics`.

- `GET /health-metrics?familyMemberId=…&type=BLOOD_PRESSURE&from=…&to=…`
- `POST /health-metrics`
- `GET /health-metrics/:id` / `PATCH /health-metrics/:id` / `DELETE /health-metrics/:id`
- `GET /health-metrics/:memberId/thresholds`
- `PUT /health-metrics/:memberId/thresholds/:type` — idempotent upsert
- `DELETE /health-metrics/:memberId/thresholds/:type`

Metric create body (BP uses `value` + `value2`):

```json
{
  "familyMemberId": "clx…",
  "type": "BLOOD_PRESSURE",
  "value": 138,
  "value2": 88,
  "unit": "mmHg",
  "label": "morning",
  "note": "after coffee",
  "measuredAt": "2026-04-22T07:30:00+07:00"
}
```

Threshold upsert body:

```json
{ "unit": "mmHg", "minValue": 90, "maxValue": 140, "minValue2": 60, "maxValue2": 90 }
```

When a metric crosses a threshold, the reminder-dispatch layer pushes alerts to `healthAlerts`-subscribed users.

---

## 10. Documents (PRD §5)

Mounted at `/api/v1/documents`. All writes are multipart.

- `GET /documents?familyMemberId=…&keyword=…&from=…&to=…&date=YYYY-MM-DD` — `date` wins over `from/to` and is interpreted as a Bangkok calendar day.
- `POST /documents` — **multipart** form fields:
  - `familyMemberId` *(required)*
  - `type` *(required)* — one of `DocumentType`
  - `tags` *(optional string)*
  - `file` *(required)* — JPEG / PNG / WebP / HEIC / PDF, ≤ 10 MB

  OCR runs asynchronously after upload (Claude Vision with fallback); response is returned immediately with `ocrText: null` and is populated later.
- `GET /documents/:id`
- `DELETE /documents/:id` — hard delete + Cloudinary cleanup

Response shape:

```json
{ "data": {
  "id": "clx…",
  "familyMemberId": "clx…",
  "addedByUserId": "clx…",
  "type": "PRESCRIPTION",
  "cloudinaryUrl": "https://res.cloudinary.com/…",
  "cloudinaryPublicId": "famcare/documents/…",
  "ocrText": null,
  "tags": "เบาหวาน, metformin",
  "createdAt": "2026-04-22T10:00:00.000+07:00"
}}
```

---

## 11. Symptom & notes log (PRD §7)

Mounted at `/api/v1/symptom-logs`.

- `GET /symptom-logs?familyMemberId=…&limit=&cursor=&from=&to=`
- `POST /symptom-logs` — JSON body below
- `GET /symptom-logs/:id`
- `PATCH /symptom-logs/:id`
- `DELETE /symptom-logs/:id`
- `POST /symptom-logs/:id/photo` — multipart, field `file` (image MIME)
- `POST /symptom-logs/:id/voice-note` — multipart, field `file` (audio MIME)

Create body:

```json
{
  "familyMemberId": "clx…",
  "description": "ปวดหัว คลื่นไส้",
  "severity": 6,
  "note": "เป็นช่วงบ่าย",
  "loggedAt": "2026-04-21T14:00:00+07:00"
}
```

`severity` is an integer **0..10**; out-of-range returns 400.

---

## 12. Emergency info card (PRD §8)

Lives under `/api/v1/family-members/:memberId`.

- `GET /family-members/:memberId/emergency-info` — full structured view (member + contacts + active medications)
- `GET /family-members/:memberId/emergency-card` — condensed, image-shareable payload
- `GET /family-members/:memberId/emergency-contacts`
- `POST /family-members/:memberId/emergency-contacts` — `{ "name": "Dr. Somchai", "phone": "+66812345678", "relation": "Doctor", "sortOrder": 1 }`
- `PATCH /family-members/:memberId/emergency-contacts/:contactId`
- `DELETE /family-members/:memberId/emergency-contacts/:contactId`

`emergency-card` response:

```json
{ "data": {
  "memberId": "clx…",
  "name": "คุณพ่อสมชาย",
  "bloodType": "B",
  "allergies": "penicillin",
  "conditions": "type-2 diabetes",
  "preferredHospital": "Bumrungrad",
  "medications": [ { "id": "clx…", "name": "Metformin", "dosage": "500mg", "frequency": "twice daily" } ],
  "emergencyContacts": [ { "id": "clx…", "name": "Dr. Somchai", "phone": "+66812345678", "relation": "Doctor", "sortOrder": 1, "createdAt": "…", "updatedAt": "…" } ]
}}
```

---

## 13. Insurance cards (PRD §12)

Mounted at `/api/v1/insurance`. Multipart-aware on create/patch.

- `GET /insurance?familyMemberId=…` — **VIEWER** callers receive `policyNumber` masked to `****1234` **unless** the owning card has `allowViewerFullAccess = true`.
- `POST /insurance` — multipart:
  - `familyMemberId` *(required)*
  - Any text field: `companyName`, `policyNumber`, `groupNumber`, `expirationDate`, `policyHolderName`, `dependentRelationship`, `customerServicePhone`, `emergencyPhone`, `coverageType`, `coverageSummary`, `allowViewerFullAccess` (boolean)
  - `frontPhoto` *(optional file)*
  - `backPhoto` *(optional file)*

  Response includes `ocrSuccess` and `extractedFields` alongside `data`:

  ```json
  {
    "data": { "id": "clx…", "companyName": "BUPA Thailand", "policyNumber": "POL123456789", "expirationDate": "2027-06-30T00:00:00.000+07:00", "status": "ACTIVE", … },
    "ocrSuccess": true,
    "extractedFields": { "companyName": "BUPA Thailand", "policyNumber": "POL123456789", … }
  }
  ```

- `GET /insurance/:id`
- `PATCH /insurance/:id` — same multipart fields; clearing / replacing `expirationDate` resets the `reminder60dSent / reminder30dSent / reminder7dSent` flags so a fresh reminder cycle fires.
- `DELETE /insurance/:id` — **soft delete** (`isDeleted = true`).

Cron job `dispatchExpirationReminders` pushes LINE messages 60 / 30 / 7 days out.

---

## 14. Multipart upload summary

| Endpoint | Field(s) | Accept | Size |
|----------|----------|--------|------|
| `POST /documents` | `file` | `image/jpeg, image/png, image/webp, image/heic, application/pdf` | ≤ 10 MB |
| `POST /symptom-logs/:id/photo` | `file` | same image whitelist | ≤ 10 MB |
| `POST /symptom-logs/:id/voice-note` | `file` | `audio/mpeg, audio/mp4, audio/x-m4a, audio/wav, audio/ogg, audio/webm, audio/aac` | ≤ 10 MB |
| `POST /insurance` | `frontPhoto`, `backPhoto` | same image whitelist | ≤ 10 MB each |
| `PATCH /insurance/:id` | `frontPhoto`, `backPhoto` | same image whitelist | ≤ 10 MB each |

Wrong MIME → `415 UNSUPPORTED_MEDIA_TYPE`. Oversized file → `413 FILE_TOO_LARGE`.

---

## 15. Background jobs (no HTTP surface)

Documented here so iOS engineers know what triggers a push they may see:

| Job | Schedule | Trigger |
|-----|----------|---------|
| Appointment reminders (§3) | every minute | `Reminder` rows with `sent = false` and `scheduledAt <= now`. |
| Medication reminders (§4) | every minute | `MedicationSchedule.timeLocal` matches current Bangkok `HH:mm` + `lastSentDate` ≠ today. |
| Missed-dose alerts (§4) | every minute | No `MedicationLog` within the grace window **and** `FamilyMember.missedDoseAlertsEnabled = true`. |
| Low-stock alerts (§4) | every minute | `Medication.quantity <= lowStockThreshold`, idempotent per Bangkok calendar day. |
| Threshold alerts (§6) | on metric create/patch | `MetricThreshold` breach. |
| Insurance expiration (§12) | daily | 60 / 30 / 7-day thresholds, idempotent via `reminder*dSent`. |

Recipients for every push come from [`familyAccessService.getRecipients`](../../famcare-backend/src/services/medicationReminderDispatchService.js) and respect `FamilyAccess.notificationPrefs` JSON:

```json
{ "appointments": true, "medicationReminders": true, "healthAlerts": true }
```

---

## 16. Non-goals for v1 iOS

- No pagination metadata envelope yet — list endpoints return raw arrays. Keep this in mind when adding lazy loading; server-side pagination cursors exist on `symptom-logs` and `medication logs` only.
- No CORS headers. Adding a web client will require updating `src/index.js`.
- No WebSocket / SSE push surface — all real-time notifications go through LINE Messaging / LINE Notify.
- No account linking (yet). A user is one `lineUserId` forever; `DELETE /me` wipes owned data per PDPA.
