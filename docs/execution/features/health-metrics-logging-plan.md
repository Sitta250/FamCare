# Health Metrics Logging — Implementation Plan

> Generated for agent consumption. Do not implement code until all tasks are confirmed.
> Saved at: `docs/execution/features/health-metrics-logging-plan.md`

---

## Pre-Read Required

Before implementing any task, read these files first:

| File | Why |
|------|-----|
| `famcare-backend/prisma/schema.prisma` | Current `HealthMetric` model and `MetricType` enum |
| `famcare-backend/src/services/healthMetricService.js` | Existing service — understand what is already built |
| `famcare-backend/src/routes/healthMetrics.js` | Existing route — thin wrapper, already correct shape |
| `famcare-backend/src/services/accessService.js` | Permission helpers (`assertCanReadMember`, `assertCanWriteMember`, `assertOwnerForMember`) |
| `famcare-backend/src/utils/datetime.js` | `toBangkokISO()`, `utcInstantFromBangkokYmdHm()` |
| `famcare-backend/src/tests/document_crud.test.js` | ESM test pattern to follow exactly |
| `famcare-backend/CLAUDE.md` | All conventions, constraints, error handling rules |

---

## Context

The `HealthMetric` model, route (`/health-metrics`), and service (`healthMetricService.js`) already exist with basic CRUD. The route is mounted at `/api/v1/health-metrics` in `src/routes/index.js`.

**Gaps vs. the full product requirement:**

1. **No `label` field** — `CUSTOM` type has no way to store a custom name (e.g., "INR", "SpO2")
2. **No `value2` field** — Blood pressure requires two values (systolic + diastolic); currently only one `Float` stored
3. **Wrong BP abnormal threshold** — Current code flags systolic `> 180`; requirement is `> 140`
4. **Wrong response field name** — Service returns `abnormal`; spec requires `isAbnormal`
5. **No enum validation** — Invalid `type` values bypass app-level validation and hit Prisma uncontrolled
6. **No per-member configurable thresholds** — All thresholds are global hardcoded constants
7. **No tests** — No test file exists for health metrics

**Path and param conventions:** The user spec mentions `/api/v1/metrics` and `memberId`. Use the existing **`/api/v1/health-metrics`** path and **`familyMemberId`** param to avoid breaking the iOS client.

---

## Goal Summary

| Dimension | Current State | Target State |
|-----------|--------------|-------------|
| Route path | `/api/v1/health-metrics` | Same — no change |
| Types supported | BLOOD_PRESSURE, BLOOD_SUGAR, WEIGHT, TEMPERATURE, CUSTOM | Same |
| CUSTOM label | Not stored (no `label` field) | `label String?` — required when type = CUSTOM |
| Blood pressure | Single `Float value` (systolic only) | `value` (systolic) + `value2 Float?` (diastolic) |
| BP abnormal check | Systolic `> 180` | Systolic `> 140` OR diastolic `> 90` |
| Abnormal field name | `abnormal` | `isAbnormal` |
| Input validation | Partial (missing enum check, no label enforcement) | Full validation including enum, label, numeric |
| Per-member thresholds | None (global constants only) | `MetricThreshold` model; OWNER can override per type |
| Tests | None | Full Jest coverage: CRUD, filters, abnormal logic, CUSTOM label |

**In scope:**
- Schema: add `label`, `value2` to `HealthMetric`; add `MetricThreshold` model
- Service: fix thresholds, rename response field, add validation, per-member threshold lookup
- Route: add threshold sub-routes (`GET/PUT/DELETE /:memberId/thresholds/:type`)
- New service file: `healthMetricThresholdService.js`
- New test file: `health_metric.test.js`

**Out of scope:**
- Frontend (separate repo)
- Renaming the route path from `/health-metrics` to `/metrics`
- Trend aggregation / statistics (GET already returns chronological array; graphing is a client concern)

---

## Existing Files / Modules Involved

