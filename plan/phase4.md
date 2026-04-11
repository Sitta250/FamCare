# Phase 4 — Access control + FamilyMember CRUD (owner)

## Goal

Implement **`accessService`**: for a given actor user id and `familyMemberId`, resolve role: **OWNER**, **CAREGIVER**, **VIEWER**, or none. Enforce:

- **Read:** owner or any granted access.
- **Write:** owner or **CAREGIVER** only (not VIEWER).

Owner-only CRUD for **creating** members they own; list returns owned members (invited access listing can wait until Phase 5 or include members visible via `FamilyAccess`—pick one and document).

## Prerequisites

- [Phase 3](phase3.md) complete
- Prisma models: `User`, `FamilyMember`, `FamilyAccess` (for future checks)

## Step-by-step

1. **`services/accessService.js`**
   - `getAccessRoleForMember(actorUserId, familyMemberId)` → `OWNER` | `CAREGIVER` | `VIEWER` | `null`.
   - `assertCanReadMember`, `assertCanWriteMember` (throw 403 with code `FORBIDDEN`).

2. **`services/familyMemberService.js`**
   - `listFamilyMembers(actorUserId)` — at minimum: all where `ownerId = actorUserId`.
   - `createFamilyMember(actorUserId, body)` — set `ownerId` and `addedById` to actor.
   - `getFamilyMember`, `updateFamilyMember`, `deleteFamilyMember` — call assert; **delete only if actor is owner** (not just caregiver).

3. **`routes/familyMembers.js`**
   - `GET /api/v1/family-members` (auth)
   - `POST /api/v1/family-members`
   - `GET/PATCH/DELETE /api/v1/family-members/:id`
   - Thin handlers: parse body → service → `{ data }`.

4. **Response formatting**
   - Dates as Bangkok strings per [context/backend.md](../context/backend.md).

5. **Bruno**
   - Add `bruno/family-members/` requests for happy path + 403 (wrong user).

## Definition of done

- Owner can CRUD their members.
- Another LINE user without access cannot read arbitrary ids (403/404—choose consistent policy).

## Verify

Create member via POST; GET list; PATCH; DELETE. Second user header cannot access first user’s member id.

## Next

[phase5.md](phase5.md)
