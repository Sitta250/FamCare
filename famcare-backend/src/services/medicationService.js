import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { bangkokCalendarDate, toBangkokISO, utcInstantFromBangkokYmdHm } from '../utils/datetime.js'
import { sendLinePushToUser } from './linePushService.js'
import { getRecipients } from './medicationReminderDispatchService.js'

export const MEDICATION_LOG_STATUSES = new Set(['TAKEN', 'MISSED', 'SKIPPED'])

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, code: 'BAD_REQUEST' })
}

function isValidDateInput(value) {
  return Number.isFinite(new Date(value).getTime())
}

function validateNonNegativeInt(value, fieldName) {
  if (value === undefined || value === null) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw badRequest(`${fieldName} must be a non-negative integer`)
  }
}

function validateMedicationCreateInput(body) {
  const { familyMemberId, name, lowStockThreshold } = body

  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw badRequest('familyMemberId is required')
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw badRequest('name is required')
  }
  validateNonNegativeInt(lowStockThreshold, 'lowStockThreshold')
}

function validateMedicationLogInput(body) {
  const { status, takenAt } = body

  if (!MEDICATION_LOG_STATUSES.has(status)) {
    throw badRequest('status must be one of TAKEN, MISSED, SKIPPED')
  }
  if (!takenAt || typeof takenAt !== 'string' || !takenAt.trim()) {
    throw badRequest('takenAt is required')
  }
  if (!takenAt.includes('T') || !isValidDateInput(takenAt)) {
    throw badRequest('takenAt must be a valid ISO date string')
  }
}

function parseMedicationActiveFilter(active) {
  if (active === true || active === false) return active
  if (typeof active !== 'string') return undefined
  if (active === 'true') return true
  if (active === 'false') return false
  return undefined
}

