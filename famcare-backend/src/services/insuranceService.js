import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { deleteByPublicId, uploadBuffer } from './cloudinaryService.js'
import { extractText } from './ocrService.js'
import { sendLinePushToUser } from './linePushService.js'
import { getRecipients } from './medicationReminderDispatchService.js'
import { bangkokCalendarDate, toBangkokISO, utcInstantFromBangkokYmdHm } from '../utils/datetime.js'

const INSURANCE_FIELDS = [
  'companyName',
  'policyNumber',
  'groupNumber',
  'expirationDate',
  'policyHolderName',
  'dependentRelationship',
  'customerServicePhone',
  'emergencyPhone',
  'coverageType',
  'coverageSummary',
  'allowViewerFullAccess',
]

const EMPTY_EXTRACTED_FIELDS = {
  companyName: null,
  policyNumber: null,
  groupNumber: null,
  policyHolderName: null,
  expirationDate: null,
  customerServicePhone: null,
  emergencyPhone: null,
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, code: 'BAD_REQUEST' })
}

function notFound() {
  return Object.assign(new Error('Insurance card not found'), { status: 404, code: 'NOT_FOUND' })
}

function trimOrNull(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseBoolean(value) {
  if (value === true || value === false) return value
  if (value === 'true') return true
  if (value === 'false') return false
  return Boolean(value)
}

function normalizeCoverageType(value) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'string') return trimOrNull(value)
  return JSON.stringify(value)
}

function formatCoverageType(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseDateInput(value, fieldName) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw badRequest(`${fieldName} must be a valid date`)
  }
  return date
}

