import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { toBangkokISO } from '../utils/datetime.js'

function formatMed(m) {
  return {
    ...m,
    startDate: toBangkokISO(m.startDate),
    endDate: toBangkokISO(m.endDate),
    createdAt: toBangkokISO(m.createdAt),
  }
}

function formatLog(l) {
  return {
    ...l,
    takenAt: toBangkokISO(l.takenAt),
    createdAt: toBangkokISO(l.createdAt),
  }
}

export async function listMedications(actorUserId, familyMemberId) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw Object.assign(new Error('Query parameter familyMemberId is required'), {
      status: 400,
      code: 'BAD_REQUEST',
    })
  }
  await assertCanReadMember(actorUserId, familyMemberId)
  const rows = await prisma.medication.findMany({
    where: { familyMemberId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(formatMed)
}

export async function createMedication(actorUserId, body) {
  const {
    familyMemberId, name, dosage, frequency, instructions,
    startDate, endDate, quantity, photoUrl, reminderTimesJson,
  } = body

  await assertCanWriteMember(actorUserId, familyMemberId)

  const med = await prisma.medication.create({
    data: {
      familyMemberId,
      addedByUserId: actorUserId,
      name,
      dosage: dosage ?? null,
      frequency: frequency ?? null,
      instructions: instructions ?? null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      quantity: quantity ?? null,
      photoUrl: photoUrl ?? null,
      reminderTimesJson: reminderTimesJson ?? null,
    },
  })

  notifyOwnerIfCaregiver(
    familyMemberId,
    actorUserId,
    `ผู้ดูแลได้เพิ่มยา "${name}" สำหรับสมาชิก`
  ).catch(err => console.error('[notify] medication create:', err.message))

  return formatMed(med)
}

export async function getMedication(actorUserId, medicationId) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, med.familyMemberId)
  return formatMed(med)
}

export async function updateMedication(actorUserId, medicationId, body) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, med.familyMemberId)

  const {
    name, dosage, frequency, instructions, startDate, endDate,
    quantity, photoUrl, reminderTimesJson, active,
  } = body

  const updated = await prisma.medication.update({
    where: { id: medicationId },
    data: {
      ...(name !== undefined && { name }),
      ...(dosage !== undefined && { dosage }),
      ...(frequency !== undefined && { frequency }),
      ...(instructions !== undefined && { instructions }),
      ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      ...(quantity !== undefined && { quantity }),
      ...(photoUrl !== undefined && { photoUrl }),
      ...(reminderTimesJson !== undefined && { reminderTimesJson }),
      ...(active !== undefined && { active }),
    },
  })
  return formatMed(updated)
}

export async function deleteMedication(actorUserId, medicationId) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, med.familyMemberId)
  await prisma.medication.delete({ where: { id: medicationId } })
}

// ---- MedicationLog ----

export async function listMedicationLogs(actorUserId, medicationId) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, med.familyMemberId)

  const logs = await prisma.medicationLog.findMany({
    where: { medicationId },
    orderBy: { takenAt: 'desc' },
  })
  return logs.map(formatLog)
}

// ---- MedicationSchedule ----

export async function updateMedicationSchedule(actorUserId, medicationId, times) {
  if (!Array.isArray(times)) {
    throw Object.assign(new Error('times must be an array of "HH:mm" strings'), { status: 400, code: 'BAD_REQUEST' })
  }
  for (const t of times) {
    if (!/^\d{2}:\d{2}$/.test(t)) {
      throw Object.assign(new Error(`Invalid time format: "${t}". Expected "HH:mm"`), { status: 400, code: 'BAD_REQUEST' })
    }
  }

  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, med.familyMemberId)

  // Replace all schedules for this medication in one transaction
  const schedules = await prisma.$transaction(async (tx) => {
    await tx.medicationSchedule.deleteMany({ where: { medicationId } })
    if (times.length === 0) return []
    return Promise.all(
      times.map(timeLocal => tx.medicationSchedule.create({ data: { medicationId, timeLocal } }))
    )
  })

  return schedules.map(s => ({ id: s.id, medicationId: s.medicationId, timeLocal: s.timeLocal }))
}

export async function getMedicationSchedule(actorUserId, medicationId) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, med.familyMemberId)

  const schedules = await prisma.medicationSchedule.findMany({
    where: { medicationId },
    orderBy: { timeLocal: 'asc' },
  })
  return schedules.map(s => ({ id: s.id, medicationId: s.medicationId, timeLocal: s.timeLocal }))
}

// ---- MedicationLog ----

export async function createMedicationLog(actorUserId, medicationId, body) {
  const { status, takenAt } = body

  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, med.familyMemberId)

  const log = await prisma.medicationLog.create({
    data: {
      medicationId,
      loggedByUserId: actorUserId,
      status,
      takenAt: new Date(takenAt),
    },
  })

  notifyOwnerIfCaregiver(
    med.familyMemberId,
    actorUserId,
    `ผู้ดูแลบันทึกการใช้ยา "${med.name}": ${status}`
  ).catch(err => console.error('[notify] medication log:', err.message))

  return formatLog(log)
}
