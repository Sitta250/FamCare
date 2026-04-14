# FamCare — go-live checklist (pre-production verification)

**Status:** The phased backend build ([phase playbook](../execution/phases/README.md)) is **implemented** through Phase 17. This document lists what you still **verify or run** before treating the system as **production-ready** for real users. Passing local dev checks does not replace environment-specific and operational validation.

---

## Platform (e.g. Railway or similar)

- [ ] Confirm deploy pipeline: `npm install` → `npx prisma migrate deploy` → `npm start` succeeds on a **staging** service that mirrors production.
- [ ] Set `DATABASE_URL`, `PORT`, and app secrets only via the host’s env UI (never commit `.env`).
- [ ] Hit `GET /health` and `GET /api/v1/health` on the **public staging URL** (HTTPS) and confirm `200` JSON.
- [ ] Review production logs: ensure stack traces and internal errors are not leaked to clients; 5xx responses use generic messages where appropriate.

---

## LINE (Messaging API + webhook)

- [ ] Use **production** channel `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` in the deployed environment.
- [ ] Register webhook URL as **HTTPS** in LINE Developers Console; verify callback succeeds.
- [ ] Ensure **`LINE_CHANNEL_SECRET` is set in production** so webhook requests are signature-verified (do not rely on the dev-only code path that accepts unsigned JSON).
- [ ] Send a test message to the bot; confirm `POST /webhook` returns `200` and events are handled.
- [ ] Test **push** messages (appointment reminders, caregiver notify, medication reminders) with a real LINE test user.
- [ ] If you use Rich Menu or postbacks, exercise those flows against staging.

---

## Cloudinary and OCR

- [ ] Set `CLOUDINARY_URL` in production; confirm document create with a real HTTPS image URL works end-to-end.
- [ ] Decide OCR behavior: `OCR_DISABLED=true` vs `OCR_PROVIDER=openai` with `OPENAI_API_KEY` (see [`famcare-backend/src/services/ocrService.js`](../famcare-backend/src/services/ocrService.js)). Verify `ocrText` is populated when OCR is enabled.
- [ ] Current state reminder: OCR is intentionally disabled (`OCR_DISABLED=true`, no `OCR_PROVIDER`). Before go-live, revisit and either keep OCR off by design or enable it with explicit provider config + validation test.
- [ ] Run one real OCR smoke test using an actual Thai document image (not mocked) after enabling OCR in staging.
- [ ] Confirm Prisma document migration is applied on a reachable staging/prod DB via deploy flow (`npx prisma migrate deploy`) since local `migrate dev` previously hit Railway connectivity error (P1001).

---

## Cron jobs and time

- [ ] Confirm the host keeps the Node process **long-running** (crons run in-process via `node-cron`).
- [ ] On staging, seed an appointment with reminders and/or medication schedules in the **near future**; verify LINE pushes fire at expected **Asia/Bangkok**-aligned times (see medication/appointment dispatch services).
- [ ] Spot-check logs for `[cron]` / `[reminder]` / `[med-reminder]` without duplicate spam (idempotency flags in DB).

---

## Data, PDPA, and account lifecycle

- [ ] Run `DELETE /api/v1/me` on **staging** with a test `x-line-userid`; confirm response `{ "data": { "deleted": true } }` and that owned data is removed (use DB console or Prisma Studio against staging DB only).
- [ ] Confirm **privacy policy**, consent copy, and data subject flows align with [prd.md](../product/prd.md) PDPA section (product/legal work—not only backend).
- [ ] Document internal process for **data breach notification** within 72 hours if required.

---

## API testing against staging

- [ ] Point [Bruno](../famcare-backend/bruno/) (or Postman) at the **staging base URL**; run critical flows: `GET /me`, family members, access grant/revoke, appointments, medications, health metrics, documents, symptom logs, `DELETE /me`.
- [ ] Use distinct LINE user id headers to simulate owner vs caregiver vs viewer (403/200 expectations).

---

## Out of scope for backend-only (track separately)

These are **not** proven by backend completion alone:

