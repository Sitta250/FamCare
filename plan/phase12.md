# Phase 12 — HealthMetric CRUD + range queries

## Goal

**HealthMetric** create/list with filters: `familyMemberId` (required), `type` (`MetricType` enum), `from`/`to` on `measuredAt`. Optional **`abnormal`** flag in response using simple thresholds (constants in service: e.g. BP systolic > 180—document as MVP heuristic).

## Prerequisites

- [Phase 9](phase9.md) notify pattern

## Step-by-step

1. **`services/healthMetricService.js`**
   - Create with `addedByUserId`; assert write access.
   - List ascending by `measuredAt` for charts.

2. **Routes**
   - `GET/POST /api/v1/health-metrics`, `GET/PATCH/DELETE /api/v1/health-metrics/:id`

3. **Caregiver notify** on create if not owner.

4. **Bruno**
   - Seed several metrics; GET with date range.

## Definition of done

- VIEWER cannot POST; CAREGIVER can.

## Verify

curl with query params URL-encoded ISO datetimes.

## Next

[phase13.md](phase13.md)