| File | Status | Change Needed |
|------|--------|--------------|
| `famcare-backend/prisma/schema.prisma` | Exists | Add `label String?`, `value2 Float?` to `HealthMetric`; add `MetricThreshold` model; add relation to `FamilyMember` |
| `famcare-backend/src/services/healthMetricService.js` | Exists | Add validation, fix thresholds, rename field, accept `label`/`value2`, lookup per-member threshold |
| `famcare-backend/src/routes/healthMetrics.js` | Exists | Add threshold sub-routes |
| `famcare-backend/src/services/healthMetricThresholdService.js` | **New** | CRUD for per-member threshold overrides |
| `famcare-backend/src/tests/health_metric.test.js` | **New** | Full Jest test coverage |

---

## Data Model Changes

### 1. Modify `HealthMetric`

Add two nullable fields. Both must be nullable for backward compatibility with existing rows.

```prisma
model HealthMetric {
  id             String     @id @default(cuid())
  familyMemberId String
  addedByUserId  String
  type           MetricType
  value          Float        // systolic for BP; primary value for all other types
  value2         Float?       // diastolic for BP; null for all other types
  unit           String
  label          String?      // required when type = CUSTOM; null for all other types
  note           String?
  measuredAt     DateTime
  createdAt      DateTime   @default(now())

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id], onDelete: Cascade)
}
```

### 2. Add `MetricThreshold` model

```prisma
model MetricThreshold {
  id             String     @id @default(cuid())
  familyMemberId String
  type           MetricType
  unit           String
  minValue       Float?     // e.g. systolic low; null = no lower bound
  maxValue       Float?     // e.g. systolic high
  minValue2      Float?     // diastolic low for BP
  maxValue2      Float?     // diastolic high for BP
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  familyMember FamilyMember @relation(fields: [familyMemberId], references: [id], onDelete: Cascade)

  @@unique([familyMemberId, type])
}
```

### 3. Add relation to `FamilyMember`

```prisma
metricThresholds MetricThreshold[]
```

### Migration commands

```bash
cd famcare-backend
npx prisma migrate dev --name add_health_metric_label_value2_thresholds
npx prisma generate
npm run check   # validate schema
```

---

## API Changes

### Modified: `POST /api/v1/health-metrics`

New optional fields accepted in the body.

**CUSTOM type request:**
```json
{
  "familyMemberId": "member-abc",
  "type": "CUSTOM",
  "label": "INR",
  "value": 2.3,
  "unit": "ratio",
  "measuredAt": "2025-06-01T09:00:00+07:00"
}
```

**BLOOD_PRESSURE request:**
```json
{
  "familyMemberId": "member-abc",
  "type": "BLOOD_PRESSURE",
  "value": 145,
  "value2": 92,
  "unit": "mmHg",
  "measuredAt": "2025-06-01T09:00:00+07:00"
}
```

**Response (all types) — note `isAbnormal` (not `abnormal`):**
```json
{
  "data": {
    "id": "clxyz...",
    "familyMemberId": "member-abc",
    "addedByUserId": "user-1",
    "type": "BLOOD_PRESSURE",
    "value": 145,
    "value2": 92,
    "label": null,
    "unit": "mmHg",
    "note": null,
    "isAbnormal": true,
    "measuredAt": "2025-06-01T09:00:00.000+07:00",
    "createdAt": "2025-06-01T09:00:05.000+07:00"
  }
}
```

### Modified: `GET /api/v1/health-metrics`

No change to query params. Response now includes `label`, `value2`, and `isAbnormal` on every row.

Trend usage (blood sugar example):
```
GET /api/v1/health-metrics?familyMemberId=abc&type=BLOOD_SUGAR&from=2025-01-01T00:00:00Z
```
Returns array ordered by `measuredAt: 'asc'` — suitable for graphing.

### New: `GET /api/v1/health-metrics/:memberId/thresholds`

Returns all per-member threshold overrides. Empty array if none set.

