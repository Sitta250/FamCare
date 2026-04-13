import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { syncRemindersForAppointment, deleteUnsentReminders } from './reminderService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { toBangkokISO } from '../utils/datetime.js'

function formatAppointment(a) {
  return {
    ...a,
    appointmentAt: toBangkokISO(a.appointmentAt),
    createdAt: toBangkokISO(a.createdAt),
  }
}

/**
 * Validates that accompaniedByUserId is either the owner or has FamilyAccess for the member.
 * Throws 422 if not.
 */
async function assertAccompaniedByUserHasAccess(familyMemberId, accompaniedByUserId) {
  if (!accompaniedByUserId) return
  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: { ownerId: true },
  })
  if (!member) return
  if (member.ownerId === accompaniedByUserId) return
  const access = await prisma.familyAccess.findUnique({
    where: {
      grantedToUserId_familyMemberId: {
        grantedToUserId: accompaniedByUserId,
        familyMemberId,
      },
    },
  })
  if (!access) {
    throw Object.assign(
      new Error('accompaniedByUserId must have access to this family member'),
      { status: 422, code: 'INVALID_ACCOMPANIED_USER' }
    )
  }
}

function groupByCalendarDate(appointments) {
  const groups = {}
  for (const appt of appointments) {
    const date = appt.appointmentAt?.slice(0, 10) ?? 'unknown'
    if (!groups[date]) groups[date] = []
    groups[date].push(appt)
  }
  return groups
}

export async function listAppointments(actorUserId, { familyMemberId, status, from, to, accompaniedByUserId, view } = {}) {
  await assertCanReadMember(actorUserId, familyMemberId)

  const where = { familyMemberId }

  if (view === 'upcoming') {
    where.appointmentAt = { gte: new Date() }
    where.status = { not: 'CANCELLED' }
  } else {
    if (status) where.status = status
    if (from || to) {
      where.appointmentAt = {}
      if (from) where.appointmentAt.gte = new Date(from)
      if (to)   where.appointmentAt.lte = new Date(to)
    }
  }

  if (accompaniedByUserId) where.accompaniedByUserId = accompaniedByUserId

  const rows = await prisma.appointment.findMany({ where, orderBy: { appointmentAt: 'asc' } })
  const formatted = rows.map(formatAppointment)

  if (view === 'calendar') {
    return groupByCalendarDate(formatted)
  }

  return formatted
}

export async function createAppointment(actorUserId, body) {
  const {
    familyMemberId, title, appointmentAt, doctor, hospital,
    reason, preNotes, accompaniedByUserId, whoBringsNote,
    reminderOffsets,
  } = body

  await assertCanWriteMember(actorUserId, familyMemberId)
  await assertAccompaniedByUserHasAccess(familyMemberId, accompaniedByUserId)

  const reminderOffsetsJson = reminderOffsets ? JSON.stringify(reminderOffsets) : null

  const appt = await prisma.appointment.create({
    data: {
      familyMemberId,
      addedByUserId: actorUserId,
      title,
      appointmentAt: new Date(appointmentAt),
      doctor: doctor ?? null,
      hospital: hospital ?? null,
      reason: reason ?? null,
      preNotes: preNotes ?? null,
      accompaniedByUserId: accompaniedByUserId ?? null,
      whoBringsNote: whoBringsNote ?? null,
      reminderOffsetsJson,
    },
  })

  await syncRemindersForAppointment(appt.id, appt.appointmentAt, reminderOffsets ?? null)

  // Notify owner if a caregiver added this (fire-and-forget)
  notifyOwnerIfCaregiver(
    familyMemberId,
    actorUserId,
    `ผู้ดูแลได้เพิ่มนัดหมายสำหรับ ${appt.id}: "${title}"`
  ).catch(err => console.error('[notify] appointment create:', err.message))

  return formatAppointment(appt)
}

export async function getAppointment(actorUserId, appointmentId) {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
  if (!appt) throw Object.assign(new Error('Appointment not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, appt.familyMemberId)
  return formatAppointment(appt)
}

export async function updateAppointment(actorUserId, appointmentId, body) {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
  if (!appt) throw Object.assign(new Error('Appointment not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, appt.familyMemberId)

  const {
    title, appointmentAt, doctor, hospital, reason,
    preNotes, postNotes, status, accompaniedByUserId, whoBringsNote,
    reminderOffsets,
  } = body

  if (accompaniedByUserId !== undefined) {
    await assertAccompaniedByUserHasAccess(appt.familyMemberId, accompaniedByUserId)
  }

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      ...(title !== undefined && { title }),
      ...(appointmentAt !== undefined && { appointmentAt: new Date(appointmentAt) }),
      ...(doctor !== undefined && { doctor }),
      ...(hospital !== undefined && { hospital }),
      ...(reason !== undefined && { reason }),
      ...(preNotes !== undefined && { preNotes }),
      ...(postNotes !== undefined && { postNotes }),
      ...(status !== undefined && { status }),
      ...(accompaniedByUserId !== undefined && { accompaniedByUserId }),
      ...(whoBringsNote !== undefined && { whoBringsNote }),
      ...(reminderOffsets !== undefined && { reminderOffsetsJson: JSON.stringify(reminderOffsets) }),
    },
  })

  // Re-sync reminders if appointmentAt or offsets changed; delete unsent if cancelled/completed
  const effectiveOffsets = reminderOffsets ?? (updated.reminderOffsetsJson ? JSON.parse(updated.reminderOffsetsJson) : null)
  if (appointmentAt !== undefined || reminderOffsets !== undefined) {
    await syncRemindersForAppointment(updated.id, updated.appointmentAt, effectiveOffsets)
  } else if (status === 'CANCELLED' || status === 'COMPLETED') {
    await deleteUnsentReminders(updated.id)
  }

  // Notify owner if a caregiver updated this (fire-and-forget)
  notifyOwnerIfCaregiver(
    updated.familyMemberId,
    actorUserId,
    `ผู้ดูแลได้อัปเดตนัดหมาย: "${updated.title}"`
  ).catch(err => console.error('[notify] appointment update:', err.message))

  return formatAppointment(updated)
}

export async function deleteAppointment(actorUserId, appointmentId) {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
  if (!appt) throw Object.assign(new Error('Appointment not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, appt.familyMemberId)
  await prisma.appointment.delete({ where: { id: appointmentId } })
}
