import { prisma } from '../lib/prisma.js'
import { assertOwnerForMember } from './accessService.js'
import { findOrCreateByLineUserId } from './userService.js'

export function parseNotificationPrefs(raw) {
  try {
    const prefs = raw ? JSON.parse(raw) : {}
    return {
      appointmentReminders: prefs.appointmentReminders ?? true,
      medicationReminders: prefs.medicationReminders ?? true,
      missedDoseAlerts: prefs.missedDoseAlerts ?? true,
    }
  } catch {
    return {
      appointmentReminders: true,
      medicationReminders: true,
      missedDoseAlerts: true,
    }
  }
}

function serializeNotificationPrefs(notificationPrefs) {
  return notificationPrefs == null ? null : JSON.stringify(notificationPrefs)
}

function mapAccessRecord(record) {
  return {
    ...record,
    notificationPrefs: parseNotificationPrefs(record.notificationPrefs),
  }
}

export async function grantAccess(ownerUserId, familyMemberId, { grantedToLineUserId, role, notificationPrefs }) {
  await assertOwnerForMember(ownerUserId, familyMemberId)

  const invitee = await findOrCreateByLineUserId(grantedToLineUserId)
  const updateData = { role }

  if (notificationPrefs !== undefined) {
    updateData.notificationPrefs = serializeNotificationPrefs(notificationPrefs)
  }

  const access = await prisma.familyAccess.upsert({
    where: {
      grantedToUserId_familyMemberId: {
        grantedToUserId: invitee.id,
        familyMemberId,
      },
    },
    update: updateData,
    create: {
      grantedByUserId: ownerUserId,
      grantedToUserId: invitee.id,
      familyMemberId,
      role,
      notificationPrefs: serializeNotificationPrefs(notificationPrefs),
    },
    include: { grantedTo: { select: { id: true, lineUserId: true, displayName: true } } },
  })

  return mapAccessRecord(access)
}

export async function listAccessForMember(ownerUserId, familyMemberId) {
  await assertOwnerForMember(ownerUserId, familyMemberId)

  const accessList = await prisma.familyAccess.findMany({
    where: { familyMemberId },
    include: { grantedTo: { select: { id: true, lineUserId: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return accessList.map(mapAccessRecord)
}

export async function updateNotificationPrefs(ownerUserId, familyMemberId, grantedToUserId, notificationPrefs) {
  await assertOwnerForMember(ownerUserId, familyMemberId)

  const updated = await prisma.familyAccess.updateMany({
    where: { familyMemberId, grantedToUserId },
    data: { notificationPrefs: serializeNotificationPrefs(notificationPrefs) },
  })

  if (updated.count === 0) {
    throw Object.assign(new Error('Access grant not found'), { status: 404, code: 'NOT_FOUND' })
  }

  const access = await prisma.familyAccess.findFirst({
    where: { familyMemberId, grantedToUserId },
    include: { grantedTo: { select: { id: true, lineUserId: true, displayName: true } } },
  })

  return mapAccessRecord(access)
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
