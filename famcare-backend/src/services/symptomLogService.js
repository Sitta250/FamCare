import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { toBangkokISO } from '../utils/datetime.js'

function formatLog(l) {
  return {
    ...l,
    loggedAt: toBangkokISO(l.loggedAt),
    createdAt: toBangkokISO(l.createdAt),
  }
}

function validateSeverity(severity) {
  const n = Number(severity)
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw Object.assign(new Error('severity must be an integer between 1 and 10'), { status: 400, code: 'BAD_REQUEST' })
  }
  return n
}

export async function listSymptomLogs(actorUserId, { familyMemberId, limit, cursor }) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw Object.assign(new Error('Query parameter familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  }
  await assertCanReadMember(actorUserId, familyMemberId)

  const take = limit ? Math.min(Number(limit), 100) : 50
  const queryOpts = {
    where: { familyMemberId },
    orderBy: { loggedAt: 'desc' }, // newest first
    take,
  }
  if (cursor) {
    const c = String(cursor).trim()
    // Prisma cuid-style ids (avoids silent empty results on garbage input)
    if (!/^c[a-z0-9]{20,32}$/i.test(c)) {
      throw Object.assign(new Error('Invalid cursor'), { status: 400, code: 'BAD_REQUEST' })
    }
    queryOpts.cursor = { id: c }
    queryOpts.skip = 1
  }

  const rows = await prisma.symptomLog.findMany(queryOpts)
  return rows.map(formatLog)
}

export async function createSymptomLog(actorUserId, body) {
  const { familyMemberId, description, severity, note, attachmentUrl, loggedAt } = body

  if (!familyMemberId) throw Object.assign(new Error('familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!description) throw Object.assign(new Error('description is required'), { status: 400, code: 'BAD_REQUEST' })
  if (severity === undefined || severity === null) throw Object.assign(new Error('severity is required'), { status: 400, code: 'BAD_REQUEST' })
  const validatedSeverity = validateSeverity(severity)

  await assertCanWriteMember(actorUserId, familyMemberId)

  const log = await prisma.symptomLog.create({
    data: {
      familyMemberId,
      addedByUserId: actorUserId,
      description,
      severity: validatedSeverity,
      note: note ?? null,
      attachmentUrl: attachmentUrl ?? null,
      loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
    },
  })

  notifyOwnerIfCaregiver(
    familyMemberId,
    actorUserId,
    `ผู้ดูแลบันทึกอาการ: ${description} (ระดับ ${validatedSeverity}/10)`
  ).catch(err => console.error('[notify] symptom log create:', err.message))

  return formatLog(log)
}

export async function getSymptomLog(actorUserId, logId) {
  const log = await prisma.symptomLog.findUnique({ where: { id: logId } })
  if (!log) throw Object.assign(new Error('Symptom log not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, log.familyMemberId)
  return formatLog(log)
}

export async function updateSymptomLog(actorUserId, logId, body) {
  const log = await prisma.symptomLog.findUnique({ where: { id: logId } })
  if (!log) throw Object.assign(new Error('Symptom log not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, log.familyMemberId)

  const { description, severity, note, attachmentUrl, loggedAt } = body
  const data = {}
  if (description !== undefined) data.description = description
  if (severity !== undefined) data.severity = validateSeverity(severity)
  if (note !== undefined) data.note = note
  if (attachmentUrl !== undefined) data.attachmentUrl = attachmentUrl
  if (loggedAt !== undefined) data.loggedAt = new Date(loggedAt)

  const updated = await prisma.symptomLog.update({ where: { id: logId }, data })
  return formatLog(updated)
}

export async function deleteSymptomLog(actorUserId, logId) {
  const log = await prisma.symptomLog.findUnique({ where: { id: logId } })
  if (!log) throw Object.assign(new Error('Symptom log not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, log.familyMemberId)
  await prisma.symptomLog.delete({ where: { id: logId } })
}
