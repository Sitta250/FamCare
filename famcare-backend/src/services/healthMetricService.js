import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { toBangkokISO } from '../utils/datetime.js'

const VALID_TYPES = new Set(['BLOOD_PRESSURE', 'BLOOD_SUGAR', 'WEIGHT', 'TEMPERATURE', 'CUSTOM'])

// Standard population defaults — not personalized medical advice.
// Override per member via MetricThreshold (Task 4).
const ABNORMAL_THRESHOLDS = {
  BLOOD_PRESSURE: ({ value, value2, unit }) => {
    if (unit !== 'mmHg') return false
    const systolicHigh = value > 140
    const systolicLow = value < 90
    const diastolicHigh = value2 != null && value2 > 90
    const diastolicLow = value2 != null && value2 < 60
    return systolicHigh || systolicLow || diastolicHigh || diastolicLow
  },
  BLOOD_SUGAR: ({ value, unit }) => {
    if (unit === 'mg/dL') return value > 126 || value < 70
    if (unit === 'mmol/L') return value > 7.0 || value < 3.9
    return false
  },
  WEIGHT: () => false,
  TEMPERATURE: ({ value, unit }) => {
    if (unit === '°C') return value > 37.5 || value < 35.0
    if (unit === '°F') return value > 99.5 || value < 95.0
    return false
  },
  CUSTOM: () => false,
}

function isAbnormal(metric, thresholdOverride = null) {
  if (thresholdOverride) {
    const { minValue, maxValue, minValue2, maxValue2 } = thresholdOverride
    const primaryFail =
      (maxValue != null && metric.value > maxValue) ||
      (minValue != null && metric.value < minValue)
    const secondaryFail = metric.value2 != null && (
      (maxValue2 != null && metric.value2 > maxValue2) ||
      (minValue2 != null && metric.value2 < minValue2)
    )
    return primaryFail || secondaryFail
  }

  const fn = ABNORMAL_THRESHOLDS[metric.type]
  return fn ? fn(metric) : false
}

function parseNumberField(value, fieldName) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw Object.assign(new Error(`${fieldName} must be a number`), { status: 400, code: 'BAD_REQUEST' })
  }
  return parsed
}

function parseDateField(value, fieldName) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`${fieldName} must be a valid ISO date`), { status: 400, code: 'BAD_REQUEST' })
  }
  return parsed
}

function formatMetric(m, threshold = null) {
  return {
    ...m,
    value2: m.value2 ?? null,
    label: m.label ?? null,
    measuredAt: toBangkokISO(m.measuredAt),
    createdAt: toBangkokISO(m.createdAt),
    isAbnormal: isAbnormal(m, threshold),
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
    if (from) where.measuredAt.gte = parseDateField(from, 'from')
    if (to) where.measuredAt.lte = parseDateField(to, 'to')
  }

  const rows = await prisma.healthMetric.findMany({
    where,
    orderBy: { measuredAt: 'asc' },
  })
  const thresholds = await prisma.metricThreshold.findMany({ where: { familyMemberId } })
  const thresholdMap = Object.fromEntries(thresholds.map(t => [t.type, t]))
  return rows.map(row => formatMetric(row, thresholdMap[row.type] ?? null))
}

export async function createHealthMetric(actorUserId, body) {
  const { familyMemberId, type, value, value2, unit, label, note, measuredAt } = body

  if (!familyMemberId) throw Object.assign(new Error('familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!type) throw Object.assign(new Error('type is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!VALID_TYPES.has(type)) throw Object.assign(new Error('type is invalid'), { status: 400, code: 'BAD_REQUEST' })
  if (type === 'CUSTOM' && (!label || !String(label).trim())) {
    throw Object.assign(new Error('label is required for CUSTOM type'), { status: 400, code: 'BAD_REQUEST' })
  }
  if (value === undefined || value === null) throw Object.assign(new Error('value is required'), { status: 400, code: 'BAD_REQUEST' })
  const numericValue = parseNumberField(value, 'value')
  const numericValue2 = value2 != null ? parseNumberField(value2, 'value2') : null
  if (!unit) throw Object.assign(new Error('unit is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!measuredAt) throw Object.assign(new Error('measuredAt is required'), { status: 400, code: 'BAD_REQUEST' })
  const measuredAtDate = parseDateField(measuredAt, 'measuredAt')

  await assertCanWriteMember(actorUserId, familyMemberId)

  const metric = await prisma.healthMetric.create({
    data: {
      familyMemberId,
      addedByUserId: actorUserId,
      type,
      value: numericValue,
      value2: numericValue2,
      unit,
      label: type === 'CUSTOM' ? String(label).trim() : null,
      note: note ?? null,
      measuredAt: measuredAtDate,
    },
  })

  const threshold = await prisma.metricThreshold.findUnique({
    where: { familyMemberId_type: { familyMemberId, type } },
  })

  notifyOwnerIfCaregiver(
    familyMemberId,
    actorUserId,
    `ผู้ดูแลบันทึกค่าสุขภาพ (${type}): ${value} ${unit}`
  ).catch(err => console.error('[notify] health metric create:', err.message))

  return formatMetric(metric, threshold)
}

export async function getHealthMetric(actorUserId, metricId) {
  const metric = await prisma.healthMetric.findUnique({ where: { id: metricId } })
  if (!metric) throw Object.assign(new Error('Health metric not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, metric.familyMemberId)
  const threshold = await prisma.metricThreshold.findUnique({
    where: { familyMemberId_type: { familyMemberId: metric.familyMemberId, type: metric.type } },
  })
  return formatMetric(metric, threshold)
}

export async function updateHealthMetric(actorUserId, metricId, body) {
  const metric = await prisma.healthMetric.findUnique({ where: { id: metricId } })
  if (!metric) throw Object.assign(new Error('Health metric not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, metric.familyMemberId)

  const { value, value2, unit, label, note, measuredAt } = body
  const updated = await prisma.healthMetric.update({
    where: { id: metricId },
    data: {
      ...(value !== undefined && { value: parseNumberField(value, 'value') }),
      ...(value2 !== undefined && { value2: value2 != null ? parseNumberField(value2, 'value2') : null }),
      ...(unit !== undefined && { unit }),
      ...(label !== undefined && { label: label == null ? null : String(label).trim() }),
      ...(note !== undefined && { note }),
      ...(measuredAt !== undefined && { measuredAt: parseDateField(measuredAt, 'measuredAt') }),
    },
  })
  const threshold = await prisma.metricThreshold.findUnique({
    where: { familyMemberId_type: { familyMemberId: updated.familyMemberId, type: updated.type } },
  })
  return formatMetric(updated, threshold)
}

export async function deleteHealthMetric(actorUserId, metricId) {
  const metric = await prisma.healthMetric.findUnique({ where: { id: metricId } })
  if (!metric) throw Object.assign(new Error('Health metric not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, metric.familyMemberId)
  await prisma.healthMetric.delete({ where: { id: metricId } })
}
