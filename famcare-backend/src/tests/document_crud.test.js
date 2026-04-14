import { jest } from '@jest/globals'

const mockDocumentFindMany = jest.fn()
const mockDocumentFindUnique = jest.fn()
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
      findMany: mockDocumentFindMany,
      findUnique: mockDocumentFindUnique,
      create: jest.fn(),
      delete: jest.fn(),
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
    ocrText: 'Paracetamol after breakfast',
    tags: 'painkiller,thai',
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
  mockDeleteByPublicId.mockResolvedValue(undefined)
  mockDocumentFindMany.mockResolvedValue([fakeDocument()])
  mockDocumentFindUnique.mockResolvedValue(fakeDocument())
})

describe('GET /api/v1/documents', () => {
  test('returns member documents with Bangkok-formatted dates', async () => {
    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].createdAt).toBe('2026-04-14T10:00:00.000+07:00')
    expect(mockAssertCanReadMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
  })

  test('returns 403 when list access is denied', async () => {
    mockAssertCanReadMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
    expect(mockDocumentFindMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/documents/:id', () => {
  test('returns a document when found', async () => {
    const res = await request
      .get(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(DOC_ID)
    expect(res.body.data.createdAt).toBe('2026-04-14T10:00:00.000+07:00')
  })

  test('returns 404 when document is missing', async () => {
    mockDocumentFindUnique.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ code: 'NOT_FOUND', error: 'Document not found' })
  })

  test('returns 403 when read access is denied', async () => {
    mockAssertCanReadMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get(`/api/v1/documents/${DOC_ID}`)
      .set(AUTH)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
  })
})
