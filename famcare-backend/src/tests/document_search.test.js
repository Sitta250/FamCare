import { jest } from '@jest/globals'

const mockDocumentFindMany = jest.fn()
const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockExtractText = jest.fn()
const mockUploadBuffer = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    document: {
      findMany: mockDocumentFindMany,
      create: jest.fn(),
      findUnique: jest.fn(),
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
  deleteByPublicId: jest.fn(),
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: documentsRouter } = await import('../routes/documents.js')
const { errorHandler } = await import('../middleware/errorHandler.js')
const { utcInstantFromBangkokYmdHm } = await import('../utils/datetime.js')

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
  mockDocumentFindMany.mockResolvedValue([fakeDocument()])
})

describe('GET /api/v1/documents', () => {
  test('keyword finds in ocrText', async () => {
    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID, keyword: 'paracetamol' })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(mockDocumentFindMany).toHaveBeenCalledWith({
      where: {
        familyMemberId: MEMBER_ID,
        OR: [
          { ocrText: { contains: 'paracetamol', mode: 'insensitive' } },
          { tags: { contains: 'paracetamol', mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
  })

  test('keyword finds in tags', async () => {
    await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID, keyword: 'painkiller' })

    expect(mockDocumentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { ocrText: { contains: 'painkiller', mode: 'insensitive' } },
            { tags: { contains: 'painkiller', mode: 'insensitive' } },
          ],
        }),
      })
    )
  })

  test('keyword returns empty array when no match', async () => {
    mockDocumentFindMany.mockResolvedValue([])

    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID, keyword: 'missing-term' })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  test('memberId alias resolves correctly', async () => {
    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ memberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(mockAssertCanReadMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
    expect(mockDocumentFindMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID },
      orderBy: { createdAt: 'desc' },
    })
  })

  test('date filter returns only same-day Bangkok docs', async () => {
    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID, date: '2026-04-14' })

    expect(res.status).toBe(200)
    expect(mockDocumentFindMany).toHaveBeenCalledWith({
      where: {
        familyMemberId: MEMBER_ID,
        createdAt: {
          gte: utcInstantFromBangkokYmdHm('2026-04-14', '00:00'),
          lte: utcInstantFromBangkokYmdHm('2026-04-14', '23:59'),
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  })

  test('date takes priority over from/to', async () => {
    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({
        familyMemberId: MEMBER_ID,
        date: '2026-04-14',
        from: '2026-01-01',
        to: '2026-03-31',
      })

    expect(res.status).toBe(200)
    expect(mockDocumentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          familyMemberId: MEMBER_ID,
          createdAt: {
            gte: utcInstantFromBangkokYmdHm('2026-04-14', '00:00'),
            lte: utcInstantFromBangkokYmdHm('2026-04-14', '23:59'),
          },
        },
      })
    )
  })

  test('no keyword or date keeps existing member-only listing behavior', async () => {
    const res = await request
      .get('/api/v1/documents')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(mockDocumentFindMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID },
      orderBy: { createdAt: 'desc' },
    })
  })
})