```json
{ "data": [{ "type": "BLOOD_PRESSURE", "unit": "mmHg", "minValue": 90, "maxValue": 130, "maxValue2": 85, ... }] }
```

### New: `PUT /api/v1/health-metrics/:memberId/thresholds/:type`

Upserts a threshold override. Owner only.

**Request:**
```json
{ "unit": "mmHg", "minValue": 90, "maxValue": 130, "minValue2": 60, "maxValue2": 85 }
```

**Response:** `200 { "data": { threshold record } }`

### New: `DELETE /api/v1/health-metrics/:memberId/thresholds/:type`

Removes override; subsequent `isAbnormal` checks revert to global defaults.

**Response:** `204`

---

## Frontend Changes

None. This is a backend-only repository.

---

## Edge Cases

| Case | Handling |
|------|---------|
| `type = CUSTOM` without `label` | `400 BAD_REQUEST`: "label is required for CUSTOM type" |
| `type = BLOOD_PRESSURE` with `value2` omitted | Store `value2: null`; abnormal check uses systolic only |
| Invalid `type` string (not in `MetricType` enum) | `400 BAD_REQUEST` before Prisma sees it |
| `value` is non-numeric | `Number(value)` → `isNaN` check → `400 BAD_REQUEST` |
| `value2` provided for non-BP type | Accept and store; no harm, client may send extra data |
| `from`/`to` parse fails (`new Date` → NaN) | `400 BAD_REQUEST`: "from must be a valid ISO date" |
| Per-member threshold missing for a type | Falls back silently to global `ABNORMAL_THRESHOLDS` constant |
| CUSTOM type with per-member threshold set | `isAbnormal` uses that threshold; otherwise always `false` |
| `WEIGHT` type | Always `isAbnormal: false` globally; per-member threshold can enable it |
| Concurrent threshold upserts | `@@unique([familyMemberId, type])` + Prisma `upsert` is safe |
| `measuredAt` in far future | Accepted — no server-side date ceiling; client responsibility |
| N+1 in `listHealthMetrics` | Batch-load all thresholds for the member once before `rows.map(formatMetric)` |
| CAREGIVER tries to set threshold | `403 FORBIDDEN` — only OWNER can upsert/delete thresholds |

---

## Implementation Tasks

---

### Task 1 — Schema: Add `label`, `value2` to `HealthMetric` and add `MetricThreshold` model

**Purpose:** Extend the database schema to support CUSTOM metric labels, blood pressure diastolic values, and per-member threshold configuration. All downstream tasks depend on this migration.

**Files to modify:**
- `famcare-backend/prisma/schema.prisma`

**Pattern to follow:** Existing optional fields (`note String?`, `photoUrl String?`) for nullable additions. `MedicationSchedule` model for the new child model relation pattern.

**Acceptance criteria:**
- `HealthMetric` has `label String?` and `value2 Float?`
- `MetricThreshold` model exists with all fields as specified in Data Model Changes section
- `FamilyMember` has `metricThresholds MetricThreshold[]` relation
- `npx prisma validate` passes with zero errors
- `npx prisma migrate dev` succeeds — migration file created in `prisma/migrations/`
- `npx prisma generate` completes — no TypeScript errors in generated client

**Tests to add:** None at this step (schema-only; tested indirectly by Tasks 2–5)

**Verification commands:**
```bash
cd famcare-backend
npx prisma validate
npx prisma migrate dev --name add_health_metric_label_value2_thresholds
npx prisma generate
npm run check
```

**Constraints:**
- No new npm dependencies
- Both new `HealthMetric` fields must be nullable (preserve backward compatibility with existing rows)
- Follow existing field ordering in schema (id → foreign keys → typed fields → nullable fields → timestamps)

**Risks / edge cases:**
- Existing `HealthMetric` rows will have `value2 = null` and `label = null` — Prisma applies `NULL` default automatically for nullable fields, so no data migration script needed
- Confirm the running database has no `NOT NULL` constraints that would conflict (unlikely but check migration output)

