import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { syncRemindersForAppointment, deleteUnsentReminders } from './reminderService.js'
import { toBangkokISO } from '../utils/datetime.js'

function formatAppointment(a) {
  return {
    ...a,
    appointmentAt: toBangkokISO(a.appointmentAt),
    createdAt: toBangkokISO(a.createdAt),
  }
}

export async function listAppointments(actorUserId, { familyMemberId, status, from, to } = {}) {
  await assertCanReadMember(actorUserId, familyMemberId)

  const where = { familyMemberId }
  if (status) where.status = status
  if (from || to) {
    where.appointmentAt = {}
    if (from) where.appointmentAt.gte = new Date(from)
    if (to)   where.appointmentAt.lte = new Date(to)
  }

  const rows = await prisma.appointment.findMany({ where, orderBy: { appointmentAt: 'asc' } })
  return rows.map(formatAppointment)
}

export async function createAppointment(actorUserId, body) {
  const {
    familyMemberId, title, appointmentAt, doctor, hospital,
    reason, preNotes, accompaniedByUserId, whoBringsNote,
  } = body

  await assertCanWriteMember(actorUserId, familyMemberId)

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
    },
  })

  await syncRemindersForAppointment(appt.id, appt.appointmentAt)
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
  } = body

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
    },
  })

  // Re-sync reminders if appointmentAt changed; delete unsent if cancelled/completed
  if (appointmentAt !== undefined) {
    await syncRemindersForAppointment(updated.id, updated.appointmentAt)
  } else if (status === 'CANCELLED' || status === 'COMPLETED') {
    await deleteUnsentReminders(updated.id)
  }

  return formatAppointment(updated)
}

export async function deleteAppointment(actorUserId, appointmentId) {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
  if (!appt) throw Object.assign(new Error('Appointment not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, appt.familyMemberId)
  await prisma.appointment.delete({ where: { id: appointmentId } })
}
