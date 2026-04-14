# Phase 13 — Documents + Cloudinary + OCR

## Goal

- Accept **`cloudinaryUrl`** (and `type` `DocumentType`) from client after upload (or server-side upload via Cloudinary SDK using `CLOUDINARY_URL`).
- Persist **`Document`** row with `ocrText` optional.
- **OCR**: choose one provider (Google Vision, AWS Textract, OpenAI vision, or `OCR_DISABLED=true` skip). Store extracted text in `ocrText`.
- **Search**: `GET /api/v1/documents?q=keyword&familyMemberId=...` using `ILIKE` on `ocrText` and optional date filters.

## Prerequisites

- [Phase 2](phase2.md) `Document` model
- Cloudinary account or signed upload from client

## Step-by-step

1. Add `cloudinary` npm package if server uploads; validate HTTPS URL if client uploads.

2. **`services/documentService.js`**
   - Create document; `assertCanWrite`.
   - After create, if OCR enabled, fetch image from URL (or buffer) and call OCR adapter `extractText(buffer|url)`.

3. **`services/ocrService.js`**
   - Single function; env-guarded no-op returning `""` when disabled.

4. **Routes**
   - `GET/POST /api/v1/documents`, `GET/DELETE /api/v1/documents/:id`

5. **`.env.example`**
   - Add `OCR_DISABLED=true` and any API keys needed (never commit secrets).

6. **Notify** caregiver create → owner (Phase 9).

## Definition of done

- Create document with public sample image URL; DB shows `ocrText` when OCR on.

## Verify

Search endpoint returns row when `q` matches `ocrText` substring.

## Next

[phase14.md](phase14.md)
