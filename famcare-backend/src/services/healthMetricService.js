import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { toBangkokISO } from '../utils/datetime.js'

// MVP abnormal thresholds — document these as heuristics only
const ABNORMAL_THRESHOLDS = {
  BLOOD_PRESSURE: ({ value, unit }) => {
    // value stored as systolic; flag if > 180 or < 90
    if (unit === 'mmHg') return value > 180 || value < 90
    return false
  },
  BLOOD_SUGAR: ({ value, unit }) => {
    // mg/dL: fasting >126 or <70 is abnormal
    if (unit === 'mg/dL') return value > 126 || value < 70
    return false
  },
  WEIGHT: () => false, // no universal threshold
  TEMPERATURE: ({ value, unit }) => {
    if (unit === '°C') return value > 37.5 || value < 35
    if (unit === '°F') return value > 99.5 || value < 95
    return false
  },
  CUSTOM: () => false,
}

function isAbnormal(metric) {
  const fn = ABNORMAL_THRESHOLDS[metric.type]
  return fn ? fn(metric) : false
}

function formatMetric(m) {
  return {
    ...m,
    measuredAt: toBangkokISO(m.measuredAt),
    createdAt: toBangkokISO(m.createdAt),
    abnormal: isAbnormal(m),
  }
}

export async function listHealthMetrics(actorUserId, { familyMemberId, type, from, to }) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw Object.assign(new Error('Query parameter familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  }
  await assertCanReadMember(actorUserId, familyMemberId)

  const where = { familyMemberId }
  if (type) where.type = type
  if (from || to) {
    where.measuredAt = {}
    if (from) where.measuredAt.gte = new Date(from)
    if (to) where.measuredAt.lte = new Date(to)
  }

  const rows = await prisma.healthMetric.findMany({
    where,
    orderBy: { measuredAt: 'asc' },
  })
  return rows.map(formatMetric)
}

export async function createHealthMetric(actorUserId, body) {
  const { familyMemberId, type, value, unit, note, measuredAt } = body

  if (!familyMemberId) throw Object.assign(new Error('familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!type) throw Object.assign(new Error('type is required'), { status: 400, code: 'BAD_REQUEST' })
  if (value === undefined || value === null) throw Object.assign(new Error('value is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!unit) throw Object.assign(new Error('unit is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!measuredAt) throw Object.assign(new Error('measuredAt is required'), { status: 400, code: 'BAD_REQUEST' })

  await assertCanWriteMember(actorUserId, familyMemberId)

  const metric = await prisma.healthMetric.create({
    data: {
      familyMemberId,
      addedByUserId: actorUserId,
      type,
      value: Number(value),
      unit,
      note: note ?? null,
      measuredAt: new Date(measuredAt),
    },
  })

  notifyOwnerIfCaregiver(
    familyMemberId,
    actorUserId,
    `ผู้ดูแลบันทึกค่าสุขภาพ (${type}): ${value} ${unit}`
  ).catch(err => console.error('[notify] health metric create:', err.message))

  return formatMetric(metric)
}

export async function getHealthMetric(actorUserId, metricId) {
  const metric = await prisma.healthMetric.findUnique({ where: { id: metricId } })
  if (!metric) throw Object.assign(new Error('Health metric not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, metric.familyMemberId)
  return formatMetric(metric)
}

export async function updateHealthMetric(actorUserId, metricId, body) {
  const metric = await prisma.healthMetric.findUnique({ where: { id: metricId } })
  if (!metric) throw Object.assign(new Error('Health metric not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, metric.familyMemberId)

  const { value, unit, note, measuredAt } = body
  const updated = await prisma.healthMetric.update({
    where: { id: metricId },
    data: {
      ...(value !== undefined && { value: Number(value) }),
      ...(unit !== undefined && { unit }),
      ...(note !== undefined && { note }),
      ...(measuredAt !== undefined && { measuredAt: new Date(measuredAt) }),
    },
  })
  return formatMetric(updated)
}

export async function deleteHealthMetric(actorUserId, metricId) {
  const metric = await prisma.healthMetric.findUnique({ where: { id: metricId } })
  if (!metric) throw Object.assign(new Error('Health metric not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, metric.familyMemberId)
  await prisma.healthMetric.delete({ where: { id: metricId } })
}
