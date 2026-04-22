import { jest } from '@jest/globals'

const mockCreateInsuranceCard = jest.fn()
const mockListInsuranceCards = jest.fn()
const mockGetInsuranceCard = jest.fn()
const mockUpdateInsuranceCard = jest.fn()
const mockDeleteInsuranceCard = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()
const mockUpdateChatMode = jest.fn()
const mockDeleteUserAndData = jest.fn()

jest.unstable_mockModule('../services/insuranceService.js', () => ({
  createInsuranceCard: mockCreateInsuranceCard,
  listInsuranceCards: mockListInsuranceCards,
  getInsuranceCard: mockGetInsuranceCard,
  updateInsuranceCard: mockUpdateInsuranceCard,
  deleteInsuranceCard: mockDeleteInsuranceCard,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
  updateChatMode: mockUpdateChatMode,
  deleteUserAndData: mockDeleteUserAndData,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: apiRouter } = await import('../routes/index.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1', apiRouter)
app.use(errorHandler)

const request = supertest(app)

const USER_ID = 'user-1'
const LINE_ID = 'U_test_123'
const MEMBER_ID = 'member-1'
const AUTH = { 'x-line-userid': LINE_ID }

function fakeCard(overrides = {}) {
  return {
    id: 'card-1',
    familyMemberId: MEMBER_ID,
    companyName: 'AIA',
    policyNumber: 'POL12345678',
    status: 'ACTIVE',
    createdAt: '2026-04-22T10:00:00.000+07:00',
    updatedAt: '2026-04-22T10:00:00.000+07:00',
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
  mockCreateInsuranceCard.mockResolvedValue({
    card: fakeCard(),
    ocrSuccess: true,
    extractedFields: { companyName: 'AIA' },
  })
  mockListInsuranceCards.mockResolvedValue([fakeCard(), fakeCard({ id: 'card-2' })])
  mockGetInsuranceCard.mockResolvedValue(fakeCard())
  mockUpdateInsuranceCard.mockResolvedValue({
    card: fakeCard({ companyName: 'Updated AIA' }),
    ocrSuccess: false,
    extractedFields: { companyName: null },
  })
  mockDeleteInsuranceCard.mockResolvedValue(undefined)
})

describe('/api/v1/insurance routes', () => {
  test('POST creates card and passes multipart files to service', async () => {
    const res = await request
      .post('/api/v1/insurance')
      .set(AUTH)
      .field('familyMemberId', MEMBER_ID)
      .field('companyName', 'AIA')
      .attach('frontPhoto', Buffer.from('front'), { filename: 'front.jpg', contentType: 'image/jpeg' })
      .attach('backPhoto', Buffer.from('back'), { filename: 'back.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      data: fakeCard(),
      ocrSuccess: true,
      extractedFields: { companyName: 'AIA' },
    })
    expect(mockCreateInsuranceCard).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        familyMemberId: MEMBER_ID,
        companyName: 'AIA',
        files: expect.objectContaining({
          frontPhoto: [expect.objectContaining({ originalname: 'front.jpg' })],
          backPhoto: [expect.objectContaining({ originalname: 'back.jpg' })],
        }),
      })
    )
  })

  test('GET list supports memberId alias', async () => {
    const res = await request
      .get('/api/v1/insurance')
      .query({ memberId: MEMBER_ID })
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(mockListInsuranceCards).toHaveBeenCalledWith(USER_ID, { familyMemberId: MEMBER_ID })
  })

  test('GET by id returns one card', async () => {
    const res = await request
      .get('/api/v1/insurance/card-1')
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: fakeCard() })
    expect(mockGetInsuranceCard).toHaveBeenCalledWith(USER_ID, 'card-1')
  })

  test('PATCH updates card and passes optional files to service', async () => {
    const res = await request
      .patch('/api/v1/insurance/card-1')
      .set(AUTH)
      .field('companyName', 'Updated AIA')
      .attach('frontPhoto', Buffer.from('front'), { filename: 'front.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      data: fakeCard({ companyName: 'Updated AIA' }),
      ocrSuccess: false,
      extractedFields: { companyName: null },
    })
    expect(mockUpdateInsuranceCard).toHaveBeenCalledWith(
      USER_ID,
      'card-1',
      expect.objectContaining({
        companyName: 'Updated AIA',
        files: expect.objectContaining({
          frontPhoto: [expect.objectContaining({ originalname: 'front.jpg' })],
        }),
      })
    )
  })

  test('DELETE soft deletes card', async () => {
    const res = await request
      .delete('/api/v1/insurance/card-1')
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(mockDeleteInsuranceCard).toHaveBeenCalledWith(USER_ID, 'card-1')
  })

  test('requires LINE auth', async () => {
    const res = await request
      .get('/api/v1/insurance')
      .query({ memberId: MEMBER_ID })

    expect(res.status).toBe(401)
    expect(mockListInsuranceCards).not.toHaveBeenCalled()
  })
})
