import { jest } from '@jest/globals'

const mockDocumentCreate = jest.fn()
const mockDocumentFindMany = jest.fn()
const mockDocumentFindUnique = jest.fn()
const mockDocumentDelete = jest.fn()
const mockDocumentUpdate = jest.fn()

const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockExtractText = jest.fn()
const mockUploadBuffer = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    document: {
      create: mockDocumentCreate,
      findMany: mockDocumentFindMany,
      findUnique: mockDocumentFindUnique,
      delete: mockDocumentDelete,
      update: mockDocumentUpdate,
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
  deleteByPublicId: jest.fn(),
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
const AUTH = { 'x-line-userid': LINE_ID }

function fakeDocument(overrides = {}) {
  return {
    id: 'doc-1',
    familyMemberId: MEMBER_ID,
    addedByUserId: USER_ID,
    type: 'PRESCRIPTION',
    cloudinaryUrl: 'https://res.cloudinary.com/demo/image/upload/v1/famcare/documents/member-abc/doc-1.jpg',
    cloudinaryPublicId: 'famcare/documents/member-abc/doc-1',
    ocrText: null,
    tags: 'thai,rx',
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
  mockUploadBuffer.mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/famcare/documents/member-abc/doc-1.jpg',
    public_id: 'famcare/documents/member-abc/doc-1',
  })
  mockDocumentCreate.mockImplementation(async ({ data }) => fakeDocument(data))
})

describe('POST /api/v1/documents', () => {
  test('valid upload returns 201 with expected shape', async () => {
    const res = await request
      .post('/api/v1/documents')
      .set(AUTH)
      .field('familyMemberId', MEMBER_ID)
      .field('type', 'PRESCRIPTION')
      .field('tags', 'thai,rx')
      .attach('file', Buffer.from('image-bytes'), { filename: 'prescription.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(201)
    expect(res.body.data.cloudinaryUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//)
    expect(res.body.data.cloudinaryPublicId).toBe('famcare/documents/member-abc/doc-1')
    expect(res.body.data.tags).toBe('thai,rx')
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        folder: `famcare/documents/${MEMBER_ID}`,
        resourceType: 'image',
        originalname: 'prescription.jpg',
      })
    )
    expect(mockDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyMemberId: MEMBER_ID,
        type: 'PRESCRIPTION',
        cloudinaryPublicId: 'famcare/documents/member-abc/doc-1',
        tags: 'thai,rx',
      }),
    })
  })

  test('missing familyMemberId returns 400', async () => {
    const res = await request
      .post('/api/v1/documents')
      .set(AUTH)
      .field('type', 'PRESCRIPTION')
      .attach('file', Buffer.from('image-bytes'), { filename: 'prescription.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'familyMemberId is required' })
  })

  test('invalid type returns 400', async () => {
    const res = await request
      .post('/api/v1/documents')
      .set(AUTH)
      .field('familyMemberId', MEMBER_ID)
      .field('type', 'NOT_A_TYPE')
      .attach('file', Buffer.from('image-bytes'), { filename: 'prescription.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'type is invalid' })
  })

  test('multer file size exceeded returns 413', async () => {
    const res = await request
      .post('/api/v1/documents')
      .set(AUTH)
      .field('familyMemberId', MEMBER_ID)
      .field('type', 'PRESCRIPTION')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), {
        filename: 'large.jpg',
        contentType: 'image/jpeg',
      })

    expect(res.status).toBe(413)
    expect(res.body).toEqual({ code: 'FILE_TOO_LARGE', error: 'File too large' })
  })

  test('unsupported MIME returns 415', async () => {
    const res = await request
      .post('/api/v1/documents')
      .set(AUTH)
      .field('familyMemberId', MEMBER_ID)
      .field('type', 'PRESCRIPTION')
      .attach('file', Buffer.from('exe-bytes'), { filename: 'malware.exe', contentType: 'application/x-msdownload' })

    expect(res.status).toBe(415)
    expect(res.body).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', error: 'Unsupported file type' })
  })

  test('Cloudinary upload failure returns upstream error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockUploadBuffer.mockRejectedValue(
      Object.assign(new Error('Cloudinary unavailable'), { status: 500, code: 'UPLOAD_UNAVAILABLE' })
    )

    const res = await request
      .post('/api/v1/documents')
      .set(AUTH)
      .field('familyMemberId', MEMBER_ID)
      .field('type', 'PRESCRIPTION')
      .attach('file', Buffer.from('image-bytes'), { filename: 'prescription.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ code: 'UPLOAD_UNAVAILABLE', error: 'Cloudinary unavailable' })
    expect(mockDocumentCreate).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  test('successful upload triggers async OCR update when text is extracted', async () => {
    mockExtractText.mockResolvedValue('Detected Thai text')

    const res = await request
      .post('/api/v1/documents')
      .set(AUTH)
      .field('familyMemberId', MEMBER_ID)
      .field('type', 'PRESCRIPTION')
      .attach('file', Buffer.from('image-bytes'), { filename: 'prescription.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(201)

    await new Promise((resolve) => setImmediate(resolve))

    expect(mockExtractText).toHaveBeenCalledWith('https://res.cloudinary.com/demo/image/upload/v1/famcare/documents/member-abc/doc-1.jpg')
    expect(mockDocumentUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { ocrText: 'Detected Thai text' },
    })
  })
})
