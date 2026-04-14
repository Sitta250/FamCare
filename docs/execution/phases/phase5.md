# Phase 5 — FamilyAccess (invite, roles, revoke)

## Goal

Owner can **grant** CAREGIVER or VIEWER on a specific `FamilyMember`; **list** grants; **revoke**. If invitee has no `User` row yet, **create** stub `User` with `lineUserId` provided by client (from LINE Login later).

## Prerequisites

- [Phase 4](phase4.md) complete

## Step-by-step

1. **`services/familyAccessService.js`**
   - `grantAccess(ownerUserId, familyMemberId, { grantedToLineUserId, role })` — `assertOwnerForMember` (only owner manages access).
   - Upsert `FamilyAccess` unique on `(grantedToUserId, familyMemberId)`.
   - `revokeAccess`, `listAccessForMember`.

2. **`assertOwnerForMember`** — either in `accessService` or `familyMemberService`: owner id must match `FamilyMember.ownerId`.

3. **Routes** (example)
   - `GET /api/v1/family-members/:id/access` — list (owner only)
   - `POST /api/v1/family-members/:id/access` — body: `{ grantedToLineUserId, role }`
   - `DELETE /api/v1/family-members/:id/access/:grantedToUserId` — or by line user id string—stay REST-consistent.

4. **Update `familyMemberService` list/get**
   - Caregiver/viewer should **see** members they were granted (join `FamilyAccess`).

5. **Tests via Bruno**
   - User A owns member X; grant User B CAREGIVER on X; User B can GET/PATCH X; User B cannot see member Y.

## Definition of done

- Unique constraint enforced (no duplicate grant).
- Non-owner cannot grant.

## Verify

Three LINE user ids in headers: owner, caregiver, stranger. Confirm access matrix from [docs/architecture/schema.md](../../architecture/schema.md).

## Next

[phase6.md](phase6.md)
