# FamCare Backend — Complete Work & Test Plan

## Current Status
- [x] Feature 1: Family Member Profiles — implemented + tested
- [x] Deployment: Railway live at famcare-backend-production.up.railway.app
- [x] LINE webhook: connected, receiving messages, replying
- [x] LINE push: confirmed working with real userId

---

## Immediate Fixes (do before anything else)
- [ ] Fix reminder cron 400 error: look up lineUserId from User table before push, skip with warning if not found
- [ ] Remove test push route (POST /api/v1/test/push) after push is confirmed working

---

## LLM Phase 1 — Basic Conversation (do this right after immediate fixes)
**Goal:** Make the bot respond intelligently to any message while features are being built.
**Model:** Gemini 2.0 Flash (free tier, 1500 requests/day)
**Package:** @google/generative-ai
**Env var to add:** GEMINI_API_KEY=your_key_here

**Implementation:**
- In webhook handler, when a text message event is received, call Gemini 2.0 Flash
- Use this system prompt:
  "You are FamCare, a Thai family health assistant. Help users manage medications, appointments, and health records for their elderly family members. Respond in Thai if the user writes in Thai, English if they write in English. Keep responses concise and friendly."
- Send Gemini's reply back via LINE reply message
- Fallback: if Gemini call fails, reply with "ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง"

**Tell Cursor:**
> Add Gemini 2.0 Flash (gemini-2.0-flash) as the LLM for the webhook handler. Use the @google/generative-ai npm package. When a user sends a text message to the LINE bot, call Gemini with the message and the system prompt above. Send the reply back via LINE reply message. If the Gemini call fails, send a fallback Thai error message.

**Verify:**
- [ ] Send "hello" to bot → gets intelligent English reply
- [ ] Send "สวัสดี" to bot → gets Thai reply
- [ ] Gemini failure → fallback message sent, not a crash

---

## Feature 2 — Appointment Management
**Routes:** POST /api/v1/appointments, GET /api/v1/appointments?memberId=&view=upcoming|calendar, PATCH /api/v1/appointments/:id, DELETE /api/v1/appointments/:id

**Service (appointmentService.js):** createAppointment, listAppointments, updateAppointment, cancelAppointment, markCompleted

**Schema fields:** familyMemberId, datetime (UTC), doctor, hospital, reason, preNotes, postNotes, status (SCHEDULED/COMPLETED/CANCELLED), addedByUserId

**On create:** auto-generate 4 Reminder rows at T-7d, T-2d, T-1d, T-2h
**On reschedule:** recalculate and update all Reminder rows

**Tests (src/tests/appointments.test.js):**
- [ ] POST creates appointment → 4 Reminder rows created at correct UTC times
- [ ] Reschedule → Reminder rows recalculated
- [ ] GET ?view=upcoming → future non-cancelled only, sorted ascending
- [ ] GET ?view=calendar → grouped by date
- [ ] Mark completed with postNotes → status + notes saved
- [ ] Cancel → status CANCELLED, reminders not fired
- [ ] Auth: user cannot access another family's appointments

---

## Feature 3 — Smart Appointment Reminders
**Implementation:** Cron job every 5 min, query Reminder rows where scheduledAt <= now+5min, status=PENDING, appointment.status=SCHEDULED → send LINE push → mark SENT

**Tests (src/tests/reminders.test.js):**
- [ ] Cron only sends PENDING reminders within window
- [ ] Already-SENT reminders not re-sent (idempotency)
- [ ] Cancelled appointment reminders skipped
- [ ] Custom timing: set [3d, 1d] offsets → only 2 Reminder rows created
- [ ] LINE push delivers correctly (verify in Railway logs)

---

## Feature 4 — Medication Tracking
**Routes:** POST /api/v1/medications, GET /api/v1/medications?memberId=, PATCH /api/v1/medications/:id, POST /api/v1/medications/:id/doses, POST /api/v1/medications/:id/dosage-change

**Service (medicationService.js):** createMedication, getDurationString, logDosageChange, confirmDose, checkMissedDoses (cron), refillCheck (cron)

**Schema:** Medication → MedicationDosageHistory (one-to-many), DoseLog (one-to-many)

**Fields:** name (Thai+English), dosage, frequency, startDate, endDate, instructions, photoUrl, quantity

