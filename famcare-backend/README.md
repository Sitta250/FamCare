# FamCare backend

Node.js + Express API. See [`../plan/`](../plan/) for phased build instructions.

## Phase 1 — local run

```bash
cd famcare-backend
cp .env.example .env   # optional for Phase 1
npm install
npm run dev
```

Health checks:

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/v1/health
```

Expected: JSON with `"ok": true` and `"service": "famcare-backend"`.

## Environment (later phases)

Copy `.env.example` to `.env` and fill values. Never commit `.env`.

## Production (Railway / CI)

- Build / release: `npm install` then `npx prisma migrate deploy` then `npm start`.
- Set `DATABASE_URL`, `LINE_CHANNEL_*`, `CLOUDINARY_URL`, `PORT` on the platform.
- Quick schema check locally: `npm run check` (runs `prisma validate`).

## API testing (Bruno)

Open the [`bruno/`](bruno/) collection in [Bruno](https://www.usebruno.com/). Requests use `http://localhost:3000` by default—change the host if needed.

## PDPA account deletion

`DELETE /api/v1/me` with header `x-line-userid` removes the authenticated user and all data they own (see `deleteUserAndData` in `src/services/userService.js`). Response: `{ "data": { "deleted": true } }`. The next request with the same LINE id creates a new empty user.

## Before production

Implementation follows the [phase playbook](../plan/README.md), but **production readiness** still requires environment-specific checks (LINE HTTPS webhook, secrets, staging smoke tests, PDPA process, etc.). Use the repo checklist: **[context/GO_LIVE_CHECKLIST.md](../context/GO_LIVE_CHECKLIST.md)**.
