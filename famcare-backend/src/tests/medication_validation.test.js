import { jest } from '@jest/globals'

const mockMedicationCreate = jest.fn()
const mockMedicationFindUnique = jest.fn()
const mockMedicationFindMany = jest.fn()
const mockMedicationUpdate = jest.fn()
const mockMedicationDelete = jest.fn()

const mockMedicationLogCreate = jest.fn()
const mockMedicationLogFindMany = jest.fn()

const mockMedicationScheduleFindMany = jest.fn()
const mockMedicationScheduleDeleteMany = jest.fn()
const mockMedicationScheduleCreate = jest.fn()

const mockTransaction = jest.fn()

const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockAssertOwnerForMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockFindOrCreate = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    medication: {
      create: mockMedicationCreate,
      findUnique: mockMedicationFindUnique,
      findMany: mockMedicationFindMany,
      update: mockMedicationUpdate,
      delete: mockMedicationDelete,
    },
    medicationLog: {
      create: mockMedicationLogCreate,
      findMany: mockMedicationLogFindMany,
    },
    medicationSchedule: {
      findMany: mockMedicationScheduleFindMany,
      deleteMany: mockMedicationScheduleDeleteMany,
      create: mockMedicationScheduleCreate,
    },
    $transaction: mockTransaction,
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
  assertCanWriteMember: mockAssertCanWriteMember,
  assertOwnerForMember: mockAssertOwnerForMember,
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: medicationsRouter } = await import('../routes/medications.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/medications', medicationsRouter)
app.use(errorHandler)

const request = supertest(app)

const USER_ID = 'user-1'
const LINE_ID = 'U_test_123'
const MEMBER_ID = 'member-abc'
const MEDICATION_ID = 'med-xyz'
const AUTH = { 'x-line-userid': LINE_ID }

function fakeMedication(overrides = {}) {
  return {
    id: MEDICATION_ID,
    familyMemberId: MEMBER_ID,
    addedByUserId: USER_ID,
    name: 'Aspirin',
    dosage: '1 pill',
    frequency: 'Once daily',
    instructions: null,
    startDate: new Date('2026-04-01T00:00:00Z'),
    endDate: null,
    quantity: 30,
    lowStockThreshold: null,
    lastLowStockAlertDate: null,
    photoUrl: null,
    reminderTimesJson: null,
    active: true,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  }
}

function fakeLog(overrides = {}) {
  return {
    id: 'log-1',
    medicationId: MEDICATION_ID,
    loggedByUserId: USER_ID,
    status: 'TAKEN',
    takenAt: new Date('2026-04-14T08:30:00Z'),
    createdAt: new Date('2026-04-14T08:30:10Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockTransaction.mockResolvedValue([])
})

describe('POST /api/v1/medications', () => {
  test('rejects missing name', async () => {
    const res = await request
      .post('/api/v1/medications')
      .set(AUTH)
      .send({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'name is required' })
    expect(mockAssertCanWriteMember).not.toHaveBeenCalled()
    expect(mockMedicationCreate).not.toHaveBeenCalled()
  })

  test('rejects missing familyMemberId', async () => {
    const res = await request
      .post('/api/v1/medications')
      .set(AUTH)
      .send({ name: 'Aspirin' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'familyMemberId is required' })
    expect(mockAssertCanWriteMember).not.toHaveBeenCalled()
    expect(mockMedicationCreate).not.toHaveBeenCalled()
  })

  test('accepts a valid payload', async () => {
    mockMedicationCreate.mockResolvedValue(fakeMedication())

    const res = await request
      .post('/api/v1/medications')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        name: 'Aspirin',
        dosage: '1 pill',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Aspirin')
    expect(mockAssertCanWriteMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
    expect(mockMedicationCreate).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/v1/medications/:id/logs', () => {
  test('rejects invalid status', async () => {
    const res = await request
      .post(`/api/v1/medications/${MEDICATION_ID}/logs`)
      .set(AUTH)
      .send({
        status: 'LATE',
        takenAt: '2026-04-14T08:30:00.000Z',
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'status must be one of TAKEN, MISSED, SKIPPED' })
    expect(mockMedicationFindUnique).not.toHaveBeenCalled()
    expect(mockMedicationLogCreate).not.toHaveBeenCalled()
  })

  test('rejects missing takenAt', async () => {
    const res = await request
      .post(`/api/v1/medications/${MEDICATION_ID}/logs`)
      .set(AUTH)
      .send({ status: 'TAKEN' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'takenAt is required' })
    expect(mockMedicationFindUnique).not.toHaveBeenCalled()
    expect(mockMedicationLogCreate).not.toHaveBeenCalled()
  })

  test('rejects non-parseable takenAt', async () => {
    const res = await request
      .post(`/api/v1/medications/${MEDICATION_ID}/logs`)
      .set(AUTH)
      .send({ status: 'TAKEN', takenAt: 'not-a-date' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'takenAt must be a valid ISO date string' })
    expect(mockMedicationFindUnique).not.toHaveBeenCalled()
    expect(mockMedicationLogCreate).not.toHaveBeenCalled()
  })

  test('accepts a valid payload', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationLogCreate.mockResolvedValue(fakeLog())

    const res = await request
      .post(`/api/v1/medications/${MEDICATION_ID}/logs`)
      .set(AUTH)
      .send({
        status: 'TAKEN',
        takenAt: '2026-04-14T08:30:00.000Z',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('TAKEN')
    expect(mockMedicationFindUnique).toHaveBeenCalledWith({ where: { id: MEDICATION_ID } })
    expect(mockAssertCanWriteMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
    expect(mockMedicationLogCreate).toHaveBeenCalledTimes(1)
  })
})
