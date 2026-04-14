# Phase 1 — Repository bootstrap and health check

## Goal

A minimal **Node.js + Express** app under `famcare-backend/` that starts cleanly and exposes two health endpoints. No database, no LINE, no Prisma in this phase.

## Prerequisites

- Node.js **20+** installed
- Terminal at repo root: `famcare/`

## Step-by-step

1. **Confirm folder layout**
   - Backend lives in `famcare-backend/` (see [docs/architecture/backend.md](../../architecture/backend.md)).

2. **Dependencies (Phase 1 only)**
   - `package.json`: `"type": "module"`, dependencies: `express`, `dotenv`; dev: `nodemon`.
   - Scripts: `"dev": "nodemon src/index.js"`, `"start": "node src/index.js"`.

3. **Entry point**
   - `src/index.js`: `import "dotenv/config"`, create Express app, `app.use(express.json())`.
   - Register:
     - `GET /health` → `200`, JSON: `{ "ok": true, "service": "famcare-backend" }`
     - `GET /api/v1/health` → same body.
   - Mount `errorHandler` from `src/middleware/errorHandler.js` **after** routes (see existing file).
   - `listen(process.env.PORT || 3000)`.

4. **Error handler**
   - `src/middleware/errorHandler.js`: Express 4-arg handler; JSON `{ error, code }`; log 5xx errors.

5. **Environment template**
   - `.env.example` includes at least: `DATABASE_URL=`, `LINE_CHANNEL_SECRET=`, `LINE_CHANNEL_ACCESS_TOKEN=`, `CLOUDINARY_URL=`, `PORT=3000` (values filled in later phases).
   - `.gitignore`: `node_modules/`, `.env`, logs.

6. **README**
   - `famcare-backend/README.md`: how to `npm install`, `npm run dev`, and curl health URLs.

7. **Install and run**
   ```bash
   cd famcare-backend
   npm install
   npm run dev
   ```
   If port `3000` is busy, use `PORT=3456 npm run dev`.

## Definition of done

- `npm install` succeeds with no missing packages for Phase 1.
- Server starts without throwing.
- Both URLs return **200** and JSON with `"ok": true`.

## Verify (manual)

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/v1/health
```

Replace host/port if you changed `PORT`.

## Status

**Implemented:** Phase 1 is the current baseline for `famcare-backend/` (health routes + error handler only). Proceed to [phase2.md](phase2.md).