function parseExtractedDateInput(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function getPhotoFile(body, fieldName) {
  const directFile = body[fieldName]
  if (directFile?.buffer) return directFile

  const files = body.files
  const fromFields = files?.[fieldName]
  if (Array.isArray(fromFields)) return fromFields[0] ?? null
  if (fromFields?.buffer) return fromFields
  return null
}

function getPhotoInputs(body) {
  return {
    frontPhoto: getPhotoFile(body, 'frontPhoto'),
    backPhoto: getPhotoFile(body, 'backPhoto'),
  }
}

function maskPolicyNumber(policyNumber) {
  if (!policyNumber) return null
  const value = String(policyNumber)
  if (value.length < 4) return '****'
  return `****${value.slice(-4)}`
}

function daysUntilBangkokDate(expirationDate, now = new Date()) {
  if (!expirationDate) return null
  const today = utcInstantFromBangkokYmdHm(bangkokCalendarDate(now), '00:00')
  const expiration = utcInstantFromBangkokYmdHm(bangkokCalendarDate(expirationDate), '00:00')
  return Math.round((expiration.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function computeStatus(expirationDate) {
  const daysUntil = daysUntilBangkokDate(expirationDate)
  if (daysUntil === null) return null
  if (daysUntil < 0) return 'EXPIRED'
  if (daysUntil <= 30) return 'EXPIRING'
  return 'ACTIVE'
}

function formatCard(card, role) {
  const shouldMaskPolicyNumber = role === 'VIEWER' && !card.allowViewerFullAccess

  return {
    ...card,
    policyNumber: shouldMaskPolicyNumber ? maskPolicyNumber(card.policyNumber) : card.policyNumber,
    coverageType: formatCoverageType(card.coverageType),
    expirationDate: toBangkokISO(card.expirationDate),
    createdAt: toBangkokISO(card.createdAt),
    updatedAt: toBangkokISO(card.updatedAt),
    status: computeStatus(card.expirationDate),
  }
}

function normalizeCreateData(body, extractedFields = EMPTY_EXTRACTED_FIELDS) {
  return {
    companyName: trimOrNull(body.companyName) ?? extractedFields.companyName,
    policyNumber: trimOrNull(body.policyNumber) ?? extractedFields.policyNumber,
    groupNumber: trimOrNull(body.groupNumber) ?? extractedFields.groupNumber,
    expirationDate: parseDateInput(body.expirationDate, 'expirationDate') ?? parseExtractedDateInput(extractedFields.expirationDate),
    policyHolderName: trimOrNull(body.policyHolderName) ?? extractedFields.policyHolderName,
    dependentRelationship: trimOrNull(body.dependentRelationship),
    customerServicePhone: trimOrNull(body.customerServicePhone) ?? extractedFields.customerServicePhone,
    emergencyPhone: trimOrNull(body.emergencyPhone) ?? extractedFields.emergencyPhone,
    coverageType: normalizeCoverageType(body.coverageType) ?? null,
    coverageSummary: trimOrNull(body.coverageSummary),
    allowViewerFullAccess: body.allowViewerFullAccess === undefined ? false : parseBoolean(body.allowViewerFullAccess),
  }
}

function normalizeUpdateData(body) {
  const data = {}

  for (const field of INSURANCE_FIELDS) {
    if (body[field] === undefined) continue

    if (field === 'expirationDate') {
      data.expirationDate = parseDateInput(body.expirationDate, 'expirationDate')
      data.reminder60dSent = false
      data.reminder30dSent = false
      data.reminder7dSent = false
    } else if (field === 'coverageType') {
      data.coverageType = normalizeCoverageType(body.coverageType)
    } else if (field === 'allowViewerFullAccess') {
      data.allowViewerFullAccess = parseBoolean(body.allowViewerFullAccess)
    } else {
      data[field] = trimOrNull(body[field])
    }
  }

  return data
}

function parseMatchedLine(rawText, patterns) {
  for (const pattern of patterns) {
    const match = rawText.match(pattern)
    const value = trimOrNull(match?.[1])
    if (value) return value
  }
  return null
}

function parseDateToken(value) {
  const token = trimOrNull(value)
  if (!token) return null

  const isoMatch = token.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const slashMatch = token.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (!slashMatch) return null

  const first = Number(slashMatch[1])
  const second = Number(slashMatch[2])
  let year = slashMatch[3]
  if (year.length === 2) year = `20${year}`

  const month = first > 12 ? second : first
  const day = first > 12 ? first : second
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseInsuranceOcrText(rawText) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return { ...EMPTY_EXTRACTED_FIELDS }
  }

  const text = rawText.replace(/\r/g, '')
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const firstSignalLine = lines.find((line) =>
    /[A-Zก-๙]/.test(line) &&
    !/(policy|member|group|name|phone|tel|date|expire|เลข|ชื่อ|โทร)/i.test(line)
  )

  const companyName =
    parseMatchedLine(text, [
      /(?:company|insurer|provider|carrier|บริษัท|ผู้รับประกัน)\s*(?:name)?\s*[:\-]?\s*([^\n]+)/i,
    ]) ??
    firstSignalLine ??
    null

  const policyNumber = parseMatchedLine(text, [
    /(?:policy|member|certificate|เลขกรมธรรม์|กรมธรรม์)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
  ])

  const groupNumber = parseMatchedLine(text, [
    /(?:group|กลุ่ม)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9-]{1,})/i,
  ])

  const policyHolderName = parseMatchedLine(text, [
    /(?:policy holder|insured name|member name|ผู้เอาประกัน|ชื่อผู้เอาประกัน|ชื่อ)\s*[:\-]?\s*([^\n]+)/i,
  ])

  const expirationDate = parseDateToken(parseMatchedLine(text, [
    /(?:expiration|expiry|expires|valid thru|valid until|วันหมดอายุ|หมดอายุ)\s*(?:date)?\s*[:\-]?\s*([^\n]+)/i,
  ]))

  const customerServicePhone = parseMatchedLine(text, [
    /(?:customer service|member service|service|call center|ติดต่อ|บริการลูกค้า)\s*[:\-]?\s*([+0-9][0-9 ()-]{2,})/i,
  ])

  const emergencyPhone = parseMatchedLine(text, [
    /(?:emergency|ฉุกเฉิน)\s*[:\-]?\s*([+0-9][0-9 ()-]{2,})/i,
  ])

  return {
    companyName,
    policyNumber,
    groupNumber,
    policyHolderName,
    expirationDate,
    customerServicePhone,
    emergencyPhone,
  }
}

async function uploadInsurancePhoto(familyMemberId, file) {
  const resourceType = file.mimetype === 'application/pdf' ? 'raw' : 'image'
  return uploadBuffer(file.buffer, {
    folder: `famcare/insurance/${familyMemberId}`,
    resourceType,
    originalname: file.originalname,
  })
}

async function extractInsuranceText(uploadedPhotos) {
  const urls = uploadedPhotos.map((photo) => photo?.secure_url).filter(Boolean)
  if (urls.length === 0) {
    return {
      extractedText: null,
      extractedFields: { ...EMPTY_EXTRACTED_FIELDS },
      ocrSuccess: false,
    }
  }

  const results = await Promise.allSettled(urls.map((url) => extractText(url)))
  const successfulText = []

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value?.trim()) {
      successfulText.push(result.value.trim())
    } else if (result.status === 'rejected') {
      console.error('[ocr] insurance extraction failed:', result.reason?.message ?? result.reason)
    }
  }

  const extractedText = successfulText.join('\n\n') || null
  return {
    extractedText,
    extractedFields: extractedText ? parseInsuranceOcrText(extractedText) : { ...EMPTY_EXTRACTED_FIELDS },
    ocrSuccess: Boolean(extractedText),
  }
}

