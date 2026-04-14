# Phase 17 — PDPA hard delete + Railway + Bruno regression

## Goal

- **`DELETE /api/v1/me`** (or `POST /api/v1/account/delete`): authenticated user **hard-deletes** their data: owned `FamilyMember` trees, `FamilyAccess` rows, `User` row. Handle **`addedById`** FK: before deleting a user who added records for others, **reassign** `addedById` to `ownerId` of that member (or migrate per product decision—document).
- **Railway**: Postgres + Node service; set `DATABASE_URL`, LINE secrets, `CLOUDINARY_URL`, `PORT` from platform.
- **`bruno/`** collection covers all routes introduced; run manual regression before release.

## Prerequisites

- All feature phases complete

## Step-by-step

1. **`services/userService.js` — `deleteUserAndData(userId)`**
   - Transaction order: delete child data of owned members (reminders → appointments → medication logs → schedules → medications → metrics → documents → symptom logs → emergency contacts → family access on those members → members); fix `addedBy` references for members this user added but does not own; clear `Appointment.accompaniedByUserId` if it points to deleted user; delete `FamilyAccess` where user is grantor/grantee; delete user.

2. **Route**
   - `DELETE /api/v1/me` with `requireLineUser` — returns `{ data: { deleted: true } }`.

3. **Railway**
   - Create PostgreSQL plugin; copy connection string to service env.
   - Build command: `npm install && npx prisma migrate deploy && npm start` (set in Railway).
   - Run migrations on deploy.

4. **Bruno**
   - Folder per resource; environment variables for `BASE_URL` and `LINE_USER_ID`.

5. **README**
   - Production checklist: HTTPS webhook URL, rotate secrets, PDPA wording in app (product—not only backend).

## Definition of done

- After delete, `x-line-userid` same as before recreates **new** empty user (new `id`).
- No orphan rows in DB (verify with Prisma Studio).

## Verify

1. Create data; call DELETE me; confirm counts zero for owned members.
2. Deploy staging; hit `/health` and one authenticated route.

## Done

Backend MVP implementation complete per [docs/product/prd.md](../../product/prd.md) scope for API + LINE.
