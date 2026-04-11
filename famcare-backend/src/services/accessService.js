import { prisma } from '../lib/prisma.js'

/**
 * Returns 'OWNER' | 'CAREGIVER' | 'VIEWER' | null
 */
export async function getAccessRoleForMember(actorUserId, familyMemberId) {
  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: { ownerId: true },
  })
  if (!member) return null
  if (member.ownerId === actorUserId) return 'OWNER'

  const access = await prisma.familyAccess.findUnique({
    where: {
      grantedToUserId_familyMemberId: {
        grantedToUserId: actorUserId,
        familyMemberId,
      },
    },
    select: { role: true },
  })
  return access?.role ?? null
}

export async function assertCanReadMember(actorUserId, familyMemberId) {
  const role = await getAccessRoleForMember(actorUserId, familyMemberId)
  if (!role) {
    throw Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
  }
  return role
}

export async function assertCanWriteMember(actorUserId, familyMemberId) {
  const role = await getAccessRoleForMember(actorUserId, familyMemberId)
  if (role !== 'OWNER' && role !== 'CAREGIVER') {
    throw Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
  }
  return role
}

export async function assertOwnerForMember(actorUserId, familyMemberId) {
  const role = await getAccessRoleForMember(actorUserId, familyMemberId)
  if (role !== 'OWNER') {
    throw Object.assign(new Error('Only the owner can manage access'), { status: 403, code: 'FORBIDDEN' })
  }
}
