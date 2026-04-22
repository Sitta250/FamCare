import { jest } from '@jest/globals'

const mockInsuranceCreate = jest.fn()
const mockInsuranceFindMany = jest.fn()
const mockInsuranceFindUnique = jest.fn()
const mockInsuranceUpdate = jest.fn()

const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockUploadBuffer = jest.fn()
const mockDeleteByPublicId = jest.fn()
const mockExtractText = jest.fn()
const mockSendLinePushToUser = jest.fn()
const mockGetRecipients = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    insuranceCard: {
      create: mockInsuranceCreate,
      findMany: mockInsuranceFindMany,
      findUnique: mockInsuranceFindUnique,
      update: mockInsuranceUpdate,
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

jest.unstable_mockModule('../services/medicationReminderDispatchService.js', () => ({
  getRecipients: mockGetRecipients,
}))

const {
  createInsuranceCard,
  listInsuranceCards,
  updateInsuranceCard,
  deleteInsuranceCard,
  dispatchExpirationReminders,
} = await import('../services/insuranceService.js')

const USER_ID = 'user-1'
const MEMBER_ID = 'member-1'

function dateFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function fakeCard(overrides = {}) {
  return {
    id: 'card-1',
    familyMemberId: MEMBER_ID,
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
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockUploadBuffer.mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
    public_id: 'famcare/insurance/member-1/front',
  })
  mockDeleteByPublicId.mockResolvedValue(undefined)
  mockExtractText.mockResolvedValue('')
  mockSendLinePushToUser.mockResolvedValue(undefined)
  mockGetRecipients.mockResolvedValue({ recipients: ['U_owner', 'U_caregiver'] })
  mockInsuranceCreate.mockImplementation(async ({ data }) => fakeCard(data))
  mockInsuranceUpdate.mockImplementation(async ({ data }) => fakeCard(data))
})

describe('createInsuranceCard', () => {
  test('creates manual insurance card without upload or OCR', async () => {
    const result = await createInsuranceCard(USER_ID, {
      familyMemberId: MEMBER_ID,
      companyName: 'AIA',
      policyNumber: 'POL12345678',
      coverageType: ['medical', 'dental'],
    })

    expect(mockAssertCanWriteMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
    expect(mockUploadBuffer).not.toHaveBeenCalled()
    expect(mockExtractText).not.toHaveBeenCalled()
    expect(mockInsuranceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyMemberId: MEMBER_ID,
        addedByUserId: USER_ID,
        companyName: 'AIA',
        policyNumber: 'POL12345678',
        coverageType: '["medical","dental"]',
        allowViewerFullAccess: false,
      }),
    })
    expect(result.ocrSuccess).toBe(false)
    expect(result.extractedFields).toEqual({
      companyName: null,
      policyNumber: null,
      groupNumber: null,
      policyHolderName: null,
      expirationDate: null,
      customerServicePhone: null,
      emergencyPhone: null,
    })
    expect(result.card.coverageType).toEqual(['medical', 'dental'])
  })

  test('uploads front and back photos, runs OCR, and uses extracted fields', async () => {
    mockUploadBuffer
      .mockResolvedValueOnce({
        secure_url: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
        public_id: 'famcare/insurance/member-1/front',
      })
      .mockResolvedValueOnce({
        secure_url: 'https://res.cloudinary.com/demo/image/upload/back.jpg',
        public_id: 'famcare/insurance/member-1/back',
      })
    mockExtractText.mockResolvedValueOnce([
      'Company: AIA',
      'Policy Number: POL12345678',
      'Group Number: GRP-1',
      'Policy Holder: Somchai',
      'Expiration Date: 2027-01-15',
      'Customer Service: 1581',
    ].join('\n'))
    mockExtractText.mockResolvedValueOnce('Emergency: 02-123-4567')

    const result = await createInsuranceCard(USER_ID, {
      familyMemberId: MEMBER_ID,
      frontPhoto: {
        buffer: Buffer.from('front'),
        mimetype: 'image/jpeg',
        originalname: 'front.jpg',
      },
      backPhoto: {
        buffer: Buffer.from('back'),
        mimetype: 'image/jpeg',
        originalname: 'back.jpg',
      },
    })

    expect(mockUploadBuffer).toHaveBeenCalledTimes(2)
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        folder: `famcare/insurance/${MEMBER_ID}`,
        resourceType: 'image',
      })
    )
    expect(mockExtractText).toHaveBeenCalledWith('https://res.cloudinary.com/demo/image/upload/front.jpg')
    expect(mockExtractText).toHaveBeenCalledWith('https://res.cloudinary.com/demo/image/upload/back.jpg')
    expect(mockInsuranceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyName: 'AIA',
        policyNumber: 'POL12345678',
        groupNumber: 'GRP-1',
        customerServicePhone: '1581',
        emergencyPhone: '02-123-4567',
        frontPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
        backPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/back.jpg',
      }),
    })
    expect(result.ocrSuccess).toBe(true)
    expect(result.extractedFields).toEqual(expect.objectContaining({
      companyName: 'AIA',
      policyNumber: 'POL12345678',
      groupNumber: 'GRP-1',
      customerServicePhone: '1581',
      emergencyPhone: '02-123-4567',
    }))
  })
})