**Dependencies:** None — first task

---

### Task 2 — Service: Input validation, `label`/`value2` support, `isAbnormal` rename

**Purpose:** Add robust input validation before any DB write, enforce `label` requirement for CUSTOM type, accept `value2` in create/update, and rename the response field from `abnormal` to `isAbnormal` in all payloads.

**Files to modify:**
- `famcare-backend/src/services/healthMetricService.js`

**Pattern to follow:** `documentService.js` for field-level validation with `throw Object.assign(new Error(...), { status: 400, code: 'BAD_REQUEST' })`. Follow the existing validation block in `createHealthMetric`.

**Valid MetricType values** (validate against this set in code):
```js
const VALID_TYPES = new Set(['BLOOD_PRESSURE', 'BLOOD_SUGAR', 'WEIGHT', 'TEMPERATURE', 'CUSTOM'])
```

**Changes to `createHealthMetric`:**
1. After `type` null check, add: `if (!VALID_TYPES.has(type)) throw ...`
2. After type validation: `if (type === 'CUSTOM' && (!label || !String(label).trim())) throw ...`
3. Validate `value`: `if (isNaN(Number(value))) throw ...`
4. If `value2` provided: `if (isNaN(Number(value2))) throw ...`
5. Store: add `label: type === 'CUSTOM' ? String(label).trim() : null` and `value2: value2 != null ? Number(value2) : null` to `prisma.healthMetric.create`

**Changes to `updateHealthMetric`:**
- Accept `label` and `value2` from body
- Include in the conditional spread: `...(label !== undefined && { label })`, `...(value2 !== undefined && { value2: value2 != null ? Number(value2) : null })`

**Changes to `formatMetric`:**
- Rename `abnormal: isAbnormal(m)` → `isAbnormal: isAbnormal(m)`
- Add `label: m.label ?? null` and `value2: m.value2 ?? null` to spread

**Acceptance criteria:**
- `POST` with `type: "INVALID"` → `400 { "code": "BAD_REQUEST" }`
- `POST` with `type: "CUSTOM"`, no `label` → `400 { "code": "BAD_REQUEST" }`
- `POST` with `type: "CUSTOM"`, `label: "INR"` → `201` with `label: "INR"` in response
- `POST` with `type: "BLOOD_PRESSURE"`, `value: 145`, `value2: 92` → `201` with `value: 145, value2: 92`
- All responses include `isAbnormal` (not `abnormal`)
- All responses include `label` and `value2` fields (null for non-CUSTOM/non-BP)
- `POST` with `value: "not-a-number"` → `400`

**Tests to add:** Covered by Task 5

**Verification commands:**
```bash
cd famcare-backend
npm test
```

**Constraints:**
- No new npm dependencies
- Do NOT change the route file in this task
- `label` stored as trimmed string; reject empty string same as missing

**Risks / edge cases:**
- **Breaking change**: renaming `abnormal` → `isAbnormal` will break any iOS client code reading this field. Confirm with product team before deploying. Consider a transition period or add both fields temporarily.
- `PATCH` with `label: null` explicitly → should clear the label (set to null in DB); this is valid for non-CUSTOM types

**Dependencies:** Task 1 (schema must have `label` and `value2` columns before this runs)

---

### Task 3 — Service: Fix abnormal detection thresholds + incorporate diastolic

**Purpose:** Correct the global abnormal thresholds to use clinically appropriate values and update the `isAbnormal` function to use `value2` (diastolic) for blood pressure checks.

**Files to modify:**
- `famcare-backend/src/services/healthMetricService.js`

**Current code (wrong):**
```js
BLOOD_PRESSURE: ({ value, unit }) => {
  if (unit === 'mmHg') return value > 180 || value < 90
  return false
},
```

