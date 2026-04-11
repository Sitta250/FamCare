# Phase 11 — Medication reminder + missed-dose job

## Goal

- Store **explicit reminder times** per medication (see Phase 2 `MedicationSchedule` or `reminderTimesJson`).
- **Cron** (reuse pattern from Phase 8): at each scheduled local time (Bangkok), send “time to take {drug}” push to appropriate users (owner + caregivers for that member).
- **Missed window**: if no `MedicationLog` with `TAKEN` within a configurable window after the scheduled time, and `FamilyMember.missedDoseAlertsEnabled` is true, push **missed dose** alert to owner + caregivers.

## Prerequisites

- [Phase 10](phase10.md) complete
- Phase 2 schema includes `MedicationSchedule` and `missedDoseAlertsEnabled`

## Step-by-step

1. **Migration** (if not done): `MedicationSchedule` table: `medicationId`, `timeLocal` (`"HH:mm"`).

2. **API**
   - `PUT /api/v1/medications/:id/schedule` with `{ times: ["08:00","20:00"] }` — replace rows in transaction.

3. **`medicationReminderDispatchService`**
   - Each cron tick (every minute): for today’s date in Bangkok, compute which schedules fire in the **current minute** (avoid duplicate sends with a `lastSentAt` on schedule or separate `MedicationReminderSent` table—MVP: in-memory debounce per server restart is fragile; prefer DB flag or compare minute precision).

4. **Missed detection**
   - Run a second pass: for schedules **older than** N minutes (e.g. 120) in the same day, check for `TAKEN` log covering that window; if not, send missed alert **once** per schedule instance (track sent missed in a small table or use `MedicationLog` MISS entry—simplest MVP: send at most one missed push per medication per local day).

5. **LINE**
   - Reuse `linePushService`.

## Definition of done

- Scheduled reminder message fires near expected clock time (test with short offset).
- Missed path fires when enabled and no TAKEN log.

## Verify

Seed medication + schedule for current minute + 2 min; observe push then missed path with manual DB inspection.

## Next

[phase12.md](phase12.md)