describe('listInsuranceCards', () => {
  test('filters non-deleted cards and masks policy number for viewer', async () => {
    mockAssertCanReadMember.mockResolvedValue('VIEWER')
    mockInsuranceFindMany.mockResolvedValue([
      fakeCard({ expirationDate: dateFromNow(31) }),
      fakeCard({ id: 'card-2', policyNumber: '123', expirationDate: dateFromNow(10) }),
      fakeCard({ id: 'card-3', policyNumber: '987654321', expirationDate: dateFromNow(-1) }),
      fakeCard({ id: 'card-4', policyNumber: 'ALLOW1234', allowViewerFullAccess: true, expirationDate: null }),
    ])

    const result = await listInsuranceCards(USER_ID, { familyMemberId: MEMBER_ID })

    expect(mockInsuranceFindMany).toHaveBeenCalledWith({
      where: {
        familyMemberId: MEMBER_ID,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(result.map((card) => card.policyNumber)).toEqual([
      '****5678',
      '****',
      '****4321',
      'ALLOW1234',
    ])
    expect(result.map((card) => card.status)).toEqual(['ACTIVE', 'EXPIRING', 'EXPIRED', null])
  })
})

describe('updateInsuranceCard', () => {
  test('updates only provided fields and resets reminder flags when expiration changes', async () => {
    mockInsuranceFindUnique.mockResolvedValue(fakeCard())

    await updateInsuranceCard(USER_ID, 'card-1', {
      companyName: 'Updated AIA',
      expirationDate: '2027-02-01',
    })

    expect(mockInsuranceUpdate).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: {
        companyName: 'Updated AIA',
        expirationDate: new Date('2027-02-01'),
        reminder60dSent: false,
        reminder30dSent: false,
        reminder7dSent: false,
      },
    })
  })

  test('replaces uploaded photo and deletes old Cloudinary asset asynchronously', async () => {
    mockInsuranceFindUnique.mockResolvedValue(fakeCard({
      frontPhotoPublicId: 'old/front',
    }))

    await updateInsuranceCard(USER_ID, 'card-1', {
      frontPhoto: {
        buffer: Buffer.from('new-front'),
        mimetype: 'image/jpeg',
        originalname: 'new-front.jpg',
      },
    })

    expect(mockInsuranceUpdate).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: expect.objectContaining({
        frontPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
        frontPhotoPublicId: 'famcare/insurance/member-1/front',
      }),
    })
    expect(mockDeleteByPublicId).toHaveBeenCalledWith('old/front')
  })
})

describe('deleteInsuranceCard', () => {
  test('soft deletes insurance card', async () => {
    mockInsuranceFindUnique.mockResolvedValue(fakeCard())

    await deleteInsuranceCard(USER_ID, 'card-1')

    expect(mockInsuranceUpdate).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { isDeleted: true },
    })
  })
})

describe('dispatchExpirationReminders', () => {
  test('sends threshold reminders once and marks threshold flag', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    mockInsuranceFindMany.mockResolvedValue([
      fakeCard({ id: 'card-60', expirationDate: dateFromNow(60), familyMember: { name: 'Mom' } }),
      fakeCard({ id: 'card-30', expirationDate: dateFromNow(30), familyMember: { name: 'Mom' } }),
      fakeCard({ id: 'card-7', expirationDate: dateFromNow(7), familyMember: { name: 'Mom' } }),
      fakeCard({ id: 'card-sent', expirationDate: dateFromNow(7), reminder7dSent: true, familyMember: { name: 'Mom' } }),
    ])

    await dispatchExpirationReminders()

    expect(mockGetRecipients).toHaveBeenCalledTimes(3)
    expect(mockGetRecipients).toHaveBeenCalledWith(MEMBER_ID, 'medicationReminders')
    expect(mockSendLinePushToUser).toHaveBeenCalledTimes(6)
    expect(mockInsuranceUpdate).toHaveBeenCalledWith({
      where: { id: 'card-60' },
      data: { reminder60dSent: true },
    })
    expect(mockInsuranceUpdate).toHaveBeenCalledWith({
      where: { id: 'card-30' },
      data: { reminder30dSent: true },
    })
    expect(mockInsuranceUpdate).toHaveBeenCalledWith({
      where: { id: 'card-7' },
      data: { reminder7dSent: true },
    })
    expect(mockInsuranceUpdate).not.toHaveBeenCalledWith({
      where: { id: 'card-sent' },
      data: expect.anything(),
    })

    logSpy.mockRestore()
  })
})