**Replacement thresholds** (add comment: "Standard population defaults — not personalized medical advice"):
```js
// Standard population defaults — not personalized medical advice.
// Override per member via MetricThreshold (Task 4).
const ABNORMAL_THRESHOLDS = {
  BLOOD_PRESSURE: ({ value, value2, unit }) => {
    if (unit !== 'mmHg') return false
    const systolicHigh = value > 140
    const systolicLow = value < 90
    const diastolicHigh = value2 != null && value2 > 90
    const diastolicLow = value2 != null && value2 < 60
    return systolicHigh || systolicLow || diastolicHigh || diastolicLow
  },
  BLOOD_SUGAR: ({ value, unit }) => {
    if (unit === 'mg/dL') return value > 126 || value < 70
    if (unit === 'mmol/L') return value > 7.0 || value < 3.9
    return false
  },
  WEIGHT: () => false,
  TEMPERATURE: ({ value, unit }) => {
    if (unit === '°C') return value > 37.5 || value < 35.0
    if (unit === '°F') return value > 99.5 || value < 95.0
    return false
  },
  CUSTOM: () => false,
}
```

**`isAbnormal` helper** — accepts metric row (which now includes `value2`):
```js
function isAbnormal(metric, thresholdOverride = null) {
  // thresholdOverride is null in this task; wired in Task 4
  const fn = ABNORMAL_THRESHOLDS[metric.type]
  return fn ? fn(metric) : false
}
```

**Acceptance criteria:**
- BP `value: 145, unit: "mmHg"` → `isAbnormal: true`
- BP `value: 120, value2: 80, unit: "mmHg"` → `isAbnormal: false`
- BP `value: 120, value2: 95, unit: "mmHg"` → `isAbnormal: true` (diastolic high)
- BP `value: 85, unit: "mmHg"` → `isAbnormal: true` (systolic low)
- Blood sugar `value: 130, unit: "mg/dL"` → `isAbnormal: true`
- Blood sugar `value: 100, unit: "mg/dL"` → `isAbnormal: false`
- Temperature `value: 38, unit: "°C"` → `isAbnormal: true`
- Temperature `value: 37, unit: "°C"` → `isAbnormal: false`
- CUSTOM type → `isAbnormal: false`
- WEIGHT type → `isAbnormal: false`

**Tests to add:** Covered by Task 5

**Verification commands:**
```bash
cd famcare-backend
npm test
```

**Constraints:**
- Keep `isAbnormal` as a pure function (no DB calls in this task)
- Add the disclaimer comment above the constants
- No new npm dependencies

**Risks / edge cases:**
- Existing metrics with systolic 140–180 that were previously flagged `abnormal: false` will now return `isAbnormal: true` on read — correct behavior; alert product team
- mmol/L support is included; if product wants mg/dL only, remove the `mmol/L` branch

**Dependencies:** Task 1 (needs `value2` on the metric object), Task 2 (needs `isAbnormal` rename done first to avoid confusion)

---

### Task 4 — Schema + Service + Route: Per-member configurable thresholds

**Purpose:** Allow family member owners to override global thresholds per metric type. When a threshold override exists, `isAbnormal` uses it instead of the global constant. Enables personalized ranges (e.g., a patient with controlled hypertension targeting < 130).

**Files to modify/create:**
- `famcare-backend/src/services/healthMetricThresholdService.js` ← **new file**
- `famcare-backend/src/routes/healthMetrics.js` ← add 3 sub-routes
- `famcare-backend/src/services/healthMetricService.js` ← update `isAbnormal` + batch-load thresholds

**Pattern to follow:**
- `accessService.js` for per-member permission checks
- `medicationService.js` `updateMedicationSchedule` for upsert pattern
- `documentService.js` for error throwing convention

**New service file — `healthMetricThresholdService.js`:**

