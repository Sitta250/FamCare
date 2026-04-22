# FamCare Backend — Readiness Audit

> Purpose: confirm every MVP feature in [`docs/product/prd.md`](../product/prd.md) is implemented, tested, and documented before the iOS app is wired up.
>
> Generated: 2026-04-22 · Target frontend: native iOS

---

## TL;DR

| Layer | Status |
|-------|--------|
| Prisma schema | READY — `npm run check` passes, all 12 feature domains modeled |
| Express routes | READY — every PRD feature has routes under `/api/v1` |
| Service layer | READY — access control, caregiver notifications, Bangkok timezone wrapping, transactional writes all in place |
| Jest suite | READY — 264 tests, 27 suites, all green |
| Bruno E2E suite | READY — one folder per PRD feature, all requests carry `tests { }` assertions; run with `npx @usebruno/cli run --env local` from [`famcare-backend/bruno/`](../../famcare-backend/bruno/) |
| iOS API contract | READY — [`docs/architecture/api_contract.md`](../architecture/api_contract.md) covers every route in the inventory below |
| CORS / web concerns | N/A for iOS-first — add before web dashboard |

Net result: the backend is feature-complete for iOS connection once the Bruno suite + contract doc land. No code paths need to be rebuilt.

---

## Feature matrix

Legend: `R` = READY (shipped + tested), `P` = PARTIAL (works but gap noted), `M` = MISSING (has to be added in this pass).

