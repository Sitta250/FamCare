# Risk Register

Operational risk tracker for the FamCare backend deployed at
`https://famcare-backend-production.up.railway.app`.

Each entry is a concrete problem surfaced by live testing or production
operations. Risks are worked one by one until all are Resolved.

## How To Use

- Add a new entry with the next ID (`R4`, `R5`, ...).
- Update `Status` and `Last updated` as you work.
- Move Resolved entries into the `Resolved Archive` section at the bottom.
- Link to exact evidence (request/response, log excerpt, test file).

### Legend

- Severity
  - High: blocks a documented use case or corrupts data
  - Medium: degrades a feature or hides defects
  - Low: gap in coverage or minor inconvenience
- Status: `Open` | `In Progress` | `Resolved`
- Owner: `TBD` until explicitly claimed

### Entry Schema

```
- ID:
- Title:
- Severity:
- Status:
- Context:
- Evidence:
- Impact:
- Proposed fix direction:
- Verification steps:
- Owner:
- Last updated:
```

## Active Risks

### R1 — GET /api/v1/appointments returns 500 when familyMemberId is omitted

- Severity: High
- Status: Open
- Context: Track A live smoke against Railway URL; route
  [`famcare-backend/src/routes/appointments.js`](../../famcare-backend/src/routes/appointments.js).
- Evidence:
  - Request: `GET /api/v1/appointments` with `x-line-userid: plan-live-u1`
  - Response: `500 INTERNAL_ERROR`
  - Body excerpt:
    `Invalid prisma.familyMember.findUnique() invocation: { where: { id: undefined, ... } } Argument where needs at least one of id arguments.`
- Impact: Any caller that lists appointments without a member filter crashes
  instead of receiving a controlled `400` or empty list.
- Proposed fix direction: Guard the query in the route/service so missing
  `familyMemberId` either returns a `400 BAD_REQUEST` (consistent with other
  list endpoints) or resolves to an access-scoped empty list. Avoid passing
  `id: undefined` into Prisma.
- Verification steps:
  - `GET /api/v1/appointments` without `familyMemberId` → `400` or `200` with
    `{ data: [] }` per decision.
  - `GET /api/v1/appointments?familyMemberId=<valid>` → `200`.
  - `GET /api/v1/appointments?from=...&to=...` without `familyMemberId` →
    same controlled response as the no-query case.
  - Re-run Track A regression block.
- Owner: TBD
- Last updated: 2026-04-23

### R2 — Webhook, upload, and cron edge paths unexercised in production

- Severity: Medium
- Status: Open
- Context: Track A is read-only by policy; Track B covers these in
  local/staging via Jest suite in
  [`famcare-backend/src/tests`](../../famcare-backend/src/tests).
- Evidence:
  - Local suite: 27 suites / 264 tests passing.
  - No live exercise of `POST /webhook`, multipart uploads, or cron dispatch
    in production.
- Impact: Production-only misconfiguration (LINE signing secret, Cloudinary
  credentials, cron scheduling under Railway runtime) could go undetected
  until real users trigger the flow.
- Proposed fix direction:
  - Add a controlled production smoke procedure for:
    - Webhook reachability (signature-verified no-op event).
    - Single media upload using a dedicated test member + test user.
    - Cron heartbeat log line visible in Railway logs.
  - Gate with test identities and cleanup steps; keep destructive coverage
    in staging/local.
- Verification steps:
  - Webhook endpoint responds `200` to a valid signed test payload.
  - Upload path returns expected `201` with `cloudinaryUrl` for test user.
  - Railway logs show recurring `[cron] ...` output at expected cadence.
- Owner: TBD
- Last updated: 2026-04-23

### R3 — Cross-user and resource-by-id coverage limited by empty datasets

- Severity: Low
- Status: Open
- Context: Track A attempted cross-user authorization and
  resource-by-id reads, but seeded users had no family members or
  appointments, so some cases were skipped.
- Evidence:
  - `family_member_get_u1` and `appointment_get_u1` blocks were skipped
    in the smoke run.
  - `family_members_list_u1` returned `{ data: [] }`.
- Impact: Authorization `403/404` behavior for concrete resources is not
  directly observed on production.
- Proposed fix direction: Seed a minimal, clearly-labeled read-only
  fixture user (for example `x-line-userid: smoke-fixture-owner-1`) with
  one family member and one appointment on production, and document their
  IDs in this file so Track A can assert specific reads and cross-user
  `403/404` responses repeatably.
- Verification steps:
  - `GET /api/v1/family-members/<fixtureMemberId>` as owner → `200`.
  - Same request as a second non-shared `x-line-userid` → `403` or `404`.
  - `GET /api/v1/appointments/<fixtureApptId>/pre-appointment-report`
    returns expected shape.
- Owner: TBD
- Last updated: 2026-04-23

## Resolved Archive

_No resolved risks yet._
