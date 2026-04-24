# Feature 12 — Insurance Card Storage — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Insurance Card Storage feature is implemented (upload + OCR, manual entry, role-based masking, expiration tracking cron). Run the specific test assertions listed below and fix any failures in the implementation. All 8 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/insurance.js` | REST route handlers |
| `famcare-backend/src/services/insuranceService.js` | createInsuranceCard, listInsuranceCards, updateInsuranceCard, softDeleteInsuranceCard, checkExpiringCards (cron) |
| `famcare-backend/src/services/ocrService.js` | OCR for card photos |
| `famcare-backend/src/services/cloudinaryService.js` | Photo upload |
| `famcare-backend/src/tests/insurance.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | InsuranceCard model |

## API Surface Being Tested

```
POST   /api/v1/insurance
GET    /api/v1/insurance?memberId=
GET    /api/v1/insurance/:id
PATCH  /api/v1/insurance/:id
DELETE /api/v1/insurance/:id
```

## Schema Fields

`familyMemberId`, `companyName`, `policyNumber`, `groupNumber`, `expirationDate`, `policyHolderName`, `coverageType` (JSON), `frontPhotoUrl`, `backPhotoUrl`, `extractedText`, `status` (ACTIVE/EXPIRING/EXPIRED), `isDeleted`

## Tasks

1. Run the insurance tests:
   ```bash
   cd famcare-backend && npx jest insurance --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - POST with photos → Cloudinary URLs stored in `frontPhotoUrl`/`backPhotoUrl`, OCR runs, all fields returned
   - POST manual entry (no photos) → card created without OCR, no error
   - VIEWER role → `policyNumber` masked to last 4 digits (e.g. `****1234`)
   - CAREGIVER or OWNER role → full `policyNumber` returned unmasked
   - `status` computed correctly: future expiration=ACTIVE, <30d to expiry=EXPIRING, past expiry=EXPIRED
   - Expiration cron: fires once per threshold (60d, 30d, 7d), not re-sent on subsequent runs
   - OCR failure → `ocrSuccess: false` in response, no error thrown
   - Thai text in extracted OCR → stored correctly (UTF-8 Thai characters intact)
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest insurance --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- POST with photos → Cloudinary URLs stored, OCR runs, fields returned
- POST manual entry → card created without OCR
- VIEWER role → policyNumber masked to last 4 digits
- CAREGIVER/OWNER → full policyNumber returned
- Status computed correctly: future=ACTIVE, <30d=EXPIRING, past=EXPIRED
- Expiration cron fires once per threshold, not re-sent
- OCR failure → ocrSuccess: false, no error
- Thai text → stored correctly
