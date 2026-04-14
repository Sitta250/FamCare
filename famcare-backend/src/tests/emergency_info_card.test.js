import { jest } from '@jest/globals'

const MEMBER_ID = 'member-1'
const CONTACT_ID = 'contact-1'
const USER_ID = 'user-1'
const LINE_ID = 'Uabc123'
const AUTH = { 'x-line-userid': LINE_ID }

const mockGetEmergencyCard = jest.fn()
const mockListEmergencyContacts = jest.fn()
const mockCreateEmergencyContact = jest.fn()
const mockUpdateEmergencyContact = jest.fn()
const mockDeleteEmergencyContact = jest.fn()
const mockFindOrCreate = jest.fn()

jest.unstable_mockModule('../services/emergencyCardService.js', () => ({
  getEmergencyCard: mockGetEmergencyCard,
}))

jest.unstable_mockModule('../services/emergencyContactService.js', () => ({
  listEmergencyContacts: mockListEmergencyContacts,
  createEmergencyContact: mockCreateEmergencyContact,
  updateEmergencyContact: mockUpdateEmergencyContact,
  deleteEmergencyContact: mockDeleteEmergencyContact,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: router } = await import('../routes/familyMembers.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/family-members', router)
app.use(errorHandler)

const request = supertest(app)

function fakeCard(overrides = {}) {
  return {
    memberId: MEMBER_ID,
    name: 'Somchai Jaidee',
    bloodType: 'O+',
    allergies: 'Penicillin',
    conditions: 'Hypertension',
    preferredHospital: 'Bangkok Hospital',
    medications: [
      { id: 'med-1', name: 'Metformin', dosage: '500mg', frequency: '2x daily' },
    ],
    emergencyContacts: [
      {
        id: CONTACT_ID,
        name: 'Napa Jaidee',
        phone: '0812345678',
        relation: 'Daughter',
        sortOrder: 0,
        createdAt: '2026-04-14T17:00:00.000+07:00',
        updatedAt: '2026-04-14T18:00:00.000+07:00',
      },
    ],
    ...overrides,
  }
}

function fakeContact(overrides = {}) {
  return {
    id: CONTACT_ID,
    name: 'Napa Jaidee',
    phone: '0812345678',
    relation: 'Daughter',
    sortOrder: 0,
    createdAt: '2026-04-14T17:00:00.000+07:00',
    updatedAt: '2026-04-14T18:00:00.000+07:00',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID })
  mockGetEmergencyCard.mockResolvedValue(fakeCard())
  mockListEmergencyContacts.mockResolvedValue([fakeContact()])
  mockCreateEmergencyContact.mockResolvedValue(fakeContact())
  mockUpdateEmergencyContact.mockResolvedValue(fakeContact({ relation: 'Sister' }))
  mockDeleteEmergencyContact.mockResolvedValue(undefined)
})

