# Phase 10 — Medications + MedicationLog

## Goal

- **Medication** CRUD per `FamilyMember` with access checks.
- **`MedicationLog`**: create entries with `status` (`TAKEN` | `MISSED` | `SKIPPED`), `takenAt`, `loggedByUserId`.
- **List logs** by medication id (newest first or chronological—document).
- Optional: **refill hint** from `quantity` and `endDate` in service response (simple math).

## Prerequisites

- [Phase 9](phase9.md) pattern for caregiver notify on create

## Step-by-step

1. **`services/medicationService.js`**
   - CRUD medications; enforce write access; VIEWER read-only.
   - `POST /api/v1/medications/:id/logs` or nested route to append log.

2. **Routes**
   - `GET/POST /api/v1/medications`, `GET/PATCH/DELETE /api/v1/medications/:id`
   - `GET /api/v1/medications/:id/logs`, `POST` to add log

3. **Notify owner**
   - On caregiver-created medication or new log, call `notifyOwnerIfCaregiver`.

4. **Bruno**
   - Full flow: create med → add TAKEN log.

## Definition of done

- All endpoints return `{ data }` or proper errors.
- `addedByUserId` set from authenticated user on create.

## Verify

curl/Bruno with caregiver vs owner headers.

## Next

[phase11.md](phase11.md)
