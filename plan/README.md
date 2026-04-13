# FamCare backend — phase playbook

Use these files **in order** (Phase 1 → Phase 17). Each phase is a **small, working, testable** increment.

**Specs (repo):**

- [context/prd.md](../context/prd.md) — product scope
- [context/tech_stack.md](../context/tech_stack.md) — stack choices
- [context/backend.md](../context/backend.md) — structure and conventions
- [context/schema.md](../context/schema.md) — data model (Prisma source of truth for fields)
- [context/DECISION_LOG.md](../context/DECISION_LOG.md) — **scope changes, spec drift, and meaningful bugfix behavior** (keep in sync when you diverge from plan or PRD)
- [context/GO_LIVE_CHECKLIST.md](../context/GO_LIVE_CHECKLIST.md) — **pre-production verification** (what to still check or run before go-live)

**Backend code location:** [`famcare-backend/`](../famcare-backend/)

**Conventions (all phases):**

- Business logic in `famcare-backend/src/services/`, not in route handlers.
- REST auth: header `x-line-userid` (LINE user id). Errors: `{ "error": string, "code": string }`. Success: `{ "data": ... }`.
- Store timestamps in **UTC** in PostgreSQL; format for API responses in **Asia/Bangkok** where user-facing times are shown.

| Phase | File | Topic |
|------:|------|--------|
| 1 | [phase1.md](phase1.md) | Bootstrap, health checks |
| 2 | [phase2.md](phase2.md) | PostgreSQL + Prisma schema + migrate |
| 3 | [phase3.md](phase3.md) | Auth middleware + `User` + `GET /api/v1/me` |
| 4 | [phase4.md](phase4.md) | Access helpers + `FamilyMember` CRUD |
| 5 | [phase5.md](phase5.md) | `FamilyAccess` invites + revoke |
| 6 | [phase6.md](phase6.md) | Appointments + `Reminder` row sync |
| 7 | [phase7.md](phase7.md) | LINE webhook (verify + thin handler) |
| 8 | [phase8.md](phase8.md) | LINE push + appointment reminder cron |
| 9 | [phase9.md](phase9.md) | Notify owner when caregiver adds records |
| 10 | [phase10.md](phase10.md) | Medications + `MedicationLog` |
| 11 | [phase11.md](phase11.md) | Medication schedules + missed-dose cron |
| 12 | [phase12.md](phase12.md) | Health metrics |
| 13 | [phase13.md](phase13.md) | Documents + Cloudinary + OCR |
| 14 | [phase14.md](phase14.md) | Symptom log + timeline |
| 15 | [phase15.md](phase15.md) | Emergency info + pre-appointment report APIs |
| 16 | [phase16.md](phase16.md) | Coordination fields + LINE stubs |
| 17 | [phase17.md](phase17.md) | Account delete + deploy + Bruno |