describe('GET /api/v1/family-members/:memberId/emergency-card', () => {
  test('returns 200 with all fields populated', async () => {
    const res = await request
      .get(`/api/v1/family-members/${MEMBER_ID}/emergency-card`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(fakeCard())
    expect(mockGetEmergencyCard).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
  })

  test('returns 200 with medications: [] when no active medications', async () => {
    mockGetEmergencyCard.mockResolvedValue(fakeCard({ medications: [] }))

    const res = await request
      .get(`/api/v1/family-members/${MEMBER_ID}/emergency-card`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.medications).toEqual([])
  })

  test('returns 200 with emergencyContacts: [] when none exist', async () => {
    mockGetEmergencyCard.mockResolvedValue(fakeCard({ emergencyContacts: [] }))

    const res = await request
      .get(`/api/v1/family-members/${MEMBER_ID}/emergency-card`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.emergencyContacts).toEqual([])
  })

  test('returns 404 when member is not found or soft-deleted', async () => {
    mockGetEmergencyCard.mockRejectedValue(
      Object.assign(new Error('Family member not found'), { status: 404, code: 'NOT_FOUND' })
    )

    const res = await request
      .get(`/api/v1/family-members/${MEMBER_ID}/emergency-card`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Family member not found', code: 'NOT_FOUND' })
  })

  test('returns 403 when caller lacks access', async () => {
    mockGetEmergencyCard.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get(`/api/v1/family-members/${MEMBER_ID}/emergency-card`)
      .set(AUTH)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Access denied', code: 'FORBIDDEN' })
  })

  test('returns 401 when x-line-userid header is missing', async () => {
    const res = await request.get(`/api/v1/family-members/${MEMBER_ID}/emergency-card`)

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Missing x-line-userid header', code: 'UNAUTHORIZED' })
    expect(mockFindOrCreate).not.toHaveBeenCalled()
    expect(mockGetEmergencyCard).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/family-members/:memberId/emergency-contacts', () => {
  test('returns 200 with contact list', async () => {
    const res = await request
      .get(`/api/v1/family-members/${MEMBER_ID}/emergency-contacts`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([fakeContact()])
    expect(mockListEmergencyContacts).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
  })
})

describe('POST /api/v1/family-members/:memberId/emergency-contacts', () => {
  test('returns 201 and creates contact', async () => {
    const payload = { name: 'Napa Jaidee', phone: '0812345678', relation: 'Daughter' }

    const res = await request
      .post(`/api/v1/family-members/${MEMBER_ID}/emergency-contacts`)
      .set(AUTH)
      .send(payload)

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual(fakeContact())
    expect(mockCreateEmergencyContact).toHaveBeenCalledWith(USER_ID, MEMBER_ID, payload)
  })

  test('returns 400 when name is missing', async () => {
    mockCreateEmergencyContact.mockRejectedValue(
      Object.assign(new Error('name is required'), { status: 400, code: 'BAD_REQUEST' })
    )

    const res = await request
      .post(`/api/v1/family-members/${MEMBER_ID}/emergency-contacts`)
      .set(AUTH)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'name is required', code: 'BAD_REQUEST' })
  })
})

describe('PATCH /api/v1/family-members/:memberId/emergency-contacts/:contactId', () => {
  test('returns 200 and updates contact', async () => {
    const payload = { relation: 'Sister' }

    const res = await request
      .patch(`/api/v1/family-members/${MEMBER_ID}/emergency-contacts/${CONTACT_ID}`)
      .set(AUTH)
      .send(payload)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(fakeContact({ relation: 'Sister' }))
    expect(mockUpdateEmergencyContact).toHaveBeenCalledWith(USER_ID, MEMBER_ID, CONTACT_ID, payload)
  })

  test('returns 404 for wrong member', async () => {
    mockUpdateEmergencyContact.mockRejectedValue(
      Object.assign(new Error('Emergency contact not found'), { status: 404, code: 'NOT_FOUND' })
    )

    const res = await request
      .patch(`/api/v1/family-members/${MEMBER_ID}/emergency-contacts/${CONTACT_ID}`)
      .set(AUTH)
      .send({ relation: 'Sister' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Emergency contact not found', code: 'NOT_FOUND' })
  })
})

describe('DELETE /api/v1/family-members/:memberId/emergency-contacts/:contactId', () => {
  test('returns 204 on success', async () => {
    const res = await request
      .delete(`/api/v1/family-members/${MEMBER_ID}/emergency-contacts/${CONTACT_ID}`)
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(res.body).toEqual({})
    expect(mockDeleteEmergencyContact).toHaveBeenCalledWith(USER_ID, MEMBER_ID, CONTACT_ID)
  })

  test('returns 404 for non-existent contact', async () => {
    mockDeleteEmergencyContact.mockRejectedValue(
      Object.assign(new Error('Emergency contact not found'), { status: 404, code: 'NOT_FOUND' })
    )

    const res = await request
      .delete(`/api/v1/family-members/${MEMBER_ID}/emergency-contacts/${CONTACT_ID}`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Emergency contact not found', code: 'NOT_FOUND' })
  })
})
