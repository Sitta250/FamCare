import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { extractText } from './ocrService.js'
import { toBangkokISO } from '../utils/datetime.js'

const HTTPS_URL_RE = /^https:\/\/.+/

function formatDoc(d) {
  return {
    ...d,
    createdAt: toBangkokISO(d.createdAt),
  }
}

export async function listDocuments(actorUserId, { familyMemberId, q, from, to }) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw Object.assign(new Error('Query parameter familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  }
  await assertCanReadMember(actorUserId, familyMemberId)

  const where = { familyMemberId }
  if (q) {
    where.ocrText = { contains: q, mode: 'insensitive' }
  }
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)
  }

  const rows = await prisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(formatDoc)
}

export async function createDocument(actorUserId, body) {
  const { familyMemberId, type, cloudinaryUrl } = body

  if (!familyMemberId) throw Object.assign(new Error('familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!type) throw Object.assign(new Error('type is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!cloudinaryUrl || !HTTPS_URL_RE.test(cloudinaryUrl)) {
    throw Object.assign(new Error('cloudinaryUrl must be a valid HTTPS URL'), { status: 400, code: 'BAD_REQUEST' })
  }

  await assertCanWriteMember(actorUserId, familyMemberId)

  const doc = await prisma.document.create({
    data: {
      familyMemberId,
      addedByUserId: actorUserId,
      type,
      cloudinaryUrl,
      ocrText: null,
    },
  })

  // Run OCR asynchronously — update doc when done
  extractText(cloudinaryUrl).then(async (ocrText) => {
    if (ocrText) {
      await prisma.document.update({ where: { id: doc.id }, data: { ocrText } })
    }
  }).catch(err => console.error('[ocr] extraction failed:', err.message))

  notifyOwnerIfCaregiver(
    familyMemberId,
    actorUserId,
    `ผู้ดูแลอัปโหลดเอกสาร (${type})`
  ).catch(err => console.error('[notify] document create:', err.message))

  return formatDoc(doc)
}

export async function getDocument(actorUserId, documentId) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) throw Object.assign(new Error('Document not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanReadMember(actorUserId, doc.familyMemberId)
  return formatDoc(doc)
}

export async function deleteDocument(actorUserId, documentId) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) throw Object.assign(new Error('Document not found'), { status: 404, code: 'NOT_FOUND' })
  await assertCanWriteMember(actorUserId, doc.familyMemberId)
  await prisma.document.delete({ where: { id: documentId } })
}
