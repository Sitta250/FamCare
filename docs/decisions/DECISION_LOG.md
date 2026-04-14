# FamCare — decision & scope log

**Purpose:** Record anything that **diverges** from the original specs ([prd.md](../product/prd.md), [schema.md](../architecture/schema.md), [tech_stack.md](../architecture/tech_stack.md), [backend.md](../architecture/backend.md)), **follow-up plans** ([execution phases](../execution/phases/)), or **bug fixes** that change behavior or architecture. This keeps context when the codebase moves ahead of the written plan.

**Who updates:** Anyone merging a meaningful change (human or AI). One short entry per decision or grouped batch is enough.

**When to add an entry**

- New feature or field **not** in the PRD MVP (or explicitly deferred).
- Schema / API shape **differs** from `schema.md` or phase docs (with reason).
- **Bug fix** that changes observable behavior, limits, or error codes clients rely on.
- **Tech stack** substitution (e.g. different OCR provider, hosting tweak).
- **Operational** choices (cron cadence, idempotency rules) that are not obvious from code.

**Where not to duplicate**

- Tiny refactors with no API/contract change — omit or one line under “Chore / internal”.
- Full design specs — keep in PRD or phase files; this log only **points** and **summarizes**.

**See also:** [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) — operational checks before production (distinct from spec drift recorded here).

---

## Entry template (copy below the line)

```
### YYYY-MM-DD — short title

- **Type:** scope-add | spec-drift | bugfix-behavior | stack-change | ops
- **Original intent:** what the plan/spec said (file + section if possible).
- **What we did instead:** one paragraph.
- **Why:** tradeoff, bug, time, product call.
- **Code / links:** paths, PR, ticket (optional).
```

---

## Log

### 2026-04-12 — Phase 17 verification pass (backend complete)

- **Type:** ops / bugfix-behavior
- **Original intent:** [phase17.md](../execution/phases/phase17.md) — PDPA delete, Bruno coverage, Railway deploy notes.
- **What we did instead:** Ran integration checks; applied fixes below; extended [famcare-backend/README.md](../famcare-backend/README.md) with `prisma migrate deploy`, Bruno, and `DELETE /api/v1/me` behavior; added Bruno requests [`me/get.bru`](../famcare-backend/bruno/me/get.bru), [`me/delete-account.bru`](../famcare-backend/bruno/me/delete-account.bru).
- **Why:** Keep deploy and deletion contract discoverable; destructive Bruno request documented with placeholder header.

### 2026-04-12 — Medication reminder cron: real Asia/Bangkok clock (applied)

- **Type:** bugfix-behavior
- **Original intent:** [phase11.md](../execution/phases/phase11.md) — match `MedicationSchedule.timeLocal` to Bangkok wall time.
- **What we did instead:** Implemented `bangkokCalendarDate`, `bangkokClockHm`, `utcInstantFromBangkokYmdHm` in [`datetime.js`](../famcare-backend/src/utils/datetime.js) and rewrote [`medicationReminderDispatchService.js`](../famcare-backend/src/services/medicationReminderDispatchService.js) to use them (removed `Date` + `toISOString()` pseudo-Bangkok helpers).
- **Why:** Previous logic did not reliably express Bangkok local date/time for cron matching and missed-dose UTC windows.

### 2026-04-12 — Express: register sub-routes before generic `/:id`

- **Type:** bugfix-behavior / ops
- **Original intent:** Phase docs imply REST paths; Express matches in registration order.
- **What we did instead:** For [`familyMembers.js`](../famcare-backend/src/routes/familyMembers.js) (`/:id/emergency-info`), [`appointments.js`](../famcare-backend/src/routes/appointments.js) (`/:id/pre-appointment-report`), [`medications.js`](../famcare-backend/src/routes/medications.js) (`/:id/logs`, `/:id/schedule`), mount **specific** paths **before** `GET/PATCH/DELETE /:id` to avoid edge cases (e.g. id = `"logs"`).
- **Why:** Defensive routing; aligns with common Express practice.

### 2026-04-12 — Symptom log `cursor` query validation

- **Type:** bugfix-behavior
- **Original intent:** [phase14.md](../execution/phases/phase14.md) — cursor pagination optional.
- **What we did instead:** If `cursor` is present, require a Prisma-style id shape; otherwise **400** `BAD_REQUEST` (avoids confusing empty `data` on garbage input).
- **Why:** Integration test showed invalid cursor returned 200 with empty list.
- **Code / links:** [`symptomLogService.js`](../famcare-backend/src/services/symptomLogService.js).

### 2026-04-12 — `DELETE /api/v1/me` returns JSON body (not 204)

- **Type:** spec-drift (minor)
- **Original intent:** [phase17.md](../execution/phases/phase17.md) suggests `DELETE /api/v1/me`; some teams use 204 No Content.
- **What we did instead:** **200** with `{ "data": { "deleted": true } }` for consistency with other `{ data }` responses.
- **Why:** Matches [backend.md](../architecture/backend.md) success shape; easier for clients than empty 204.
- **Code / links:** [`routes/me.js`](../famcare-backend/src/routes/me.js).

### 2026-04-12 — `User` upsert on first auth (not insert-only)

- **Type:** spec-drift
- **Original intent:** Phase 3 described “find or create”; implementation detail left open.
- **What we did instead:** [`userService.findOrCreateByLineUserId`](../famcare-backend/src/services/userService.js) uses Prisma **`upsert`** on `lineUserId` to apply display name / photo updates when headers change.
- **Why:** Fewer round-trips and idempotent profile sync from LINE Login headers.

### 2026-04-12 — Decision log introduced

- **Type:** ops
- **Original intent:** Decisions lived only in chat or ad-hoc README notes.
- **What we did instead:** This file + links from [phase playbook](../execution/phases/README.md) and [backend.md](../architecture/backend.md).
- **Why:** Preserve context when implementation, plans, and PRD diverge.

### 2026-04-12 — `GET /api/v1/medications` requires `familyMemberId`

- **Type:** bugfix-behavior
- **Original intent:** List endpoint shape implied by [phase10.md](../execution/phases/phase10.md) (filter by member).
- **What we did instead:** Validate `familyMemberId` query param; **400** `BAD_REQUEST` if missing (avoids Prisma 500 on `undefined` id).
- **Why:** Hardening after integration test.
- **Code / links:** `famcare-backend/src/services/medicationService.js`.

<!-- Add new entries above this comment, newest first. -->
