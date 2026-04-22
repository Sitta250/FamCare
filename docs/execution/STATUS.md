# Execution Status

## Current Snapshot

- Active phase baseline: [`phase17.md`](phases/phase17.md)
- Active feature plan: [`health-documentation-plan.md`](features/health-documentation-plan.md)
- Additional active plan: [`medication-tracking-plan.md`](features/medication-tracking-plan.md)
- Latest audit: [`READINESS_AUDIT.md`](READINESS_AUDIT.md) — backend ready-for-iOS gate
- iOS API contract: [`../architecture/api_contract.md`](../architecture/api_contract.md)

## Readiness gates (2026-04-22)

| Gate | Command | Status |
|------|---------|--------|
| Prisma schema | `cd famcare-backend && npm run check` | green — schema valid |
| Jest suite | `cd famcare-backend && npm test` | green — 27 suites / 264 tests |
| Bruno E2E | `cd famcare-backend/bruno && npx @usebruno/cli run --env local` | green locally (requires running dev server + seeded IDs) |
| API contract | [`docs/architecture/api_contract.md`](../architecture/api_contract.md) covers every route in `src/routes/*.js` | green |

## Per-feature readiness (iOS connection)

All rows link back to [`READINESS_AUDIT.md`](READINESS_AUDIT.md) for route / service / test / Bruno mapping.

| # | PRD feature | Jest | Bruno | Contract |
|---|-------------|------|-------|----------|
| 1 | Family Member Profiles | ✅ | ✅ `bruno/family-members/` | [§5](../architecture/api_contract.md#5-family-members-prd-1) |
| 2 | Appointment Management | ✅ | ✅ `bruno/appointments/` | [§7](../architecture/api_contract.md#7-appointments-prd-2) |
| 3 | Smart Appointment Reminders | ✅ | N/A (cron) | [§15](../architecture/api_contract.md#15-background-jobs-no-http-surface) |
| 4 | Medication Tracking | ✅ | ✅ `bruno/medications/` | [§8](../architecture/api_contract.md#8-medications-prd-4) |
| 5 | Health Documentation | ✅ | ✅ `bruno/documents/` | [§10](../architecture/api_contract.md#10-documents-prd-5) |
| 6 | Health Metrics Logging | ✅ | ✅ `bruno/health-metrics/` | [§9](../architecture/api_contract.md#9-health-metrics-prd-6) |
| 7 | Symptom & Notes Log | ✅ | ✅ `bruno/symptom-logs/` | [§11](../architecture/api_contract.md#11-symptom--notes-log-prd-7) |
| 8 | Emergency Info Card | ✅ | ✅ `bruno/emergency/` | [§12](../architecture/api_contract.md#12-emergency-info-card-prd-8) |
| 9 | Pre-Appointment Report | ✅ | ✅ `bruno/appointments/pre-appointment-report.bru` | [§7](../architecture/api_contract.md#7-appointments-prd-2) |
| 10 | Family Coordination | ✅ | ✅ `bruno/family-access/` + `bruno/appointments/patch-accompanied-by.bru` | [§6](../architecture/api_contract.md#6-family-access--coordination-prd-10) |
| 11 | Communication Modes | ✅ | ✅ `bruno/me/patch-chat-mode*.bru` | [§4](../architecture/api_contract.md#4-account-prd-11--account) |
| 12 | Insurance Card | ✅ | ✅ `bruno/insurance/` (incl. VIEWER masking) | [§13](../architecture/api_contract.md#13-insurance-cards-prd-12) |

## Navigation

- Phase index: [`phases/README.md`](phases/README.md)
- All phases: [`phases/`](phases/)
- Feature plans: [`features/`](features/)
- Decisions / drift: [`../decisions/DECISION_LOG.md`](../decisions/DECISION_LOG.md)

## Agent Workflow

For new work, create or update a feature plan in `docs/execution/features/` and reference it explicitly in agent prompts.
