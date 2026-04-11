# Phase 3 — API conventions, auth middleware, User upsert

## Goal

- Global JSON error shape (already have `errorHandler`—align thrown errors with `{ error, code }` and `status`).
- Middleware reads **`x-line-userid`** (LINE’s user id string), upserts **`User`** by `lineUserId`, attaches internal user id as **`req.userId`** (or `req.user`).
- **`GET /api/v1/me`** returns `{ data: user }` with safe fields.

## Prerequisites

- [Phase 2](phase2.md) complete

## Step-by-step

1. **`services/userService.js`**
   - `findOrCreateByLineUserId(lineUserId, { displayName?, photoUrl? })`.
   - If user exists, optionally update display name/photo from headers (see below).

2. **`middleware/auth.js`**
   - Require header `x-line-userid` (trimmed). If missing → `401` `{ error, code: "UNAUTHORIZED" }`.
   - Optional headers for bootstrap: `x-line-displayname`, `x-line-photourl` (or skip and use placeholder `"LINE User"` until LINE Login exists).
   - Call `findOrCreateByLineUserId`, set `req.user` (full user row) and `req.lineUserId`.

3. **`routes/me.js`**
   - `GET /` mounted at `/me` under `/api/v1`: use `requireLineUser`, respond `{ data: { id, lineUserId, displayName, photoUrl, phone, createdAt } }`.
   - Format `createdAt` in Asia/Bangkok for responses (helper in `src/utils/datetime.js`).

4. **`routes/index.js`**
   - Create Express `Router`, apply `express.json()`, mount `/me` with auth.
   - Export router.

5. **`src/index.js`**
   - After `express.json()`, `app.use("/api/v1", apiRouter)` **before** `errorHandler`.

6. **Errors**
   - Use a small helper `httpError(status, message, code)` or `throw Object.assign(new Error(msg), { status, code })` consumed by `errorHandler`.

## Definition of done

- Without `x-line-userid` → 401 JSON.
- With header → 200 and stable `User` row on repeat calls (same `lineUserId` → same `id`).

## Verify

```bash
curl -s -H "x-line-userid: test-line-1" http://localhost:3000/api/v1/me
curl -s -H "x-line-userid: test-line-1" -H "x-line-displayname: Tester" http://localhost:3000/api/v1/me
```

## Next

[phase4.md](phase4.md)
