import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertOwnerForMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

const VALID_TYPES = new Set(['BLOOD_PRESSURE', 'BLOOD_SUGAR', 'WEIGHT', 'TEMPERATURE', 'CUSTOM'])

function formatThreshold(threshold) {
  return {
    ...threshold,
    createdAt: toBangkokISO(threshold.createdAt),
    updatedAt: toBangkokISO(threshold.updatedAt),
  }
}

function parseOptionalNumber(value, fieldName) {
  if (value === undefined) return undefined
  if (value === null) return null

  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw Object.assign(new Error(`${fieldName} must be a number`), { status: 400, code: 'BAD_REQUEST' })
  }
  return parsed
}

function assertValidType(type) {
  if (!VALID_TYPES.has(type)) {
    throw Object.assign(new Error('type is invalid'), { status: 400, code: 'BAD_REQUEST' })
  }
}

export async function listThresholds(actorUserId, memberId) {
  await assertCanReadMember(actorUserId, memberId)

  const rows = await prisma.metricThreshold.findMany({
    where: { familyMemberId: memberId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(formatThreshold)
}

export async function upsertThreshold(actorUserId, memberId, type, body) {
  await assertOwnerForMember(actorUserId, memberId)
  assertValidType(type)

  const { unit, minValue, maxValue, minValue2, maxValue2 } = body
  if (!unit || !String(unit).trim()) {
    throw Object.assign(new Error('unit is required'), { status: 400, code: 'BAD_REQUEST' })
  }

  const saved = await prisma.metricThreshold.upsert({
    where: {
      familyMemberId_type: {
        familyMemberId: memberId,
        type,
      },
    },
    update: {
      unit: String(unit).trim(),
      minValue: parseOptionalNumber(minValue, 'minValue'),
      maxValue: parseOptionalNumber(maxValue, 'maxValue'),
      minValue2: parseOptionalNumber(minValue2, 'minValue2'),
      maxValue2: parseOptionalNumber(maxValue2, 'maxValue2'),
    },
    create: {
      familyMemberId: memberId,
      type,
      unit: String(unit).trim(),
      minValue: parseOptionalNumber(minValue, 'minValue'),
      maxValue: parseOptionalNumber(maxValue, 'maxValue'),
      minValue2: parseOptionalNumber(minValue2, 'minValue2'),
      maxValue2: parseOptionalNumber(maxValue2, 'maxValue2'),
    },
  })

  return formatThreshold(saved)
}

export async function deleteThreshold(actorUserId, memberId, type) {
  await assertOwnerForMember(actorUserId, memberId)
  assertValidType(type)

  try {
    await prisma.metricThreshold.delete({
      where: {
        familyMemberId_type: {
          familyMemberId: memberId,
          type,
        },
      },
    })
  } catch (err) {
    if (err?.code === 'P2025') return
    throw err
  }
}
