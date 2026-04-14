# Phase 15 — Emergency info + pre-appointment report (JSON APIs)

## Goal

1. **`GET /api/v1/family-members/:id/emergency-info`** (or dedicated path): aggregate **`FamilyMember`** + **active `Medication`** + **`EmergencyContact`** list + allergies/conditions/blood type + preferred hospital. Shape as stable JSON for LINE Flex / web.

2. **`GET /api/v1/appointments/:id/pre-appointment-report`**: symptoms since **last completed** appointment for that member (or last N days if none), **medication adherence** summary (counts TAKEN/MISSED from logs), **recent health metrics** (e.g. last 14 days). Optional **`suggestedQuestions`** stub array from template.

3. **PDF/image export** — **optional** for MVP; if skipped, document that clients render JSON.

## Prerequisites

- [Phase 4](phase4.md)–[Phase 14](phase14.md) data available
- `EmergencyContact` + `preferredHospital` from Phase 2

## Step-by-step

1. **`services/emergencyInfoService.js`** — single assembler, no DB logic in routes.

2. **`services/preAppointmentReportService.js`** — query windows; handle missing “last visit” gracefully.

3. **Routes** — auth + `assertCanReadMember`.

4. **Bruno** — seed data; GET returns non-empty sections.

## Definition of done

- 403 for user without access; 404 for wrong id.

## Verify

curl with two users; stranger blocked.

## Next

[phase16.md](phase16.md)
