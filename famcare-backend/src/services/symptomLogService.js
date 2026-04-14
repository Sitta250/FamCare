import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { uploadBuffer } from './cloudinaryService.js'
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

function parseDateField(value, fieldName) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`${fieldName} must be a valid ISO date`), { status: 400, code: 'BAD_REQUEST' })
  }
  return parsed
}

async function getWritableLog(actorUserId, logId) {
  const log = await prisma.symptomLog.findUnique({ where: { id: logId } })
  if (!log) throw Object.assign(new Error('Symptom log not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, log.familyMemberId)
  return log
}

export async function listSymptomLogs(actorUserId, { familyMemberId, limit, cursor, from, to }) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw Object.assign(new Error('Query parameter familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  }
  await assertCanReadMember(actorUserId, familyMemberId)

  const take = limit ? Math.min(Number(limit), 100) : 50
  const where = { familyMemberId }
  const fromValue = typeof from === 'string' ? from.trim() : from
  const toValue = typeof to === 'string' ? to.trim() : to

  if (fromValue || toValue) {
    where.loggedAt = {}
    if (fromValue) where.loggedAt.gte = parseDateField(fromValue, 'from')
    if (toValue) where.loggedAt.lte = parseDateField(toValue, 'to')
    if (where.loggedAt.gte && where.loggedAt.lte && where.loggedAt.gte > where.loggedAt.lte) {
      throw Object.assign(new Error('from must be less than or equal to to'), { status: 400, code: 'BAD_REQUEST' })
    }
  }

  const queryOpts = {
    where,
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
  const { familyMemberId, description, severity, note, photoUrl, voiceNoteUrl, loggedAt } = body

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
      photoUrl: photoUrl ?? null,
      voiceNoteUrl: voiceNoteUrl ?? null,
      loggedAt: loggedAt ? parseDateField(loggedAt, 'loggedAt') : new Date(),
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
  const log = await getWritableLog(actorUserId, logId)

  const { description, severity, note, photoUrl, voiceNoteUrl, loggedAt } = body
  const data = {}
  if (description !== undefined) data.description = description
  if (severity !== undefined) data.severity = validateSeverity(severity)
  if (note !== undefined) data.note = note
  if (photoUrl !== undefined) data.photoUrl = photoUrl
  if (voiceNoteUrl !== undefined) data.voiceNoteUrl = voiceNoteUrl
  if (loggedAt !== undefined) data.loggedAt = parseDateField(loggedAt, 'loggedAt')

  const updated = await prisma.symptomLog.update({ where: { id: logId }, data })
  return formatLog(updated)
}

export async function deleteSymptomLog(actorUserId, logId) {
  const log = await getWritableLog(actorUserId, logId)
  await prisma.symptomLog.delete({ where: { id: logId } })
}

export async function attachPhotoToSymptomLog(actorUserId, logId, file) {
  const log = await getWritableLog(actorUserId, logId)
  if (!file?.buffer) throw Object.assign(new Error('file is required'), { status: 400, code: 'BAD_REQUEST' })

  const upload = await uploadBuffer(file.buffer, {
    folder: `famcare/symptom-logs/${log.familyMemberId}/photos`,
    resourceType: 'image',
    originalname: file.originalname,
  })

  const updated = await prisma.symptomLog.update({
    where: { id: logId },
    data: { photoUrl: upload.secure_url },
  })

  return {
    id: updated.id,
    photoUrl: updated.photoUrl,
  }
}

export async function attachVoiceNoteToSymptomLog(actorUserId, logId, file) {
  const log = await getWritableLog(actorUserId, logId)
  if (!file?.buffer) throw Object.assign(new Error('file is required'), { status: 400, code: 'BAD_REQUEST' })

  const upload = await uploadBuffer(file.buffer, {
    folder: `famcare/symptom-logs/${log.familyMemberId}/voice-notes`,
    resourceType: 'raw',
    originalname: file.originalname,
  })

  const updated = await prisma.symptomLog.update({
    where: { id: logId },
    data: { voiceNoteUrl: upload.secure_url },
  })

  return {
    id: updated.id,
    voiceNoteUrl: updated.voiceNoteUrl,
  }
}
