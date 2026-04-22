import { prisma } from '../lib/prisma.js'

const CHAT_MODES = new Set(['PRIVATE', 'GROUP'])

export async function findOrCreateByLineUserId(lineUserId, { displayName, photoUrl } = {}) {
  return prisma.user.upsert({
    where: { lineUserId },
    update: {
      ...(displayName && { displayName }),
      ...(photoUrl && { photoUrl }),
    },
    create: {
      lineUserId,
      displayName: displayName || 'LINE User',
      photoUrl: photoUrl || null,
    },
  })
}

export async function updateChatMode(userId, chatMode) {
  if (!CHAT_MODES.has(chatMode)) {
    throw Object.assign(new Error('chatMode must be one of PRIVATE, GROUP'), {
      status: 400,
      code: 'BAD_REQUEST',
    })
  }

  return prisma.user.update({
    where: { id: userId },
    data: { chatMode },
  })
}

/**
 * PDPA hard delete — removes all data associated with a user.
 *
 * Transaction order:
 * 1. For family members this user ADDED but does not OWN, reassign addedById → ownerId
 *    (preserves the owner's data integrity).
 * 2. Clear Appointment.accompaniedByUserId pointers to this user.
 * 3. Delete FamilyAccess rows where this user is grantor OR grantee.
 * 4. Delete all FamilyMember rows this user OWNS (cascades to all children via DB:
 *    appointments → reminders, medications → logs + schedules, healthMetrics,
 *    documents, symptomLogs, emergencyContacts, accessList).
 * 5. Delete the User row itself.
 *
 * After deletion, the same lineUserId arriving via auth middleware will recreate
 * a new empty User record (fresh start).
 */
export async function deleteUserAndData(userId) {
  await prisma.$transaction(async (tx) => {
    // Step 1 — reassign addedById for members this user added but doesn't own
    const addedNotOwned = await tx.familyMember.findMany({
      where: { addedById: userId, ownerId: { not: userId } },
      select: { id: true, ownerId: true },
    })
    for (const member of addedNotOwned) {
      await tx.familyMember.update({
        where: { id: member.id },
        data: { addedById: member.ownerId },
      })
    }

    // Step 2 — clear accompaniedByUserId pointers
    await tx.appointment.updateMany({
      where: { accompaniedByUserId: userId },
      data: { accompaniedByUserId: null },
    })

    // Step 3 — delete FamilyAccess where user is grantor or grantee
    await tx.familyAccess.deleteMany({
      where: {
        OR: [
          { grantedByUserId: userId },
          { grantedToUserId: userId },
        ],
      },
    })

    // Step 4 — delete owned FamilyMember rows (cascades all children)
    await tx.familyMember.deleteMany({ where: { ownerId: userId } })

    // Step 5 — delete the user
    await tx.user.delete({ where: { id: userId } })
  })
}