- Web dashboard or **LINE Login** web client integration (if different from header-based testing).
- **iOS app** and production LINE Login OAuth.
- Load testing, penetration testing, rate limiting, DDoS protection.
- Automated **backups** and restore drills for PostgreSQL.
- **Monitoring / alerting** (uptime, error rate, disk, DB connections).
- Custom domain, TLS certificates (if not provided by PaaS).

Add rows above when you add these to scope.

---

## PRD coverage: backend vs full product ([prd.md](../product/prd.md))

**Summary:** The phased backend ([phase playbook](../execution/phases/README.md), Phase 17) delivers **APIs, data model, LINE webhook/push hooks, and crons** for most MVP domains. It does **not** by itself satisfy every **product-level** promise in the PRD (LINE chat UX, web dashboard, image/PDF exports, freemium enforcement, full coordination suite). Use this section to set expectations before go-live.

### Where the backend largely aligns

| PRD area | Backend support |
|----------|-----------------|
| Family members | CRUD, roles, profile-style fields (age is derived from `dateOfBirth` on clients) |
| Appointments | CRUD, status, filters, coordination fields (`accompaniedByUserId`, notes) |
| Appointment reminders | Fixed offsets 7d / 2d / 1d / 2h; cron + LINE push |
| Medications | CRUD, schedules, logs, missed-dose alerts (member-level toggle) |
| Documents | Store by member/type, HTTPS URL, OCR hook, search |
| Health metrics | CRUD, types including CUSTOM, simple abnormal flags |
| Symptom logs | CRUD, severity, `attachmentUrl` (e.g. voice file URL from LINE) |
| Emergency info | Aggregated **JSON** per member |
| Pre-appointment report | Aggregated **JSON** (symptoms, adherence, metrics, suggested questions) |
| Caregiver → owner notify | LINE push where wired in services |
| PDPA delete | `DELETE /api/v1/me` hard-delete path |
| LINE | Webhook + push (not a full “product chat” on its own) |

### Gaps vs PRD wording (track, build on client, or defer)

- [ ] **Per-appointment customizable reminder times** — PRD asks for customization; current reminders use **fixed** offsets in `reminderService` (7d / 2d / 1d / 2h). Decide if/when to add per-appointment overrides in schema + API.
- [ ] **Freemium limits** (e.g. 2 members, history window) — PRD business model; **not** enforced in backend unless you add billing/feature flags.
- [ ] **Trend graphs** — PRD points at web dashboard; backend exposes **series data** only—graphs are a **client** concern.
- [ ] **Emergency card “share as image”** — Needs LINE Flex / client rendering or an image service; backend returns **data**, not a rendered card image.
- [ ] **Pre-appointment PDF/image export** — PRD mentions export; backend is **JSON-first**; add PDF/image generation or keep export in client if acceptable.
- [ ] **Refill reminders from quantity/duration** — Confirm whether automated refill logic meets PRD or remains manual/partial.
- [ ] **Family coordination** (tasks, volunteer, shared calendar, notification matrix) — **Partial** (e.g. `accompaniedByUserId`, appointment queries); full PRD scope may need more product + API work.
- [ ] **Natural Thai conversation, group chat behavior, voice → text for logging** — Requires NLP/STT and LINE UX beyond thin webhook handling; **not** a full conversational pipeline in the current backend.
- [ ] **“Web app if LINE is down”** — Requires the **web dashboard** (PRD Phase 2); backend alone does not deliver that UX.

### How to describe status to stakeholders

- **Backend (API + DB + LINE/cron hooks):** MVP-shaped and matches the **technical backbone** of most PRD feature areas, with the gaps above.
- **“Satisfies all features in prd.md” as an end-to-end product:** **No** — the PRD also describes LINE experience, web app, exports, and business rules that need **clients**, **ops**, and possibly **additional backend** work.

---

## Related docs

| Doc | Use |
|-----|-----|
| [prd.md](../product/prd.md) | Product scope and PDPA expectations |
| [backend.md](../architecture/backend.md) | API conventions |
| [DECISION_LOG.md](../decisions/DECISION_LOG.md) | Implementation vs spec drift |
| [famcare-backend/README.md](../famcare-backend/README.md) | Local run and deploy commands |
