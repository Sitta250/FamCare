import { jest } from '@jest/globals'

const mockDocumentFindUnique = jest.fn()
const mockDocumentDelete = jest.fn()
const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockExtractText = jest.fn()
const mockUploadBuffer = jest.fn()
const mockDeleteByPublicId = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    document: {
      findUnique: mockDocumentFindUnique,
      delete: mockDocumentDelete,
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
  assertCanWriteMember: mockAssertCanWriteMember,
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

jest.unstable_mockModule('../services/ocrService.js', () => ({
  extractText: mockExtractText,
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: mockUploadBuffer,
  deleteByPublicId: mockDeleteByPublicId,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: documentsRouter } = await import('../routes/documents.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/documents', documentsRouter)
app.use(errorHandler)

const request = supertest(app)

const USER_ID = 'user-1'
const LINE_ID = 'U_test_123'
const MEMBER_ID = 'member-abc'
const DOC_ID = 'doc-1'
const AUTH = { 'x-line-userid': LINE_ID }

function fakeDocument(overrides = {}) {
  return {
    id: DOC_ID,
    familyMemberId: MEMBER_ID,
    addedByUserId: USER_ID,
    type: 'PRESCRIPTION',
    cloudinaryUrl: 'https://res.cloudinary.com/demo/image/upload/v1/famcare/documents/member-abc/doc-1.jpg',
    cloudinaryPublicId: 'famcare/documents/member-abc/doc-1',
    ocrText: null,
    tags: null,
    createdAt: new Date('2026-04-14T03:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreateByLineUserId.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockExtractText.mockResolvedValue('')
  mockUploadBuffer.mockResolvedValue({})
  mockDocumentFindUnique.mockResolvedValue(fakeDocument())
  mockDocumentDelete.mockResolvedValue(fakeDocument())
  mockDeleteByPublicId.mockResolvedValue(undefined)
})

describe('DELETE /api/v1/documents/:id', () => {
  test('deletes DB record and calls Cloudinary cleanup when public id is present', async () => {
    const res = await request
      .delete(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(mockDocumentDelete).toHaveBeenCalledWith({ where: { id: DOC_ID } })
    expect(mockDeleteByPublicId).toHaveBeenCalledWith('famcare/documents/member-abc/doc-1')
  })

  test('deletes legacy document without Cloudinary cleanup when public id is null', async () => {
    mockDocumentFindUnique.mockResolvedValue(fakeDocument({ cloudinaryPublicId: null }))

    const res = await request
      .delete(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(mockDocumentDelete).toHaveBeenCalledWith({ where: { id: DOC_ID } })
    expect(mockDeleteByPublicId).not.toHaveBeenCalled()
  })

  test('Cloudinary delete failure does not block 204 response', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockDeleteByPublicId.mockRejectedValue(new Error('cloudinary down'))

    const res = await request
      .delete(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(204)
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockDeleteByPublicId).toHaveBeenCalledWith('famcare/documents/member-abc/doc-1')
    expect(errorSpy).toHaveBeenCalledWith('[cloudinary] delete failed:', 'cloudinary down')

    errorSpy.mockRestore()
  })

  test('returns 404 for missing document', async () => {
    mockDocumentFindUnique.mockResolvedValue(null)

    const res = await request
      .delete(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ code: 'NOT_FOUND', error: 'Document not found' })
    expect(mockDocumentDelete).not.toHaveBeenCalled()
    expect(mockDeleteByPublicId).not.toHaveBeenCalled()
  })

  test('returns 403 when delete access is denied', async () => {
    mockAssertCanWriteMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .delete(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
    expect(mockDocumentDelete).not.toHaveBeenCalled()
    expect(mockDeleteByPublicId).not.toHaveBeenCalled()
  })
})
