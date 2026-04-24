# Feature 6 — Health Metrics Logging — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Health Metrics Logging feature is implemented. Run the specific test assertions listed below and fix any failures in the implementation. All 5 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/healthMetrics.js` | REST route handlers |
| `famcare-backend/src/services/healthMetricService.js` | createMetric, listMetrics, flagAbnormal |
| `famcare-backend/src/services/healthMetricThresholdService.js` | Abnormal value thresholds |
| `famcare-backend/src/tests/health_metric.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | HealthMetric model |

## API Surface Being Tested

```
POST  /api/v1/metrics
GET   /api/v1/metrics?memberId=&type=&from=&to=
```

## Metric Types

`BLOOD_PRESSURE`, `BLOOD_SUGAR`, `WEIGHT`, `TEMPERATURE`, `CUSTOM`

## Tasks

1. Run the health metrics tests:
   ```bash
   cd famcare-backend && npx jest health_metric --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - Log blood pressure → stored with correct UTC timestamp
   - GET with `from` and `to` date params → correctly filters to that range
   - Abnormal value (systolic >140 for BLOOD_PRESSURE) → `isAbnormal: true` in the response
   - Custom metric type with label → stored and returned with the custom label
   - Trend data: GET returns an array of values suitable for graphing (chronological order)
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest health_metric --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Log blood pressure → stored with correct UTC timestamp
- GET with date range → correct filtering
- Abnormal value (systolic >140) → isAbnormal: true in response
- Custom metric type → stored with label
- Trend data array returned correctly for graphing
