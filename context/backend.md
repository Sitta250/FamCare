# FamCare — Backend Guide

## Project Structure
```
/famcare-backend
├── prisma/
│   └── schema.prisma        # DB schema — source of truth for all models
├── src/
│   ├── routes/              # Express route handlers — thin, no business logic
│   ├── services/            # All business logic lives here
│   ├── webhook/             # LINE webhook handler — thin, calls services
│   ├── middleware/          # Auth, error handling
│   └── index.js             # Entry point
├── .env                     # Never commit this
└── bruno/                   # Bruno API collections for testing
```

## Running Locally
```bash
npm install
npx prisma migrate dev       # Apply schema changes
npx prisma studio            # Visual DB browser at localhost:5555
npm run dev                  # Start server with nodemon

# For LINE webhook testing
ngrok http 3000              # Expose localhost — paste URL into LINE Developer Console
```

## Environment Variables
```
DATABASE_URL=                # Auto-provided by Railway in production
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
CLOUDINARY_URL=
PORT=3000
```

## Core Rules
- **Thin handlers.** Routes and webhook handler only parse input, call a service, return result. No DB calls, no logic.
- **Services own logic.** Every feature (appointments, medications, family, reminders) has its own service file in `/services`.
- **lineUserId is the user identity.** Comes from LINE Login (web/iOS) or LINE webhook. All data is scoped to it. No passwords, no custom auth.
- **UTC in, Bangkok out.** Store all timestamps as UTC in DB. Convert to `Asia/Bangkok` (UTC+7) in API responses.
- **Thai strings.** UTF-8 throughout — Prisma and PostgreSQL handle this natively, no special config needed.

## API Conventions
- REST endpoints: `GET /api/v1/family`, `POST /api/v1/appointments`, etc.
- Auth header: `x-line-userid: <lineUserId>` — middleware extracts and attaches to `req.userId`
- Error responses: `{ error: string, code: string }`
- Success responses: `{ data: any }`

## LINE Webhook
- Single POST endpoint: `/webhook`
- Verify signature using `LINE_CHANNEL_SECRET` — the SDK handles this
- Supported event types to handle: `message` (text), `postback`
- All message parsing → service calls happen in `/webhook/handler.js`

## Database
- ORM: Prisma — never write raw SQL unless Prisma can't handle it
- After any schema change: `npx prisma migrate dev --name <description>`
- After pulling from git: `npx prisma generate` to sync the client

## Key Data Relationships
See `SCHEMA.md` for the full Prisma schema and ERD. Summary:
- `User` owns `FamilyMember` records (one-to-many)
- `FamilyAccess` grants a second user Caregiver or Viewer access to a specific `FamilyMember` — not the whole account
- All child records (Appointment, Medication, HealthMetric, Document, SymptomLog) belong to a `FamilyMember` and track `addedByUserId` for caregiver attribution
- `Appointment` has child `Reminder` rows — one per scheduled notification (7 days, 2 days, 1 day, 2 hours)

## Reminders
- Cron jobs run inside the same Node.js process (use `node-cron`)
- On each tick: query upcoming appointments/medications → send LINE push message via SDK
- Reminder schedule for appointments: 7 days, 2 days, 1 day, 2 hours before
- Medication reminders: fire at scheduled time, wait for confirmation, alert caregiver if missed

## Testing Workflow
1. Write route + service
2. Test endpoint in **Bruno** (collections saved in `/bruno`)
3. Verify data in **Prisma Studio** (`npx prisma studio`)
4. For LINE bot: run `ngrok http 3000`, update webhook URL in LINE Developer Console, test by messaging the bot
