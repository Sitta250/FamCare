import { prisma } from '../lib/prisma.js'
import { assertOwnerForMember } from './accessService.js'
import { findOrCreateByLineUserId } from './userService.js'

export async function grantAccess(ownerUserId, familyMemberId, { grantedToLineUserId, role }) {
  await assertOwnerForMember(ownerUserId, familyMemberId)

  const invitee = await findOrCreateByLineUserId(grantedToLineUserId)

  return prisma.familyAccess.upsert({
    where: {
      grantedToUserId_familyMemberId: {
        grantedToUserId: invitee.id,
        familyMemberId,
      },
    },
    update: { role },
    create: {
      grantedByUserId: ownerUserId,
      grantedToUserId: invitee.id,
      familyMemberId,
      role,
    },
    include: { grantedTo: { select: { id: true, lineUserId: true, displayName: true } } },
  })
}

export async function listAccessForMember(ownerUserId, familyMemberId) {
  await assertOwnerForMember(ownerUserId, familyMemberId)

  return prisma.familyAccess.findMany({
    where: { familyMemberId },
    include: { grantedTo: { select: { id: true, lineUserId: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function revokeAccess(ownerUserId, familyMemberId, grantedToUserId) {
  await assertOwnerForMember(ownerUserId, familyMemberId)

  const deleted = await prisma.familyAccess.deleteMany({
    where: { familyMemberId, grantedToUserId },
  })

  if (deleted.count === 0) {
    throw Object.assign(new Error('Access grant not found'), { status: 404, code: 'NOT_FOUND' })
  }
}
