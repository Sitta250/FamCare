# Phase 6 — Appointments + Reminder rows

## Goal

Full **Appointment** CRUD scoped by `assertCanRead` / `assertCanWrite` (VIEWER read-only). On **create** and when **`appointmentAt`** changes, **sync** `Reminder` rows for types: `SEVEN_DAYS`, `TWO_DAYS`, `ONE_DAY`, `TWO_HOURS` — each `scheduledAt` = `appointmentAt` minus offset. Delete **unsent** reminders before recreating; skip times already in the past at sync moment.

## Prerequisites

- [Phase 5](phase5.md) complete

## Step-by-step

1. **`services/appointmentService.js`**
   - Create with `addedByUserId = req.user.id`.
   - Update status: `UPCOMING` | `COMPLETED` | `CANCELLED` | `MISSED`.
   - List/filter: query params `familyMemberId`, `status`, `from`, `to` (ISO datetimes, interpreted as UTC or document convention).

2. **`services/reminderService.js`**
   - `syncRemindersForAppointment(appointmentId)` — transaction: delete reminders where `sent = false`; insert new rows for each type if `scheduledAt > now`.

3. **Offsets (fixed)**
   - 7 days, 2 days, 1 day, 2 hours (milliseconds from `appointmentAt`).

4. **Routes**
   - `GET/POST /api/v1/appointments`, `GET/PATCH/DELETE /api/v1/appointments/:id`.

5. **Caregiver notify**
   - Stub hook (no LINE yet) or skip until Phase 9; if you call `notifyOwnerIfCaregiver`, implement in Phase 9.

6. **Bruno**
   - Create appointment in future → DB has up to 4 reminders with correct `scheduledAt`.

## Definition of done

- Editing `appointmentAt` replaces future unsent reminders.
- Completed/cancelled appointments: either leave reminders unsent or delete in service—document choice.

## Verify

Prisma Studio: `Reminder` rows match appointment time math (UTC storage).

## Next

[phase7.md](phase7.md)
