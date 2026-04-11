# Phase 9 — Owner notification when caregiver adds a record

## Goal

When a **caregiver** (not the owner) **creates** (and optionally **updates**) domain records tied to a `FamilyMember`, send a **LINE push** to the **owner** with a short Thai/English stub message.

Apply to: **Appointment** (create/update), and later **Medication**, **HealthMetric**, **Document**, **SymptomLog** when those phases exist.

## Prerequisites

- [Phase 5](phase5.md) access roles
- [Phase 8](phase8.md) `linePushService`

## Step-by-step

1. **`services/caregiverNotifyService.js`**
   - `notifyOwnerIfCaregiver(familyMemberId, addedByUserId, messageText)`:
     - Load member’s `ownerId`; if `addedByUserId === ownerId`, return.
     - Load owner’s `lineUserId`; call `sendLinePushToUser`.

2. **Call from services** (not routes) **after** successful create/update:
   - `appointmentService` first; extend as you add features.

3. **Message content**
   - Include member name + action summary (e.g. “Caregiver added an appointment for {name}”).

4. **Tests**
   - Bruno or script: User B caregiver creates appointment for member owned by A → owner A receives push (or console log if no token).

## Definition of done

- Owner does **not** get notified for their own actions.
- Strangers cannot trigger notify without access.

## Verify

Two test LINE user ids in DB; simulate caregiver POST with `x-line-userid` of caregiver.

## Next

[phase10.md](phase10.md)
