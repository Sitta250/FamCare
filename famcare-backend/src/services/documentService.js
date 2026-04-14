import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { notifyOwnerIfCaregiver } from './caregiverNotifyService.js'
import { extractText } from './ocrService.js'
import { deleteByPublicId, uploadBuffer } from './cloudinaryService.js'
import { toBangkokISO, utcInstantFromBangkokYmdHm } from '../utils/datetime.js'

const DOCUMENT_TYPES = new Set(['PRESCRIPTION', 'LAB_RESULT', 'DOCTOR_NOTE', 'BILL', 'XRAY', 'OTHER'])

function formatDoc(d) {
  return {
    ...d,
    createdAt: toBangkokISO(d.createdAt),
  }
}

export async function listDocuments(actorUserId, { familyMemberId, keyword, from, to, date }) {
  if (!familyMemberId || typeof familyMemberId !== 'string' || !familyMemberId.trim()) {
    throw Object.assign(new Error('Query parameter familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  }
  await assertCanReadMember(actorUserId, familyMemberId)

  const where = { familyMemberId }
  if (keyword) {
    where.OR = [
      { ocrText: { contains: keyword, mode: 'insensitive' } },
      { tags: { contains: keyword, mode: 'insensitive' } },
    ]
  }

  // Exact Bangkok calendar date wins over the broader from/to range if both are provided.
  if (date) {
    where.createdAt = {
      gte: utcInstantFromBangkokYmdHm(date, '00:00'),
      lte: utcInstantFromBangkokYmdHm(date, '23:59'),
    }
  } else if (from || to) {
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
  const { familyMemberId, type, tags, file } = body

  if (!familyMemberId) throw Object.assign(new Error('familyMemberId is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!type) throw Object.assign(new Error('type is required'), { status: 400, code: 'BAD_REQUEST' })
  if (!DOCUMENT_TYPES.has(type)) throw Object.assign(new Error('type is invalid'), { status: 400, code: 'BAD_REQUEST' })
  if (!file?.buffer) throw Object.assign(new Error('file is required'), { status: 400, code: 'BAD_REQUEST' })

  await assertCanWriteMember(actorUserId, familyMemberId)

  const resourceType = file.mimetype === 'application/pdf' ? 'raw' : 'image'
  const upload = await uploadBuffer(file.buffer, {
    folder: `famcare/documents/${familyMemberId}`,
    resourceType,
    originalname: file.originalname,
  })

  const doc = await prisma.document.create({
    data: {
      familyMemberId,
      addedByUserId: actorUserId,
      type,
      cloudinaryUrl: upload.secure_url,
      cloudinaryPublicId: upload.public_id,
      ocrText: null,
      tags: typeof tags === 'string' && tags.trim() ? tags.trim() : null,
    },
  })

  // Run OCR asynchronously — update doc when done
  extractText(upload.secure_url).then(async (ocrText) => {
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

  if (doc.cloudinaryPublicId) {
    deleteByPublicId(doc.cloudinaryPublicId)
      .catch(err => console.error('[cloudinary] delete failed:', err.message))
  }
}
