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
