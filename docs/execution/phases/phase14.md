# Phase 14 — SymptomLog timeline

## Goal

**SymptomLog** CRUD: `description`, `severity` (1–10), `note`, `loggedAt`, optional **`attachmentUrl`** (LINE voice URL or image). List timeline for a member: **newest first** (or ascending—pick one, document).

## Prerequisites

- [Phase 9](phase9.md)

## Step-by-step

1. **`services/symptomLogService.js`**
   - Validate `severity` bounds.
   - `GET` list filtered by `familyMemberId`, pagination optional (`limit`,`cursor`).

2. **Routes**
   - `GET/POST /api/v1/symptom-logs`, `GET/PATCH/DELETE /api/v1/symptom-logs/:id`

3. **Caregiver notify** on create.

4. **Bruno**

## Definition of done

- VIEWER read-only; CAREGIVER write.

## Verify

POST two logs; GET returns order per spec.

## Next

[phase15.md](phase15.md)