Implement three exported functions:
- `listThresholds(actorUserId, memberId)` — `assertCanReadMember` → `prisma.metricThreshold.findMany({ where: { familyMemberId: memberId } })`
- `upsertThreshold(actorUserId, memberId, type, body)` — `assertOwnerForMember` → validate `type` in `VALID_TYPES` → validate body fields are numeric if provided → `prisma.metricThreshold.upsert({ where: { familyMemberId_type: { familyMemberId: memberId, type } }, update: {...}, create: {...} })`
- `deleteThreshold(actorUserId, memberId, type)` — `assertOwnerForMember` → validate type → `prisma.metricThreshold.delete({ where: { familyMemberId_type: { familyMemberId: memberId, type } } })`; if not found, return silently (idempotent)

**New sub-routes in `healthMetrics.js`** (add BEFORE the `/:id` routes to avoid conflicts):
```js
router.get('/:memberId/thresholds', async (req, res, next) => { ... })
router.put('/:memberId/thresholds/:type', async (req, res, next) => { ... })
router.delete('/:memberId/thresholds/:type', async (req, res, next) => { ... })
```

**Update `healthMetricService.js`:**

1. Modify `listHealthMetrics` — batch-load thresholds before mapping to avoid N+1:
```js
const thresholds = await prisma.metricThreshold.findMany({ where: { familyMemberId } })
const thresholdMap = Object.fromEntries(thresholds.map(t => [t.type, t]))
return rows.map(row => formatMetric(row, thresholdMap[row.type] ?? null))
```

2. Modify `createHealthMetric` and `getHealthMetric` — load single threshold:
```js
const threshold = await prisma.metricThreshold.findUnique({
  where: { familyMemberId_type: { familyMemberId, type } }
})
return formatMetric(metric, threshold)
```

3. Update `formatMetric` signature: `function formatMetric(m, threshold = null)`

4. Update `isAbnormal` to use threshold when available:
```js
function isAbnormal(metric, threshold) {
  if (threshold) {
    const v = metric.value
    const v2 = metric.value2
    const { minValue, maxValue, minValue2, maxValue2 } = threshold
    const primaryFail = (maxValue != null && v > maxValue) || (minValue != null && v < minValue)
    const secondaryFail = v2 != null && (
      (maxValue2 != null && v2 > maxValue2) || (minValue2 != null && v2 < minValue2)
    )
    return primaryFail || secondaryFail
  }
  const fn = ABNORMAL_THRESHOLDS[metric.type]
  return fn ? fn(metric) : false
}
```

**Acceptance criteria:**
- `PUT /api/v1/health-metrics/abc/thresholds/BLOOD_PRESSURE` with `{ unit: "mmHg", maxValue: 130 }` → `200`
- Subsequent `POST` with `value: 135, unit: "mmHg"` → `isAbnormal: true` (custom threshold < 135)
- Default (no threshold): `value: 135` → `isAbnormal: false` (global threshold = `> 140`)
- CAREGIVER calls `PUT .../thresholds/...` → `403 FORBIDDEN`
- VIEWER calls `GET .../thresholds` → `200` (read allowed)
- `DELETE .../thresholds/BLOOD_PRESSURE` → `204`; next POST reverts to global default
- `PUT` with invalid `type` (e.g., `"INVALID"`) → `400 BAD_REQUEST`
- `listHealthMetrics` response has correct `isAbnormal` per row using threshold (no N+1 queries)

**Tests to add:** Covered by Task 5

**Verification commands:**
```bash
cd famcare-backend
npm test
```

**Constraints:**
- Only OWNER can write thresholds (`assertOwnerForMember`)
- CAREGIVER and VIEWER can read metrics with per-member thresholds applied
- Avoid N+1: batch-load thresholds in `listHealthMetrics`
- No new npm dependencies

**Risks / edge cases:**
- Sub-routes `/:memberId/thresholds` must be declared BEFORE `/:id` in the router or Express will match `/:id` first — double-check ordering in `healthMetrics.js`
- `familyMemberId_type` is the Prisma compound unique key name (auto-generated from `@@unique([familyMemberId, type])`)
- Deleting a threshold that doesn't exist should not throw 404 — treat as idempotent success
- `CUSTOM` type thresholds enable abnormal detection for custom metrics that would otherwise always be `false`