async function applyPhotoUpdates(familyMemberId, existingCard, body, data) {
  const { frontPhoto, backPhoto } = getPhotoInputs(body)
  const uploadedForOcr = []

  if (frontPhoto?.buffer) {
    const upload = await uploadInsurancePhoto(familyMemberId, frontPhoto)
    data.frontPhotoUrl = upload.secure_url
    data.frontPhotoPublicId = upload.public_id
    uploadedForOcr.push(upload)

    if (existingCard?.frontPhotoPublicId) {
      deleteByPublicId(existingCard.frontPhotoPublicId)
        .catch(err => console.error('[cloudinary] insurance front delete failed:', err.message))
    }
  }

  if (backPhoto?.buffer) {
    const upload = await uploadInsurancePhoto(familyMemberId, backPhoto)
    data.backPhotoUrl = upload.secure_url
    data.backPhotoPublicId = upload.public_id
    uploadedForOcr.push(upload)

    if (existingCard?.backPhotoPublicId) {
      deleteByPublicId(existingCard.backPhotoPublicId)
        .catch(err => console.error('[cloudinary] insurance back delete failed:', err.message))
    }
  }

  if (uploadedForOcr.length === 0) {
    return {
      extractedText: null,
      extractedFields: { ...EMPTY_EXTRACTED_FIELDS },
      ocrSuccess: false,
    }
  }

  const ocr = await extractInsuranceText(uploadedForOcr)
  if (ocr.extractedText) data.extractedText = ocr.extractedText
  return ocr
}

function ensureFamilyMemberId(familyMemberId) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw badRequest('familyMemberId is required')
  }
}

export async function createInsuranceCard(actorUserId, body) {
  const { familyMemberId } = body
  ensureFamilyMemberId(familyMemberId)
  const role = await assertCanWriteMember(actorUserId, familyMemberId)

  const data = {}
  const ocr = await applyPhotoUpdates(familyMemberId, null, body, data)
  Object.assign(data, normalizeCreateData(body, ocr.extractedFields), {
    familyMemberId,
    addedByUserId: actorUserId,
    extractedText: ocr.extractedText,
  })

  const card = await prisma.insuranceCard.create({ data })

  notifyOwnerIfCaregiver(
    familyMemberId,
    actorUserId,
    `ผู้ดูแลเพิ่มบัตรประกัน ${card.companyName ? `(${card.companyName})` : ''}`.trim()
  ).catch(err => console.error('[notify] insurance create:', err.message))

  return {
    card: formatCard(card, role),
    ocrSuccess: ocr.ocrSuccess,
    extractedFields: ocr.extractedFields,
  }
}

