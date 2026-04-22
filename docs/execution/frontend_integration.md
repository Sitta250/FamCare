# Frontend Integration Playbook (iOS)

Purpose: give iOS implementation a single working document that maps each screen to API calls, payload shapes, edge cases, and readiness status.

## Source Of Truth

- Product behavior: [`docs/product/prd.md`](../product/prd.md)
- Backend readiness matrix: [`docs/execution/READINESS_AUDIT.md`](./READINESS_AUDIT.md)
- API contract: [`docs/architecture/api_contract.md`](../architecture/api_contract.md)
- Drift and decisions: [`docs/decisions/DECISION_LOG.md`](../decisions/DECISION_LOG.md)

## Integration Rules (Apply To Every Screen)

- Base URL: `https://<host>/api/v1`
- Required auth header: `x-line-userid`
- Optional profile headers: `x-line-displayname`, `x-line-photourl`
- Success envelope: `{ data: ... }`
- Error envelope: `{ error: string, code: string }`
- Date handling:
  - Server returns Bangkok ISO (`+07:00`) on DateTime fields
  - Client may send `+07:00` or UTC (`Z`), but normalize in app layer before display
- File uploads:
  - Use `multipart/form-data`
  - Match field names exactly as contract states (`file`, `frontPhoto`, `backPhoto`)

## Screen To Endpoint Matrix

Use this as your implementation checklist. Mark each row as you complete it.

| Status | iOS Screen | PRD Feature | Endpoint(s) | Notes |
|---|---|---|---|---|
| ⬜ | My Profile / Chat Mode | §11 Communication Modes | `GET /me`, `PATCH /me` | Chat mode toggle uses enum `PRIVATE`/`GROUP` |
| ⬜ | Family Members List | §1 Family Member Profiles | `GET /family-members` | Includes owned + shared members |
| ⬜ | Add/Edit Family Member | §1 Family Member Profiles | `POST /family-members`, `PATCH /family-members/:id` | Keep soft-delete behavior in mind |
| ⬜ | Appointment List/Calendar | §2 Appointment Mgmt | `GET /appointments` | Supports `view=upcoming|calendar` |
| ⬜ | Appointment Detail + Edit | §2 + §10 | `GET /appointments/:id`, `PATCH /appointments/:id` | Includes `accompaniedByUserId`, `whoBringsNote` |
| ⬜ | Pre-Appointment Report | §9 | `GET /appointments/:id/pre-appointment-report` | Aggregated read model |
| ⬜ | Medications List/Detail | §4 | `GET /medications`, `GET /medications/:id` | Filter by `familyMemberId` |
| ⬜ | Medication Schedule | §4 | `GET /medications/:id/schedule`, `PUT /medications/:id/schedule` | Times are Bangkok `HH:mm` |
| ⬜ | Dose Logging + Adherence | §4 | `POST /medications/:id/logs`, `GET /medications/:id/logs`, `GET /medications/:id/adherence` | Status enum `TAKEN|MISSED|SKIPPED` |
| ⬜ | Health Metrics Timeline | §6 | `GET /health-metrics`, `POST /health-metrics` | Use `type`, `from`, `to` filters |
| ⬜ | Metric Thresholds | §6 | `GET/PUT/DELETE /health-metrics/:memberId/thresholds/:type` | Upsert semantics on `PUT` |
| ⬜ | Documents | §5 | `POST /documents`, `GET /documents`, `GET /documents/:id`, `DELETE /documents/:id` | Upload field is `file` |
| ⬜ | Symptom Logs | §7 | `POST/GET/PATCH/DELETE /symptom-logs` | Keep severity validation handling |
| ⬜ | Symptom Media Upload | §7 | `POST /symptom-logs/:id/photo`, `POST /symptom-logs/:id/voice-note` | Field is `file` for both |
| ⬜ | Emergency Info Card | §8 | `GET /family-members/:id/emergency-info`, `GET /family-members/:id/emergency-card` | Card is share-friendly payload |
| ⬜ | Emergency Contacts | §8 | `GET/POST/PATCH/DELETE /family-members/:id/emergency-contacts` | CRUD under family member scope |
| ⬜ | Family Coordination Access | §10 | `GET/POST/PATCH/DELETE /family-members/:id/access` | Role + notification preferences |
| ⬜ | Insurance Card | §12 | `POST/GET/PATCH/DELETE /insurance`, `GET /insurance/:id` | VIEWER masking rules apply |

## Error Handling Matrix (UI Behavior)

| Code | Typical Cause | iOS Behavior |
|---|---|---|
| `UNAUTHORIZED` | Missing/invalid `x-line-userid` | Refresh auth context; force re-entry path |
| `FORBIDDEN` | User lacks access role for member | Show permission-denied UI |
| `NOT_FOUND` | Deleted/missing resource | Show gone state and navigate back |
| `BAD_REQUEST` | Validation failure | Inline field-level error + retry |
| `FILE_TOO_LARGE` | Upload exceeds limit | Show size-specific error |
| `UNSUPPORTED_MEDIA_TYPE` | Wrong upload MIME | Show accepted file type hint |
| `INVALID_ACCOMPANIED_USER` | Invalid appointment companion | Block save and prompt valid assignee |
| `INTERNAL_ERROR` | Server-side fault | Generic error + retry option |

## Data Contracts To Lock Early

Before broad UI build, freeze app-layer models for:

- `FamilyMember`
- `Appointment`
- `Medication` + `MedicationLog` + `MedicationSchedule`
- `HealthMetric` + `MetricThreshold`
- `Document`
- `SymptomLog`
- `EmergencyCard` payload
- `InsuranceCard` (including masked `policyNumber` behavior for viewer role)

Reference payload examples directly from [`docs/architecture/api_contract.md`](../architecture/api_contract.md).

## Recommended Build Order

1. `me` + auth header pipeline
2. family members + access control boundaries
3. appointments + pre-appointment report
4. medications + logs + adherence
5. health metrics + thresholds
6. symptom logs + media upload
7. documents upload/search
8. emergency info/contacts/card
9. insurance card + viewer masking checks

## QA Checklist Per Screen

For each iOS screen, verify:

- Happy path load and empty state
- Validation errors from `BAD_REQUEST`
- Permission errors from `FORBIDDEN`
- Date rendering of `+07:00` values
- Retry flow on transient failures
- Regression against current Bruno examples

## Bruno Alignment

When implementing a screen, mirror request examples from:

- `famcare-backend/bruno/<feature>/`

Use Bruno payloads as the canonical integration examples so UI and backend stay in lockstep.

## Change Log

- 2026-04-22: Initial iOS integration playbook created from readiness audit and API contract.
