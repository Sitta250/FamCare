# FamCare Bruno E2E Suite

This collection exercises every PRD feature over HTTP so the iOS app has a reference wire-up.

## Quick start

```
cd famcare-backend
npm install
npm run dev           # server on http://localhost:3000
```

Then in Bruno Desktop: open this folder, pick the `local` environment, and run folders top-to-bottom.

Or from the CLI:

```
cd famcare-backend/bruno
npx @usebruno/cli run --env local
```

Individual folders can be run in isolation:

```
npx @usebruno/cli run family-members --env local
npx @usebruno/cli run appointments    --env local
```

## Environment variables

Edit `environments/local.bru`:

| Variable | Default | Notes |
|----------|---------|-------|
| `baseUrl` | `http://localhost:3000` | Dev server |
| `ownerUserId` | `test-user-001` | `x-line-userid` for the OWNER in every happy-path request |
| `caregiverUserId` | `test-user-002` | OWNER grants CAREGIVER access to this ID |
| `viewerUserId` | `test-user-003` | OWNER grants VIEWER access to this ID (used to test masked `policyNumber`) |
| `memberId` | placeholder | Paste the `data.id` from `family-members/create.bru` response |
| `appointmentId`, `medicationId`, `documentId`, `metricId`, `insuranceId`, `symptomLogId`, `contactId` | placeholders | Paste the matching `data.id` values as you walk the happy path |

Bruno's `tests { }` blocks assert:
- HTTP status code
- Presence of `data` envelope (or `error` / `code` for failures)
- Bangkok timezone suffix (`+07:00`) on date-ish fields when present

## Run order (cold DB)

1. `_setup/health.bru`, `_setup/auth-*.bru` — sanity check middleware
2. `me/get.bru` — auto-create the OWNER user
3. `family-members/create.bru` → paste `data.id` into env `memberId`
4. `appointments/create.bru` → paste into env `appointmentId`
5. `medications/create.bru` → paste into env `medicationId`
6. `health-metrics/create.bru` → paste into env `metricId`
7. `symptom-logs/create.bru` → paste into env `symptomLogId`
8. `emergency/contacts-create.bru` → paste into env `contactId`
9. `documents/create.bru` (multipart — pick any JPG/PDF) → paste into env `documentId`
10. `insurance/create.bru` (multipart — front + back photos) → paste into env `insuranceId`
11. `family-access/grant.bru` — grants CAREGIVER to `caregiverUserId`
12. `insurance/viewer-masked.bru` — grants VIEWER + verifies masked `policyNumber`
13. Run the rest of each folder in numerical order per `seq:` field.

## Coverage summary

See [`../../docs/execution/READINESS_AUDIT.md`](../../docs/execution/READINESS_AUDIT.md) — every PRD feature maps to at least one folder here.

| PRD § | Folder |
|-------|--------|
| §1 Family Member Profiles | `family-members/` |
| §2 Appointment Management | `appointments/` |
| §3 Smart Reminders | cron-driven (see Jest `appointment_reminder.test.js`) |
| §4 Medication Tracking | `medications/` |
| §5 Health Documentation | `documents/` |
| §6 Health Metrics | `health-metrics/` |
| §7 Symptom & Notes Log | `symptom-logs/` |
| §8 Emergency Info Card | `emergency/` |
| §9 Pre-Appointment Report | `appointments/pre-appointment-report.bru` |
| §10 Family Coordination | `family-access/` |
| §11 Communication Modes | `me/patch-chat-mode.bru` |
| §12 Insurance Card | `insurance/` |