**Tests (src/tests/medications.test.js):**
- [ ] Create medication → duration string correct at day 0, day 30, day 90
- [ ] Dosage change → history row created, current dosage updated, old history preserved
- [ ] GET medications → returns full dosage history array per medication
- [ ] Tap-to-confirm dose → DoseLog created for correct scheduled time
- [ ] Missed dose: no DoseLog after buffer → caregiver LINE push fires
- [ ] Refill: quantity reaches threshold → refill reminder fires
- [ ] endDate in past → medication shown as inactive

---

## Feature 5 — Health Documentation
**Routes:** POST /api/v1/documents (multipart), GET /api/v1/documents?memberId=&keyword=&date=, DELETE /api/v1/documents/:id

**Service (documentService.js):** upload to Cloudinary, run OCR (tesseract.js or Google Vision), store extractedText, search

**Tests (src/tests/documents.test.js):**
- [ ] Upload image → Cloudinary URL stored, OCR text extracted
- [ ] Search by keyword → matches extractedText
- [ ] Search by date → correct filtering
- [ ] Search by member → scoped correctly
- [ ] Thai OCR: Thai characters extracted correctly
- [ ] File >10MB → rejected with 413

---

## Feature 6 — Health Metrics Logging
**Routes:** POST /api/v1/metrics, GET /api/v1/metrics?memberId=&type=&from=&to=

**Service:** createMetric, listMetrics, flagAbnormal

**Types:** BLOOD_PRESSURE, BLOOD_SUGAR, WEIGHT, TEMPERATURE, CUSTOM

**Tests (src/tests/metrics.test.js):**
- [ ] Log blood pressure → stored with correct UTC timestamp
- [ ] GET with date range → correct filtering
- [ ] Abnormal value (systolic >140) → isAbnormal: true in response
- [ ] Custom metric type → stored with label
- [ ] Trend data array returned correctly for graphing

---

## Feature 7 — Symptom & Notes Log
**Routes:** POST /api/v1/symptoms, GET /api/v1/symptoms?memberId=&from=&to=

**Service:** createSymptomLog, listSymptomLogs

**Fields:** text, severity (1-10), photoUrl, voiceNoteUrl, memberId, loggedAt

**Tests (src/tests/symptoms.test.js):**
- [ ] Create entry with text + severity → stored correctly
- [ ] Create with photo → Cloudinary URL stored
- [ ] GET returns chronological timeline
- [ ] Severity 0 or 11 → 400
- [ ] Voice note upload → URL stored

---

## LLM Phase 2 — Intent-Based Actions (do this after Feature 7)
**Goal:** Upgrade Gemini integration so natural language triggers real backend actions.
**Model:** Still Gemini 2.0 Flash

**Intents to handle:**

| User says | Action |
|-----------|--------|
| "นัดหมอพรุ่งนี้ 10 โมง" | appointmentService.createAppointment |
| "กินยาแล้ว" | medicationService.confirmDose |
| "ปวดหัวนิดหน่อย" | symptomService.createSymptomLog |
| "ยาเหลือน้อยแล้ว" | medicationService.refillCheck |
| "แสดงนัดหมอ" | appointmentService.listAppointments |
| Unknown intent | Fall back to general Gemini conversation |

**Implementation:**
- Send user message to Gemini with a structured prompt that asks it to return JSON with intent + extracted fields
- Parse the JSON response and call the matching service
- Send confirmation back to user in Thai
- If JSON parsing fails or intent is unknown → fall back to conversational reply

**Tell Cursor:**
> Upgrade the Gemini webhook integration to detect intent and call backend services. Send the user message to Gemini with a system prompt that asks it to respond ONLY in JSON format: { "intent": "CREATE_APPOINTMENT|CONFIRM_DOSE|LOG_SYMPTOM|LIST_APPOINTMENTS|UNKNOWN", "data": { ...extracted fields } }. Based on the intent, call the matching service and send a Thai confirmation back to the user. If intent is UNKNOWN or JSON parsing fails, fall back to a normal conversational Gemini reply.

**Tests:**
- [ ] "นัดหมอ 15 มกราคม บ่าย 2 โมง" → appointment created with correct datetime
- [ ] "กินยาแล้ว" → DoseLog created for today
- [ ] "ปวดหัว ระดับ 3" → SymptomLog created with severity 3
- [ ] Unknown message → conversational reply, no crash
- [ ] Gemini returns malformed JSON → fallback to conversation, no crash

---

## Feature 8 — Emergency Info Card
**Routes:** GET /api/v1/family/:id/emergency-card, POST/PATCH/DELETE /api/v1/family/:id/emergency-contacts