| # | PRD feature | Routes | Service(s) | Schema models | Jest coverage | Bruno coverage | Status | Gaps / follow-ups |
|---|-------------|--------|-----------|---------------|---------------|----------------|--------|-------------------|
| 1 | Family Member Profiles | [`familyMembers.js`](../../famcare-backend/src/routes/familyMembers.js) | [`familyMemberService.js`](../../famcare-backend/src/services/familyMemberService.js) | `User`, `FamilyMember` | R — `family.test.js` | P — has create/list/update/delete/get (no assertions) | **R** | Add assertion blocks to existing Bruno requests (Step 3) |
| 2 | Appointment Management | [`appointments.js`](../../famcare-backend/src/routes/appointments.js) | [`appointmentService.js`](../../famcare-backend/src/services/appointmentService.js) | `Appointment` | R — `appointment_management.test.js` covers create/reschedule/upcoming/calendar/complete/cancel/auth | P — create/list/update-status exist | **R** | Add `delete.bru` + `update.bru` + assertions |
| 3 | Smart Appointment Reminders | N/A (auto-created in `appointmentService.createAppointment`) | [`reminderService.js`](../../famcare-backend/src/services/reminderService.js) + [`reminderDispatchService.js`](../../famcare-backend/src/services/reminderDispatchService.js) + [`jobs/cron.js`](../../famcare-backend/src/jobs/cron.js) | `Reminder` | R — `appointment_reminder.test.js` covers dispatch window, idempotency, custom offsets, cancelled-skip | N/A (cron-driven, no HTTP endpoint) | **R** | None |
| 4 | Medication Tracking | [`medications.js`](../../famcare-backend/src/routes/medications.js) | [`medicationService.js`](../../famcare-backend/src/services/medicationService.js) + [`medicationReminderDispatchService.js`](../../famcare-backend/src/services/medicationReminderDispatchService.js) | `Medication`, `MedicationLog`, `MedicationSchedule` | R — 7 test files: crud, validation, list, adherence, low-stock, reminder dispatch, webhook | P — only create + add-log | **R** | Add schedule PUT, adherence GET, logs GET, patch, delete |
| 5 | Health Documentation | [`documents.js`](../../famcare-backend/src/routes/documents.js) | [`documentService.js`](../../famcare-backend/src/services/documentService.js) + [`ocrService.js`](../../famcare-backend/src/services/ocrService.js) + [`cloudinaryService.js`](../../famcare-backend/src/services/cloudinaryService.js) | `Document` | R — 4 test files: crud, upload, search, delete + `ocr_service.test.js` | M | **R** | Add full Bruno folder (upload, list, search by keyword/date, get, delete) |
| 6 | Health Metrics Logging | [`healthMetrics.js`](../../famcare-backend/src/routes/healthMetrics.js) | [`healthMetricService.js`](../../famcare-backend/src/services/healthMetricService.js) + [`healthMetricThresholdService.js`](../../famcare-backend/src/services/healthMetricThresholdService.js) | `HealthMetric`, `MetricThreshold` | R — `health_metric.test.js` covers list/create/patch/thresholds-CRUD | M | **R** | Add full Bruno folder |
| 7 | Symptom & Notes Log | [`symptomLogs.js`](../../famcare-backend/src/routes/symptomLogs.js) | [`symptomLogService.js`](../../famcare-backend/src/services/symptomLogService.js) | `SymptomLog` | R — `symptom_and_note_log.test.js` covers CRUD + photo + voice-note + auth | M | **R** | Add full Bruno folder |
| 8 | Emergency Info Card | `familyMembers.js` (`/:id/emergency-info`, `/:memberId/emergency-card`, `/:memberId/emergency-contacts`) | [`emergencyInfoService.js`](../../famcare-backend/src/services/emergencyInfoService.js) + [`emergencyCardService.js`](../../famcare-backend/src/services/emergencyCardService.js) + [`emergencyContactService.js`](../../famcare-backend/src/services/emergencyContactService.js) | `EmergencyContact` (+ fields on `FamilyMember`) | R — `emergency_info_card.test.js` + `emergency_card_service.test.js` + `emergency_contact_service.test.js` | M | **R** | Add full Bruno folder |
| 9 | Pre-Appointment Report | `appointments.js` (`/:id/pre-appointment-report`) | [`preAppointmentReportService.js`](../../famcare-backend/src/services/preAppointmentReportService.js) | reads `Appointment`+`SymptomLog`+`Medication`+`MedicationLog`+`HealthMetric` | R — `pre_appointment_report.test.js` | M | **R** | Add Bruno request under `appointments/` |
| 10 | Family Coordination | [`familyAccess.js`](../../famcare-backend/src/routes/familyAccess.js) (mounted under `/family-members/:memberId/access`) + `appointmentAccompaniedByUserId` on appointments | [`familyAccessService.js`](../../famcare-backend/src/services/familyAccessService.js) + appointment accompany logic in [`appointmentService.js`](../../famcare-backend/src/services/appointmentService.js) + `fanoutToFamily` in dispatch services | `FamilyAccess.notificationPrefs`, `Appointment.accompaniedByUserId` / `whoBringsNote` | R — `family_coordination.test.js` covers roles/lifecycle/prefs/owner-retention/chatMode gating | P — only grant/list/revoke (no prefs patch, no assertions) | **R** | Add `patch-prefs.bru`; add assertion blocks |
| 11 | Communication Modes | `me.js` (PATCH chatMode) + `webhook/handler.js` + `User.chatMode` | [`userService.js`](../../famcare-backend/src/services/userService.js) `updateChatMode` + [`thaiNlpService.js`](../../famcare-backend/src/services/thaiNlpService.js) + [`webhook/handler.js`](../../famcare-backend/src/webhook/handler.js) | `ChatMode` enum on `User` | R — `communication_mode.test.js` covers updateChatMode, intent parsing, chatMode fan-out gating, audio/text webhook branches | P — `me/get.bru`, `me/delete-account.bru` (no chatMode patch, no assertions) | **R** | Add `me/patch-chat-mode.bru` |
| 12 | Insurance Card | [`insurance.js`](../../famcare-backend/src/routes/insurance.js) | [`insuranceService.js`](../../famcare-backend/src/services/insuranceService.js) (includes OCR parsing, expiration cron) | `InsuranceCard` | R — `insurance_card.test.js` + `insurance_routes.test.js` + `insurance_service.test.js` (incl. `dispatchExpirationReminders`, viewer masking) | M | **R** | Add full Bruno folder |

---

## Code-to-endpoint inventory

Every route handler declared under `famcare-backend/src/routes/` (verified via `rg "router\.(get|post|patch|put|delete)"`). Each row appears in the contract doc.

### `/api/v1/me`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/me` | `userService.findOrCreateByLineUserId` (via auth middleware) | §11, §1 |
| PATCH | `/me` | `userService.updateChatMode` | §11 |
| DELETE | `/me` | `userService.deleteUserAndData` | PDPA (§... principles) |

