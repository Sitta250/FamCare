import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember, getAccessRoleForMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

function formatMember(m) {
  return {
    ...m,
    dateOfBirth: toBangkokISO(m.dateOfBirth),
    createdAt: toBangkokISO(m.createdAt),
  }
}

export async function listFamilyMembers(actorUserId) {
  // owned members
  const owned = await prisma.familyMember.findMany({
    where: { ownerId: actorUserId },
    orderBy: { createdAt: 'asc' },
  })

  // members granted via FamilyAccess
  const granted = await prisma.familyAccess.findMany({
    where: { grantedToUserId: actorUserId },
    include: { familyMember: true },
    orderBy: { createdAt: 'asc' },
  })

  const grantedMembers = granted.map(a => a.familyMember)

  // deduplicate by id (owner who is also in access list)
  const seen = new Set(owned.map(m => m.id))
  const all = [...owned, ...grantedMembers.filter(m => !seen.has(m.id))]

  return all.map(formatMember)
}

export async function createFamilyMember(actorUserId, body) {
  const { name, relation, dateOfBirth, bloodType, allergies, conditions, photoUrl, preferredHospital, missedDoseAlertsEnabled } = body
  const member = await prisma.familyMember.create({
    data: {
      ownerId: actorUserId,
      addedById: actorUserId,
      name,
      relation,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      bloodType: bloodType ?? null,
      allergies: allergies ?? null,
      conditions: conditions ?? null,
      photoUrl: photoUrl ?? null,
      preferredHospital: preferredHospital ?? null,
      missedDoseAlertsEnabled: missedDoseAlertsEnabled ?? true,
    },
  })
  return formatMember(member)
}

export async function getFamilyMember(actorUserId, familyMemberId) {
  await assertCanReadMember(actorUserId, familyMemberId)
  const member = await prisma.familyMember.findUnique({ where: { id: familyMemberId } })
  return formatMember(member)
}

export async function updateFamilyMember(actorUserId, familyMemberId, body) {
  await assertCanWriteMember(actorUserId, familyMemberId)
  const { name, relation, dateOfBirth, bloodType, allergies, conditions, photoUrl, preferredHospital, missedDoseAlertsEnabled } = body
  const member = await prisma.familyMember.update({
    where: { id: familyMemberId },
    data: {
      ...(name !== undefined && { name }),
      ...(relation !== undefined && { relation }),
      ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
      ...(bloodType !== undefined && { bloodType }),
      ...(allergies !== undefined && { allergies }),
      ...(conditions !== undefined && { conditions }),
      ...(photoUrl !== undefined && { photoUrl }),
      ...(preferredHospital !== undefined && { preferredHospital }),
      ...(missedDoseAlertsEnabled !== undefined && { missedDoseAlertsEnabled }),
    },
  })
  return formatMember(member)
}

export async function deleteFamilyMember(actorUserId, familyMemberId) {
  const role = await getAccessRoleForMember(actorUserId, familyMemberId)
  if (role !== 'OWNER') {
    throw Object.assign(new Error('Only the owner can delete a family member'), { status: 403, code: 'FORBIDDEN' })
  }
  await prisma.familyMember.delete({ where: { id: familyMemberId } })
}