**Service:** aggregates allergies, conditions, active medications, emergency contacts, blood type, preferred hospital

**Tests (src/tests/emergencyCard.test.js):**
- [ ] Returns all fields populated correctly
- [ ] Only active (non-ended) medications appear
- [ ] No medications → empty array, not error
- [ ] Emergency contacts CRUD works correctly

---

## Feature 9 — Pre-Appointment Report
**Routes:** GET /api/v1/appointments/:id/report

**Service (reportService.js):** aggregate symptoms since last visit, medication adherence %, health metric trends, suggested questions, generate PDF via pdfkit

**Tests (src/tests/report.test.js):**
- [ ] Report with full history → all sections populated
- [ ] No prior symptoms → empty array, not error
- [ ] PDF endpoint returns valid PDF binary
- [ ] Adherence: 20/25 expected doses → 80%
- [ ] Abnormal metric in window → appears in report

---

## Feature 10 — Family Coordination
**Routes:** POST /api/v1/family/:id/access, GET /api/v1/family/:id/access, DELETE /api/v1/family/:id/access/:userId

**Schema:** FamilyAccess — familyMemberId, grantedToUserId, role (CAREGIVER|VIEWER), notificationPrefs (JSON)

**Tests (src/tests/familyAccess.test.js):**
- [ ] Grant CAREGIVER → grantee can read + write
- [ ] Grant VIEWER → grantee can read only, not write
- [ ] Revoke access → immediate loss of access
- [ ] Notification prefs: disabled reminder → user doesn't receive push
- [ ] Owner always retains access regardless

---

## Feature 11 — Communication Modes
**Implementation:** webhook handler fan-out, Thai NLP via Gemini Phase 2, voice message handling

**Tests (src/tests/communication.test.js):**
- [ ] Private mode: action by user A does not notify user B
- [ ] Group fan-out: missed dose → all opted-in caregivers receive push
- [ ] Thai text: "นัดหมอ 15 มกราคม บ่าย 2 โมง" → correct appointment datetime
- [ ] Voice message → audio URL stored on correct record
- [ ] Unknown intent → conversational reply, not error

---

## Feature 12 — Insurance Card Storage
**Routes:** POST /api/v1/insurance, GET /api/v1/insurance?memberId=, GET /api/v1/insurance/:id, PATCH /api/v1/insurance/:id, DELETE /api/v1/insurance/:id

**Service (insuranceService.js):** createInsuranceCard (upload + OCR), listInsuranceCards, updateInsuranceCard, softDeleteInsuranceCard, checkExpiringCards (cron: 60d/30d/7d)

**Schema fields:** familyMemberId, companyName, policyNumber, groupNumber, expirationDate, policyHolderName, coverageType (JSON), frontPhotoUrl, backPhotoUrl, extractedText, status (ACTIVE/EXPIRING/EXPIRED), isDeleted

**Tests (src/tests/insurance.test.js):**
- [ ] POST with photos → Cloudinary URLs stored, OCR runs, fields returned
- [ ] POST manual entry → card created without OCR
- [ ] VIEWER role → policyNumber masked to last 4 digits
- [ ] CAREGIVER/OWNER → full policyNumber returned
- [ ] Status computed correctly: future=ACTIVE, <30d=EXPIRING, past=EXPIRED
- [ ] Expiration cron fires once per threshold, not re-sent
- [ ] OCR failure → ocrSuccess: false, no error
- [ ] Thai text → stored correctly

---

## Final Checks (after all features done)
- [ ] Run full test suite: npm test — all tests green
- [ ] Check Railway Deploy Logs — no red errors
- [ ] Confirm all cron jobs running (reminders, missed dose, refill, insurance expiry)
- [ ] Test full user flow end-to-end in LINE: add member → add medication → confirm dose → add appointment → receive reminder
- [ ] Remove test push route (POST /api/v1/test/push)
- [ ] Swap Gemini to Claude Sonnet for production (optional, better quality)
- [ ] Move to frontend

---

## How to Use This File With Cursor
For each feature, paste this prompt:
> Implement and test [Feature X] from BACKEND_PLAN.md. Fix the implementation (not the tests) until all tests pass. Show final npm test output when done.

For LLM phases, paste:
> Implement LLM [Phase 1/Phase 2] from BACKEND_PLAN.md using Gemini 2.0 Flash. Use @google/generative-ai package. Verify it works end to end.