**Dependencies:** Task 1 (MetricThreshold model in schema), Task 3 (`isAbnormal` signature accepts threshold parameter)

---

### Task 5 — Tests: Full coverage for health metrics

**Purpose:** Create a comprehensive Jest test file covering all new and modified behaviors. No test file currently exists for health metrics.

**File to create:**
- `famcare-backend/src/tests/health_metric.test.js`

**Pattern to follow:** `famcare-backend/src/tests/document_crud.test.js` — copy the exact ESM mock setup structure:
1. Declare all `jest.fn()` mocks at top
2. Call `jest.unstable_mockModule` for `prisma`, `accessService`, `caregiverNotifyService`, `linePushService`
3. Dynamic `await import(...)` for the router AFTER all mocks
4. Build a minimal Express app with `supertest`
5. `beforeEach(() => { jest.clearAllMocks(); /* set default mock returns */ })`

**`fakeMetric()` builder:**
```js
function fakeMetric(overrides = {}) {
  return {
    id: 'metric-1',
    familyMemberId: 'member-abc',
    addedByUserId: 'user-1',
    type: 'BLOOD_PRESSURE',
    value: 120,
    value2: 80,
    label: null,
    unit: 'mmHg',
    note: null,
    measuredAt: new Date('2025-06-01T02:00:00Z'),  // 09:00 Bangkok
    createdAt: new Date('2025-06-01T02:00:05Z'),
    ...overrides,
  }
}
```

**Required test cases:**

| # | Description | Endpoint | Scenario | Assert |
|---|-------------|----------|----------|--------|
| 1 | Log BP — stored with correct UTC timestamp | `POST /api/v1/health-metrics` | `value: 120, value2: 80, unit: "mmHg"` | `res.body.data.measuredAt` ends with `+07:00`; `prisma.healthMetric.create` called |
| 2 | GET with date range → filtering applied | `GET ?familyMemberId=x&from=2025-01-01&to=2025-12-31` | Both dates in query | `prisma.healthMetric.findMany` called with `measuredAt.gte` and `.lte` |
| 3 | Systolic > 140 → `isAbnormal: true` | `POST` | `value: 145, unit: "mmHg"` | `res.body.data.isAbnormal === true` |
| 4 | Normal BP → `isAbnormal: false` | `POST` | `value: 120, value2: 80, unit: "mmHg"` | `res.body.data.isAbnormal === false` |
| 5 | Diastolic > 90 → `isAbnormal: true` | `POST` | `value: 120, value2: 95, unit: "mmHg"` | `res.body.data.isAbnormal === true` |
| 6 | CUSTOM with label → stored and returned | `POST` | `type: "CUSTOM", label: "INR", value: 2.3` | `res.status === 201`; `res.body.data.label === "INR"` |
| 7 | CUSTOM without label → 400 | `POST` | `type: "CUSTOM"`, no `label` | `res.status === 400`; `res.body.code === "BAD_REQUEST"` |
| 8 | Invalid type → 400 | `POST` | `type: "INVALID"` | `res.status === 400` |
| 9 | Trend: GET by type + from date | `GET ?type=BLOOD_SUGAR&from=2025-01-01&familyMemberId=x` | Filter applied | `prisma.healthMetric.findMany` called with `where.type === "BLOOD_SUGAR"` and `measuredAt.gte` |
| 10 | Temperature 38°C → `isAbnormal: true` | `POST` | `type: "TEMPERATURE", value: 38, unit: "°C"` | `res.body.data.isAbnormal === true` |
| 11 | Blood sugar 130 mg/dL → `isAbnormal: true` | `POST` | `type: "BLOOD_SUGAR", value: 130, unit: "mg/dL"` | `res.body.data.isAbnormal === true` |
| 12 | Access denied → 403 | `GET ?familyMemberId=x` | `assertCanReadMember` rejects | `res.status === 403`; `res.body.code === "FORBIDDEN"` |
| 13 | Missing `familyMemberId` → 400 | `GET` (no param) | No query param | `res.status === 400` |
| 14 | Response always includes `isAbnormal` (not `abnormal`) | `GET` | Normal response | `res.body.data[0].isAbnormal !== undefined`; `res.body.data[0].abnormal === undefined` |
| 15 | `value2` and `label` always in response | `GET` | Normal BP response | Both fields present (null for non-CUSTOM/non-BP) |