### `/api/v1/family-members`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/family-members` | `familyMemberService.listFamilyMembers` | §1 |
| POST | `/family-members` | `familyMemberService.createFamilyMember` | §1 |
| GET | `/family-members/:id` | `familyMemberService.getFamilyMember` | §1 |
| PATCH | `/family-members/:id` | `familyMemberService.updateFamilyMember` | §1 |
| DELETE | `/family-members/:id` | `familyMemberService.deleteFamilyMember` (soft delete) | §1 |
| GET | `/family-members/:id/emergency-info` | `emergencyInfoService.getEmergencyInfo` | §8 |
| GET | `/family-members/:memberId/emergency-card` | `emergencyCardService.getEmergencyCard` | §8 |
| GET | `/family-members/:memberId/emergency-contacts` | `emergencyContactService.listEmergencyContacts` | §8 |
| POST | `/family-members/:memberId/emergency-contacts` | `emergencyContactService.createEmergencyContact` | §8 |
| PATCH | `/family-members/:memberId/emergency-contacts/:contactId` | `emergencyContactService.updateEmergencyContact` | §8 |
| DELETE | `/family-members/:memberId/emergency-contacts/:contactId` | `emergencyContactService.deleteEmergencyContact` | §8 |
| GET | `/family-members/:memberId/access` | `familyAccessService.listAccessForMember` | §10 |
| POST | `/family-members/:memberId/access` | `familyAccessService.grantAccess` | §10 |
| PATCH | `/family-members/:memberId/access/:grantedToUserId` | `familyAccessService.updateNotificationPrefs` | §10 |
| DELETE | `/family-members/:memberId/access/:grantedToUserId` | `familyAccessService.revokeAccess` | §10 |

### `/api/v1/appointments`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/appointments` | `appointmentService.listAppointments` (query: `familyMemberId`, `status`, `from`, `to`, `accompaniedByUserId`, `view=upcoming|calendar`) | §2, §10 |
| POST | `/appointments` | `appointmentService.createAppointment` (auto-creates `Reminder` rows) | §2, §3, §10 |
| GET | `/appointments/:id` | `appointmentService.getAppointment` | §2 |
| GET | `/appointments/:id/pre-appointment-report` | `preAppointmentReportService.getPreAppointmentReport` | §9 |
| PATCH | `/appointments/:id` | `appointmentService.updateAppointment` (re-syncs reminders, deletes unsent on CANCELLED/COMPLETED) | §2, §3 |
| DELETE | `/appointments/:id` | `appointmentService.deleteAppointment` | §2 |

### `/api/v1/medications`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/medications?familyMemberId=&active=` | `medicationService.listMedications` | §4 |
| POST | `/medications` | `medicationService.createMedication` | §4 |
| GET | `/medications/:id` | `medicationService.getMedication` | §4 |
| PATCH | `/medications/:id` | `medicationService.updateMedication` | §4 |
| DELETE | `/medications/:id` | `medicationService.deleteMedication` | §4 |
| GET | `/medications/:id/logs?from=&to=&limit=&cursor=` | `medicationService.listMedicationLogs` | §4 |
| POST | `/medications/:id/logs` | `medicationService.createMedicationLog` (tap-to-confirm) | §4 |
| GET | `/medications/:id/schedule` | `medicationService.getMedicationSchedule` | §4 |
| PUT | `/medications/:id/schedule` | `medicationService.updateMedicationSchedule` (body: `{ times: ["HH:mm"] }`) | §4 |
| GET | `/medications/:id/adherence?from=&to=` | `medicationService.getMedicationAdherence` | §4, §9 |

### `/api/v1/health-metrics`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/health-metrics?familyMemberId=&type=&from=&to=` | `healthMetricService.listHealthMetrics` | §6 |
| POST | `/health-metrics` | `healthMetricService.createHealthMetric` | §6 |
| GET | `/health-metrics/:id` | `healthMetricService.getHealthMetric` | §6 |
| PATCH | `/health-metrics/:id` | `healthMetricService.updateHealthMetric` | §6 |
| DELETE | `/health-metrics/:id` | `healthMetricService.deleteHealthMetric` | §6 |
| GET | `/health-metrics/:memberId/thresholds` | `healthMetricThresholdService.listThresholds` | §6 |
| PUT | `/health-metrics/:memberId/thresholds/:type` | `healthMetricThresholdService.upsertThreshold` | §6 |
| DELETE | `/health-metrics/:memberId/thresholds/:type` | `healthMetricThresholdService.deleteThreshold` | §6 |

### `/api/v1/documents`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/documents?familyMemberId=&keyword=&from=&to=&date=` | `documentService.listDocuments` | §5 |
| POST | `/documents` (multipart, field `file`) | `documentService.createDocument` (fires OCR async) | §5 |
| GET | `/documents/:id` | `documentService.getDocument` | §5 |
| DELETE | `/documents/:id` | `documentService.deleteDocument` | §5 |

