# Feature 5 — Health Documentation — Codex Task

## Status
VERIFY-AND-FIX

## Goal
The Health Documentation feature is implemented (multipart upload → Cloudinary → OCR → stored extractedText + search). Run the specific test assertions listed below and fix any failures in the implementation. All 6 assertions must pass.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/routes/documents.js` | REST route handlers |
| `famcare-backend/src/services/documentService.js` | upload to Cloudinary, run OCR, store extractedText, search |
| `famcare-backend/src/services/ocrService.js` | OCR logic (tesseract.js or Google Vision) |
| `famcare-backend/src/services/cloudinaryService.js` | Cloudinary upload wrapper |
| `famcare-backend/src/middleware/upload.js` | Multer file upload middleware |
| `famcare-backend/src/tests/documents.test.js` | Test file — run this |
| `famcare-backend/prisma/schema.prisma` | Document model |

## API Surface Being Tested

```
POST   /api/v1/documents   (multipart/form-data)
GET    /api/v1/documents?memberId=&keyword=&date=
DELETE /api/v1/documents/:id
```

## Tasks

1. Run the document tests:
   ```bash
   cd famcare-backend && npx jest document --verbose
   ```
2. For any failing test, fix the **implementation** (service or route), not the test.
3. Key behaviors to verify:
   - Upload image → Cloudinary URL stored, OCR text extracted and stored in `extractedText`
   - Search by keyword → matches documents where `extractedText` contains the keyword
   - Search by date → correctly filters by upload date
   - Search by memberId → scoped to that family member only
   - Thai OCR: Thai characters extracted correctly (check charset handling)
   - File >10MB → rejected with HTTP 413
4. After fixing, run `npm test` to confirm nothing else broke.

## Test Commands

```bash
cd famcare-backend && npx jest document --verbose
cd famcare-backend && npm test
```

## Pass Criteria

- Upload image → Cloudinary URL stored, OCR text extracted
- Search by keyword → matches extractedText
- Search by date → correct filtering
- Search by member → scoped correctly
- Thai OCR: Thai characters extracted correctly
- File >10MB → rejected with 413