**Verification commands:**
```bash
cd famcare-backend
npm test -- --testPathPattern health_metric
npm test   # confirm no regressions in appointment, family, document tests
```

**Constraints:**
- No real DB calls — all Prisma methods mocked
- No real LINE calls — mock `caregiverNotifyService` and `linePushService`
- Use `jest.unstable_mockModule` NOT `jest.mock` (ESM project — see CLAUDE.md)
- ESM mock declarations must come before any `await import(...)` statements

**Risks / edge cases:**
- If Task 4 threshold lookup is wired into `createHealthMetric`, mock `prisma.metricThreshold.findUnique` in the test setup (return `null` by default to simulate no override)
- ESM mock order is strict — wrong order causes "module not initialized" errors; copy `document_crud.test.js` structure exactly
- `jest.clearAllMocks()` in `beforeEach` must be called before setting new return values

**Dependencies:** Tasks 1–4 must be complete before writing tests (all service signatures must be final)

---

## Safe Implementation Order

```
Task 1 (Schema migration)
    │
    ├──▶ Task 2 (Validation + label/value2 + field rename)
    │        │
    │        └──▶ Task 3 (Fix thresholds + diastolic logic)
    │                 │
    │                 └──▶ Task 4 (Per-member thresholds — schema + service + route)
    │                              │
    │                              └──▶ Task 5 (Tests — all behaviors)
```

Tasks 2 and 3 both modify `healthMetricService.js` — do them sequentially in the same coding session to avoid conflicts. Task 4 introduces a new file (`healthMetricThresholdService.js`) and adds sub-routes, so it is safely independent of Tasks 2–3 once Task 1 is done and Task 3 finalizes the `isAbnormal` signature.

---

## Global Risks & Ambiguities

| Risk | Severity | Recommendation |
|------|----------|---------------|
| `abnormal` → `isAbnormal` rename breaks existing iOS client | **High** | Confirm with product team before deploying Task 2. Consider running both fields in parallel for one release cycle. |
| Route path `/health-metrics` vs user spec `/metrics` | Medium | Plan uses existing `/health-metrics` to avoid breaking iOS. If a rename is needed, do it as a separate breaking-change task. |
| `familyMemberId` vs `memberId` in query param | Low | Plan uses existing `familyMemberId` per all other routes (medications, appointments, etc.) |
| BP stored as single float in existing rows | Low | Old records have `value2 = null`; all abnormal checks null-guard gracefully |
| mmol/L blood sugar support | Low | Thresholds included in plan; confirm with product whether the iOS app sends `mmol/L` or `mg/dL` only |
| N+1 in `listHealthMetrics` after Task 4 | Medium | Batch-load thresholds with one `findMany` call before mapping rows — see Task 4 |
| Sub-route ordering conflict in Express | Medium | `/:memberId/thresholds` routes must be declared BEFORE `/:id` in `healthMetrics.js` |
| PDPA: `MetricThreshold` stores health-adjacent data | Low | Model cascades on `FamilyMember` delete — no orphaned threshold data |
| `measuredAt` timezone interpretation | Medium | `from`/`to` query params currently parsed with `new Date(str)` — ISO strings with `+07:00` offset will parse correctly; bare `YYYY-MM-DD` strings will be interpreted as UTC midnight (7h off from Bangkok). Document expected format in API contract. |
