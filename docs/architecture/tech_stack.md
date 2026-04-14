# FamCare — Tech Stack

## Backend
- **Runtime:** Node.js
- **Framework:** Express
- **Language:** JavaScript (ESM)
- **ORM:** Prisma — use this for all DB queries, avoid raw SQL unless necessary
- **LINE integration:** `@line/bot-sdk` — all webhook handling goes through this

## Database
- **DB:** PostgreSQL
- **Hosting:** Railway (same project as backend)
- **Schema management:** Prisma migrations (`prisma migrate dev`)

## File Storage
- **Provider:** Cloudinary
- Use for: prescription photos, lab results, medical documents
- Store only the Cloudinary URL in the database, never the file itself

## iOS App
- **Language:** Swift
- **UI framework:** SwiftUI
- **Auth:** LINE Login (OAuth) — returns `lineUserId`, use this as the user identifier everywhere
- **Networking:** `URLSession` or `Alamofire` for API calls

## Hosting & DevOps
- **Platform:** Railway
- **Services in one Railway project:** Node.js server + PostgreSQL
- **Deploy:** push to main branch → auto-deploy

## Auth Strategy
- No custom auth system. LINE Login is the only auth method.
- `lineUserId` from LINE is the primary user identifier across all services (LINE bot, iOS, backend)
- Backend receives `lineUserId` on every request, validates it, scopes all data to it

## Environment Variables
Always use `.env` for secrets. Never hardcode:
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `DATABASE_URL` (auto-provided by Railway)
- `CLOUDINARY_URL`

## Key Conventions
- All business logic lives in `/services` — never in route handlers or webhook handlers
- Route handlers and LINE webhook handlers are thin: parse input → call service → return result
- All dates stored as UTC in DB, converted to Asia/Bangkok timezone at the API response layer
- Thai language strings are UTF-8, Prisma/PostgreSQL handle this natively