export async function listInsuranceCards(actorUserId, { familyMemberId }) {
  ensureFamilyMemberId(familyMemberId)
  const role = await assertCanReadMember(actorUserId, familyMemberId)

  const cards = await prisma.insuranceCard.findMany({
    where: {
      familyMemberId,
      isDeleted: false,
    },
    orderBy: { createdAt: 'desc' },
  })

  return cards.map((card) => formatCard(card, role))
}

export async function getInsuranceCard(actorUserId, cardId) {
  const card = await prisma.insuranceCard.findUnique({ where: { id: cardId } })
  if (!card || card.isDeleted) throw notFound()

  const role = await assertCanReadMember(actorUserId, card.familyMemberId)
  return formatCard(card, role)
}

export async function updateInsuranceCard(actorUserId, cardId, body) {
  const existingCard = await prisma.insuranceCard.findUnique({ where: { id: cardId } })
  if (!existingCard || existingCard.isDeleted) throw notFound()

  const role = await assertCanWriteMember(actorUserId, existingCard.familyMemberId)
  const data = normalizeUpdateData(body)
  const ocr = await applyPhotoUpdates(existingCard.familyMemberId, existingCard, body, data)

  const updated = await prisma.insuranceCard.update({
    where: { id: cardId },
    data,
  })

  notifyOwnerIfCaregiver(
    existingCard.familyMemberId,
    actorUserId,
    `ผู้ดูแลอัปเดตบัตรประกัน ${updated.companyName ? `(${updated.companyName})` : ''}`.trim()
  ).catch(err => console.error('[notify] insurance update:', err.message))

  return {
    card: formatCard(updated, role),
    ocrSuccess: ocr.ocrSuccess,
    extractedFields: ocr.extractedFields,
  }
}

export async function deleteInsuranceCard(actorUserId, cardId) {
  const card = await prisma.insuranceCard.findUnique({ where: { id: cardId } })
  if (!card || card.isDeleted) throw notFound()

  await assertCanWriteMember(actorUserId, card.familyMemberId)
  await prisma.insuranceCard.update({
    where: { id: cardId },
    data: { isDeleted: true },
  })
}

export async function dispatchExpirationReminders() {
  const cards = await prisma.insuranceCard.findMany({
    where: {
      isDeleted: false,
      expirationDate: { not: null },
    },
    include: {
      familyMember: {
        select: { name: true },
      },
    },
  })

  const thresholds = [
    { days: 60, field: 'reminder60dSent' },
    { days: 30, field: 'reminder30dSent' },
    { days: 7, field: 'reminder7dSent' },
  ]

  for (const card of cards) {
    const daysUntil = daysUntilBangkokDate(card.expirationDate)
    const threshold = thresholds.find((item) => item.days === daysUntil)
    if (!threshold || card[threshold.field]) continue

    try {
      const { recipients } = await getRecipients(card.familyMemberId, 'medicationReminders')
      const text = `เตือนบัตรประกันใกล้หมดอายุ: ${card.companyName ?? 'บัตรประกัน'} สำหรับ ${card.familyMember?.name ?? 'สมาชิก'} จะหมดอายุใน ${threshold.days} วัน`

      for (const lineUserId of recipients) {
        await sendLinePushToUser(lineUserId, text)
      }

      await prisma.insuranceCard.update({
        where: { id: card.id },
        data: { [threshold.field]: true },
      })

      console.log(`[insurance-expiration] sent ${threshold.days}d reminder for ${card.id}`)
    } catch (err) {
      console.error(`[insurance-expiration] reminder failed for ${card.id}:`, err.message)
    }
  }
}
