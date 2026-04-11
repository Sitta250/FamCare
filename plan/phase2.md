# Phase 2 — PostgreSQL + Prisma full schema

## Goal

`prisma/schema.prisma` matches [context/schema.md](../context/schema.md), plus **minimal extensions** below. Migrations apply cleanly; Prisma Client generates; singleton client in `src/lib/prisma.js`.

## Prerequisites

- [Phase 1](phase1.md) complete
- Local or Docker **PostgreSQL** with a connection string

## Schema extensions (add in this phase)

PRD/backend needs features not in the original markdown block—add these so later phases do not rework FKs:

1. **`EmergencyContact`** — `id`, `familyMemberId`, `name`, `phone?`, `relation?`, `sortOrder`, timestamps. `onDelete: Cascade` from `FamilyMember`.
2. **`FamilyMember`**: `preferredHospital String?`, `missedDoseAlertsEnabled Boolean @default(true)`.
3. **`Appointment`**: `accompaniedByUserId String?` (FK to `User`, optional), `whoBringsNote String?`.
4. **`User`**: relation for `accompaniedAppointments` (inverse of `Appointment.accompaniedBy`).
5. **`Medication`**: optional `reminderTimesJson String?` (JSON array of `"HH:mm"` in Bangkok) **or** skip and use only `MedicationSchedule` (next phase can add `MedicationSchedule`: `medicationId`, `timeLocal`).
6. **`SymptomLog`**: `attachmentUrl String?` (voice/file URL from LINE).

Use `onDelete: Cascade` where a child cannot exist without the parent (e.g. reminders with appointment). For `User` deletion (Phase 17), document FK behavior; you may use `Restrict` on `addedById` and handle reassignment in code.

## Step-by-step

1. Add npm deps: `@prisma/client`, `prisma` (dev).
2. Add scripts to `package.json`: `"prisma:generate": "prisma generate"`, `"prisma:migrate": "prisma migrate dev"`.
3. Create `prisma/schema.prisma`: `generator` + `datasource postgresql` + all models/enums from [context/schema.md](../context/schema.md) **plus** extensions above.
4. Set `DATABASE_URL` in `.env` (copy from `.env.example`).
5. Run:
   ```bash
   cd famcare-backend
   npx prisma migrate dev --name init
   npx prisma generate
   ```
6. Add `src/lib/prisma.js`: export singleton `PrismaClient` (avoid multiple instances in dev hot-reload).
7. **Do not** mount DB routes yet—only schema + client.

## Definition of done

- `npx prisma migrate dev` succeeds on a fresh DB.
- `npx prisma studio` opens and shows tables.
- `node -e "import('./src/lib/prisma.js').then(m => m.prisma.$connect())"` exits 0.

## Verify

```bash
npx prisma validate
npx prisma studio
```

## Next

[phase3.md](phase3.md)