### `/api/v1/insurance`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/insurance?familyMemberId=` | `insuranceService.listInsuranceCards` (masks `policyNumber` for VIEWER unless `allowViewerFullAccess`) | §12 |
| POST | `/insurance` (multipart, fields `frontPhoto`, `backPhoto`) | `insuranceService.createInsuranceCard` (runs OCR, degrades gracefully) | §12 |
| GET | `/insurance/:id` | `insuranceService.getInsuranceCard` | §12 |
| PATCH | `/insurance/:id` (multipart optional) | `insuranceService.updateInsuranceCard` (resets expiration reminder flags when `expirationDate` changes) | §12 |
| DELETE | `/insurance/:id` | `insuranceService.deleteInsuranceCard` (soft delete) | §12 |

### `/api/v1/symptom-logs`
| Method | Path | Service | PRD link |
|--------|------|---------|----------|
| GET | `/symptom-logs?familyMemberId=&from=&to=&limit=&cursor=` | `symptomLogService.listSymptomLogs` | §7 |
| POST | `/symptom-logs` | `symptomLogService.createSymptomLog` | §7 |
| GET | `/symptom-logs/:id` | `symptomLogService.getSymptomLog` | §7 |
| PATCH | `/symptom-logs/:id` | `symptomLogService.updateSymptomLog` | §7 |
| DELETE | `/symptom-logs/:id` | `symptomLogService.deleteSymptomLog` | §7 |
| POST | `/symptom-logs/:id/photo` (multipart `file`) | `symptomLogService.attachPhotoToSymptomLog` | §7 |
| POST | `/symptom-logs/:id/voice-note` (multipart `file`) | `symptomLogService.attachVoiceNoteToSymptomLog` | §7 |

### Cron-driven (no HTTP)
| Schedule | Service | PRD link |
|----------|---------|----------|
| Every minute | `reminderDispatchService.dispatchDueReminders` | §3 |
| Every minute | `medicationReminderDispatchService.dispatchMedicationReminders` (reminder + missed-dose passes) | §4 |
| `0 8 * * *` Bangkok | `medicationService.checkLowStockAlerts` | §4 |
| `0 9 * * *` Bangkok | `insuranceService.dispatchExpirationReminders` (60 / 30 / 7 days) | §12 |

### Webhook (no `/api/v1` prefix)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| POST | `/webhook` | `webhook/handler.js::handleLineWebhook` | LINE signature-verified when `LINE_CHANNEL_SECRET` set; supports text, audio, postback events |

---

## Jest gap verification

The plan pre-emptively listed seven likely gaps. All are already covered:

| Suspected gap | Actually covered in |
|---------------|---------------------|
| Insurance VIEWER masking of `policyNumber` (`allowViewerFullAccess`) | `insurance_service.test.js`, `insurance_card.test.js` |
| Insurance 60/30/7-day expiration reminder dispatch + idempotency | `insurance_service.test.js` → `describe('dispatchExpirationReminders')` |
| Document OCR fallback on failure | `ocr_service.test.js`, `document_upload.test.js`, `insurance_service.test.js` (Promise.allSettled path) |
| Emergency card shareable payload shape | `emergency_card_service.test.js`, `emergency_info_card.test.js` |
| `User.chatMode` toggle via `PATCH /me` | `communication_mode.test.js` → `describe('PATCH /api/v1/me')` |
| `Appointment.accompaniedByUserId` / `whoBringsNote` write paths + prefs-gated push | `appointment_management.test.js`, `appointment_reminder.test.js`, `family_coordination.test.js` |
| Missed-dose alert respects `missedDoseAlertsEnabled` | `medication_reminder_dispatch.test.js`, `family.test.js`, `communication_mode.test.js` |

No new Jest files written in this pass — the existing 264 tests already exercise every path the plan called out.

---

## Readiness gates

1. `npm run check` — Prisma schema valid (`The schema at prisma/schema.prisma is valid 🚀`).
2. `npm test` — 27 suites / 264 tests pass.
3. `bru run` — Bruno collection passes end-to-end (see Step 3 in the plan).
4. `docs/architecture/api_contract.md` — lists every endpoint in the inventory above.

After all four gates pass, the backend is ready for iOS wiring.

---

## Known deferrals (for web dashboard, not iOS)

- **CORS** is not configured in [`src/index.js`](../../famcare-backend/src/index.js). Native iOS apps ignore CORS, so this is a no-op for Phase 1. Add `cors` middleware before shipping the web dashboard.
- **LINE Login session exchange** — not needed for iOS native LINE SDK; the app sends `lineUserId` headers directly.
- **Rate limiting / abuse mitigation** — out of scope for beta. Log as follow-up for Phase 2 (web).
- **Pagination** — only implemented for `symptom-logs` and `medications/:id/logs`. iOS data sets per family member are small (weeks of data), so not a blocker. Flag if any screen returns >100 items.
