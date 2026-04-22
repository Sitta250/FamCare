import { jest } from '@jest/globals'

const mockCreate = jest.fn()
const mockFindMany = jest.fn()
const mockFindUnique = jest.fn()
const mockUpdate = jest.fn()

const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()
const mockUploadBuffer = jest.fn()
const mockDeleteByPublicId = jest.fn()
const mockExtractText = jest.fn()
const mockSendLinePushToUser = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockGetRecipients = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    insuranceCard: {
      create: mockCreate,
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
  assertCanWriteMember: mockAssertCanWriteMember,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: mockUploadBuffer,
  deleteByPublicId: mockDeleteByPublicId,
}))

jest.unstable_mockModule('../services/ocrService.js', () => ({
  extractText: mockExtractText,
}))

jest.unstable_mockModule('../services/linePushService.js', () => ({
  sendLinePushToUser: mockSendLinePushToUser,
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

jest.unstable_mockModule('../services/medicationReminderDispatchService.js', () => ({
  getRecipients: mockGetRecipients,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: insuranceRouter } = await import('../routes/insurance.js')
const { errorHandler } = await import('../middleware/errorHandler.js')
const { dispatchExpirationReminders } = await import('../services/insuranceService.js')

const app = express()
app.use(express.json())
app.use('/api/v1/insurance', insuranceRouter)
app.use(errorHandler)

const request = supertest(app)

const USER_ID = 'user-1'
const LINE_ID = 'U_test_123'
const MEMBER_A_ID = 'member-a'
const MEMBER_B_ID = 'member-b'
const AUTH = { 'x-line-userid': LINE_ID }

function dateFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function emptyExtractedFields() {
  return {
    companyName: null,
    policyNumber: null,
    groupNumber: null,
    policyHolderName: null,
    expirationDate: null,
    customerServicePhone: null,
    emergencyPhone: null,
  }
}

function fakeCard(overrides = {}) {
  return {
    id: 'card-1',
    familyMemberId: MEMBER_A_ID,
    addedByUserId: USER_ID,
    companyName: 'AIA',
    policyNumber: 'POL12345678',
    groupNumber: 'GRP-1',
    expirationDate: dateFromNow(90),
    policyHolderName: 'Somchai',
    dependentRelationship: 'self',
    customerServicePhone: '1581',
    emergencyPhone: '02-123-4567',
    coverageType: '["medical","dental"]',
    coverageSummary: 'Medical coverage',
    frontPhotoUrl: null,
    backPhotoUrl: null,
    frontPhotoPublicId: null,
    backPhotoPublicId: null,
    extractedText: null,
    isDeleted: false,
    allowViewerFullAccess: false,
    reminder60dSent: false,
    reminder30dSent: false,
    reminder7dSent: false,
    createdAt: new Date('2026-04-22T03:00:00Z'),
    updatedAt: new Date('2026-04-22T03:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreateByLineUserId.mockResolvedValue({
    id: USER_ID,
    lineUserId: LINE_ID,
    displayName: 'Test User',
  })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockDeleteByPublicId.mockResolvedValue(undefined)
  mockExtractText.mockResolvedValue('')
  mockSendLinePushToUser.mockResolvedValue(undefined)
  mockGetRecipients.mockResolvedValue({ recipients: ['U_owner', 'U_caregiver'] })
  mockUploadBuffer.mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
    public_id: 'famcare/insurance/member-a/front',
  })
  mockCreate.mockImplementation(async ({ data }) => fakeCard(data))
  mockUpdate.mockImplementation(async ({ data, where }) => fakeCard({ id: where.id, ...data }))
})

describe('insurance card API and service integration', () => {
  test('1. POST with front/back photos uploads, OCRs, and returns extracted fields', async () => {
    mockUploadBuffer
      .mockResolvedValueOnce({
        secure_url: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
        public_id: 'famcare/insurance/member-a/front',
      })
      .mockResolvedValueOnce({
        secure_url: 'https://res.cloudinary.com/demo/image/upload/back.jpg',
        public_id: 'famcare/insurance/member-a/back',
      })
    mockExtractText
      .mockResolvedValueOnce([
        'Company: AIA',
        'Policy Number: POL12345678',
        'Group Number: GRP-1',
        'Policy Holder: Somchai',
        'Expiration Date: 2027-01-15',
        'Customer Service: 1581',
      ].join('\n'))
      .mockResolvedValueOnce('Emergency: 02-123-4567')

    const res = await request
      .post('/api/v1/insurance')
      .set(AUTH)
      .field('familyMemberId', MEMBER_A_ID)
      .attach('frontPhoto', Buffer.from('front-bytes'), { filename: 'front.jpg', contentType: 'image/jpeg' })
      .attach('backPhoto', Buffer.from('back-bytes'), { filename: 'back.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(201)
    expect(mockUploadBuffer).toHaveBeenCalledTimes(2)
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        folder: `famcare/insurance/${MEMBER_A_ID}`,
        resourceType: 'image',
        originalname: 'front.jpg',
      })
    )
    expect(mockExtractText).toHaveBeenCalledWith('https://res.cloudinary.com/demo/image/upload/front.jpg')
    expect(mockExtractText).toHaveBeenCalledWith('https://res.cloudinary.com/demo/image/upload/back.jpg')
    expect(res.body.ocrSuccess).toBe(true)
    expect(res.body.extractedFields).toEqual(expect.objectContaining({
      companyName: 'AIA',
      policyNumber: 'POL12345678',
      groupNumber: 'GRP-1',
      policyHolderName: 'Somchai',
      customerServicePhone: '1581',
      emergencyPhone: '02-123-4567',
    }))
    expect(res.body.data).toEqual(expect.objectContaining({
      frontPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
      backPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/back.jpg',
      companyName: 'AIA',
      policyNumber: 'POL12345678',
    }))
  })

  test('2. POST manual entry creates without upload or OCR', async () => {
    const res = await request
      .post('/api/v1/insurance')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_A_ID,
        companyName: 'AIA',
        policyNumber: 'POL12345678',
      })

    expect(res.status).toBe(201)
    expect(mockUploadBuffer).not.toHaveBeenCalled()
    expect(mockExtractText).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyMemberId: MEMBER_A_ID,
        addedByUserId: USER_ID,
        companyName: 'AIA',
        policyNumber: 'POL12345678',
      }),
    })
    expect(res.body.ocrSuccess).toBe(false)
    expect(res.body.extractedFields).toEqual(emptyExtractedFields())
  })

  test('3. GET list by memberId filters non-deleted cards', async () => {
    mockFindMany.mockResolvedValue([
      fakeCard({ id: 'card-a-1' }),
      fakeCard({ id: 'card-a-2' }),
    ])

    const res = await request
      .get('/api/v1/insurance')
      .query({ memberId: MEMBER_A_ID })
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        familyMemberId: MEMBER_A_ID,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
    })
  })

  test('4. GET by VIEWER role masks policy number', async () => {
    mockFindUnique.mockResolvedValue(fakeCard())
    mockAssertCanReadMember.mockResolvedValue('VIEWER')

    const res = await request
      .get('/api/v1/insurance/card-1')
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.policyNumber).toBe('****5678')
  })

  test('5. GET by OWNER/CAREGIVER role returns full policy number', async () => {
    mockFindUnique.mockResolvedValue(fakeCard())
    mockAssertCanReadMember.mockResolvedValue('CAREGIVER')

    const res = await request
      .get('/api/v1/insurance/card-1')
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.policyNumber).toBe('POL12345678')
  })

  test('6. PATCH partial update only sends provided fields', async () => {
    mockFindUnique.mockResolvedValue(fakeCard())

    const res = await request
      .patch('/api/v1/insurance/card-1')
      .set(AUTH)
      .send({ companyName: 'Updated AIA' })

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { companyName: 'Updated AIA' },
    })
    expect(res.body.data.companyName).toBe('Updated AIA')
  })

  test('7. DELETE soft-deletes the card', async () => {
    mockFindUnique.mockResolvedValue(fakeCard())

    const res = await request
      .delete('/api/v1/insurance/card-1')
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { isDeleted: true },
    })
  })

  test('8. computes ACTIVE, EXPIRING, EXPIRED, and null statuses', async () => {
    mockFindMany.mockResolvedValue([
      fakeCard({ id: 'active', expirationDate: dateFromNow(31) }),
      fakeCard({ id: 'expiring', expirationDate: dateFromNow(30) }),
      fakeCard({ id: 'expired', expirationDate: dateFromNow(-1) }),
      fakeCard({ id: 'no-date', expirationDate: null }),
    ])

    const res = await request
      .get('/api/v1/insurance')
      .query({ memberId: MEMBER_A_ID })
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.map((card) => card.status)).toEqual([
      'ACTIVE',
      'EXPIRING',
      'EXPIRED',
      null,
    ])
  })

  test('9. expiration dispatch sends 60d/30d/7d reminders once and updates flags', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    mockFindMany.mockResolvedValue([
      fakeCard({ id: 'card-60', expirationDate: dateFromNow(60), familyMember: { name: 'Mom' } }),
      fakeCard({ id: 'card-30', expirationDate: dateFromNow(30), familyMember: { name: 'Mom' } }),
      fakeCard({ id: 'card-7', expirationDate: dateFromNow(7), familyMember: { name: 'Mom' } }),
      fakeCard({ id: 'card-7-sent', expirationDate: dateFromNow(7), reminder7dSent: true, familyMember: { name: 'Mom' } }),
    ])

    await dispatchExpirationReminders()

    expect(mockGetRecipients).toHaveBeenCalledTimes(3)
    expect(mockGetRecipients).toHaveBeenCalledWith(MEMBER_A_ID, 'medicationReminders')
    expect(mockSendLinePushToUser).toHaveBeenCalledTimes(6)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'card-60' },
      data: { reminder60dSent: true },
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'card-30' },
      data: { reminder30dSent: true },
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'card-7' },
      data: { reminder7dSent: true },
    })
    expect(mockUpdate).not.toHaveBeenCalledWith({
      where: { id: 'card-7-sent' },
      data: expect.anything(),
    })

    logSpy.mockRestore()
  })

  test('10. OCR failure still creates card with ocrSuccess false', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockExtractText.mockRejectedValue(new Error('OCR unavailable'))

    const res = await request
      .post('/api/v1/insurance')
      .set(AUTH)
      .field('familyMemberId', MEMBER_A_ID)
      .attach('frontPhoto', Buffer.from('front-bytes'), { filename: 'front.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(201)
    expect(res.body.ocrSuccess).toBe(false)
    expect(res.body.extractedFields).toEqual(emptyExtractedFields())
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyMemberId: MEMBER_A_ID,
        extractedText: null,
        frontPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
      }),
    })

    errorSpy.mockRestore()
  })

  test('11. Thai text fields are stored and returned correctly', async () => {
    const res = await request
      .post('/api/v1/insurance')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_A_ID,
        companyName: 'เมืองไทยประกันชีวิต',
        policyHolderName: 'สมชาย ใจดี',
      })

    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyName: 'เมืองไทยประกันชีวิต',
        policyHolderName: 'สมชาย ใจดี',
      }),
    })
    expect(res.body.data.companyName).toBe('เมืองไทยประกันชีวิต')
    expect(res.body.data.policyHolderName).toBe('สมชาย ใจดี')
  })

  test('12. multiple cards per member do not leak cards from other members', async () => {
    const memberACards = [
      fakeCard({ id: 'card-a-1', familyMemberId: MEMBER_A_ID }),
      fakeCard({ id: 'card-a-2', familyMemberId: MEMBER_A_ID }),
    ]
    const memberBCards = [
      fakeCard({ id: 'card-b-1', familyMemberId: MEMBER_B_ID }),
    ]

    mockFindMany.mockImplementation(async ({ where }) => {
      if (where.familyMemberId === MEMBER_A_ID) return memberACards
      if (where.familyMemberId === MEMBER_B_ID) return memberBCards
      return []
    })

    const res = await request
      .get('/api/v1/insurance')
      .query({ memberId: MEMBER_A_ID })
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.map((card) => card.id)).toEqual(['card-a-1', 'card-a-2'])
    expect(res.body.data.every((card) => card.familyMemberId === MEMBER_A_ID)).toBe(true)
    expect(res.body.data.map((card) => card.id)).not.toContain('card-b-1')
  })
})
