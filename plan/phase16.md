# Phase 16 — Coordination MVP + LINE routing stubs

## Goal

- **Appointment** fields: `accompaniedByUserId` (must reference a `User` that has access to the member or is owner—validate), `whoBringsNote` free text.
- **Calendar “who’s taking”**: `GET /api/v1/appointments` already lists appointments; add optional filter `accompaniedByUserId` or include in response for dashboard.
- **LINE `webhook/handler.js`**
  - **Postback** actions: e.g. `action=add_appointment` with stub data → call `appointmentService` (Thai NLP **not** required—use regex or fixed keywords).
  - **Text** messages: stub parser (`"นัด"` keyword) returning Flex or text reply.
  - **Audio/voice** messages: extract `message.id` content URL from LINE API if needed; store URL on **`SymptomLog.attachmentUrl`** via a minimal service call (may require GET content API with channel token—document; MVP: log URL if provided in event).

## Prerequisites

- [Phase 6](phase6.md) appointments
- [Phase 7](phase7.md) webhook

## Step-by-step

1. **Migration** (if not in Phase 2): ensure coordination fields exist.

2. **`appointmentService`** — validate `accompaniedByUserId` belongs to same family context (owner or caregiver user id).

3. **Extend handler** — postback `data` JSON; reply with confirmation.

4. **README** — document Rich Menu / postback payload format for testers.

## Definition of done

- Postback path creates or updates at least one appointment in dev DB.
- Voice URL path documented even if partially stubbed.

## Verify

Simulate postback with curl to `/webhook` (only if dev mode allows) or LINE console.

## Next

[phase17.md](phase17.md)