function parseBangkokDateYmd(value, fieldName) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${fieldName} must be a YYYY-MM-DD date`)
  }
  return value
}

function parsePositiveLimit(limit) {
  if (limit === undefined || limit === null || limit === '') return 50
  const value = Number(limit)
  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest('limit must be a positive integer')
  }
  return Math.min(value, 100)
}

function currentLowStockAlertDates(now = new Date()) {
  return new Set([
    bangkokCalendarDate(now),
    now.toISOString().slice(0, 10),
  ])
}

function resolveBangkokDateWindow({ from, to } = {}, fallbackDays = 30) {
  const fromYmd = parseBangkokDateYmd(from, 'from')
  const toYmd = parseBangkokDateYmd(to, 'to')

  if (fromYmd || toYmd) {
    const resolvedFromYmd = fromYmd ?? toYmd
    const resolvedToYmd = toYmd ?? fromYmd
    return {
      from: utcInstantFromBangkokYmdHm(resolvedFromYmd, '00:00'),
      to: utcInstantFromBangkokYmdHm(resolvedToYmd, '23:59'),
    }
  }

  const now = new Date()
  const start = new Date(now.getTime() - fallbackDays * 24 * 60 * 60 * 1000)
  return {
    from: utcInstantFromBangkokYmdHm(bangkokCalendarDate(start), '00:00'),
    to: utcInstantFromBangkokYmdHm(bangkokCalendarDate(now), '23:59'),
  }
}

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

export async function listMedications(actorUserId, familyMemberId, { active } = {}) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw Object.assign(new Error('Query parameter familyMemberId is required'), {
      status: 400,
      code: 'BAD_REQUEST',
    })
  }
  await assertCanReadMember(actorUserId, familyMemberId)
  const activeFilter = parseMedicationActiveFilter(active)
  const where = { familyMemberId }
  if (activeFilter !== undefined) where.active = activeFilter

  const rows = await prisma.medication.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(formatMed)
}

export async function createMedication(actorUserId, body) {
  const {
    familyMemberId, name, dosage, frequency, instructions,
    startDate, endDate, quantity, lowStockThreshold, photoUrl, reminderTimesJson,
  } = body

  validateMedicationCreateInput(body)
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
      lowStockThreshold: lowStockThreshold ?? null,
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
    quantity, lowStockThreshold, photoUrl, reminderTimesJson, active,
  } = body

  validateNonNegativeInt(lowStockThreshold, 'lowStockThreshold')

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
      ...(lowStockThreshold !== undefined && { lowStockThreshold }),
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

export async function listMedicationLogs(actorUserId, medicationId, { from, to, limit, cursor } = {}) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, med.familyMemberId)

  const take = parsePositiveLimit(limit)
  const where = { medicationId }

  if (from || to) {
    const { from: windowStart, to: windowEnd } = resolveBangkokDateWindow({ from, to }, 30)
    where.takenAt = {}
    where.takenAt.gte = windowStart
    where.takenAt.lte = windowEnd
  }

  const queryOpts = {
    where,
    orderBy: { takenAt: 'desc' },
    take,
  }

  if (cursor) {
    const cursorId = String(cursor).trim()
    if (!cursorId) throw badRequest('Invalid cursor')
    const cursorRow = await prisma.medicationLog.findUnique({
      where: { id: cursorId },
      select: { id: true, medicationId: true },
    })
    if (!cursorRow || cursorRow.medicationId !== medicationId) {
      throw badRequest('Invalid cursor')
    }
    queryOpts.cursor = { id: cursorId }
    queryOpts.skip = 1
  }

  const logs = await prisma.medicationLog.findMany({
    ...queryOpts,
  })
  return logs.map(formatLog)
}

export async function getMedicationAdherence(actorUserId, medicationId, { from, to } = {}) {
  const med = await prisma.medication.findUnique({ where: { id: medicationId } })
  if (!med) throw Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, med.familyMemberId)

  const { from: windowStart, to: windowEnd } = resolveBangkokDateWindow({ from, to }, 30)
  const grouped = await prisma.medicationLog.groupBy({
    by: ['status'],
    where: {
      medicationId,
      takenAt: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    _count: {
      status: true,
    },
  })

  const counts = { TAKEN: 0, MISSED: 0, SKIPPED: 0 }
  for (const row of grouped) {
    counts[row.status] = row._count.status
  }

  const total = counts.TAKEN + counts.MISSED + counts.SKIPPED
  return {
    medicationId,
    from: toBangkokISO(windowStart),
    to: toBangkokISO(windowEnd),
    taken: counts.TAKEN,
    missed: counts.MISSED,
    skipped: counts.SKIPPED,
    total,
    adherencePct: total === 0 ? null : Number(((counts.TAKEN / total) * 100).toFixed(1)),
  }
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

export async function createMedicationLog(actorUserId, medicationId, body) {
  const { status, takenAt } = body

  validateMedicationLogInput(body)
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

export async function checkLowStockAlerts() {
  const now = new Date()
  const activeAlertDates = currentLowStockAlertDates(now)
  const todayStr = bangkokCalendarDate(now)
  const meds = await prisma.medication.findMany({
    where: {
      active: true,
      quantity: { not: null },
      lowStockThreshold: { not: null },
      OR: [
        { lastLowStockAlertDate: null },
        { lastLowStockAlertDate: { not: todayStr } },
      ],
    },
  })

  for (const med of meds) {
    if (
      !med.active ||
      med.quantity === null ||
      med.lowStockThreshold === null ||
      activeAlertDates.has(med.lastLowStockAlertDate) ||
      med.quantity > med.lowStockThreshold
    ) {
      continue
    }

    try {
      const { recipients } = await getRecipients(med.familyMemberId)
      const text = `⚠️ ยาใกล้หมด: ${med.name} เหลือ ${med.quantity} เม็ด กรุณาจัดซื้อเพิ่ม`

      for (const lineUserId of recipients) {
        await sendLinePushToUser(lineUserId, text)
      }

      await prisma.medication.update({
        where: { id: med.id },
        data: { lastLowStockAlertDate: todayStr },
      })

      console.log(`[med-low-stock] sent alert for ${med.id} (${med.name})`)
    } catch (err) {
      console.error(`[med-low-stock] alert failed for ${med.id}:`, err.message)
    }
  }
}
