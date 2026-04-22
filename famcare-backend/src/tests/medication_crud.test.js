import { jest } from '@jest/globals'

const mockMedicationCreate = jest.fn()
const mockMedicationFindUnique = jest.fn()
const mockMedicationFindMany = jest.fn()
const mockMedicationUpdate = jest.fn()
const mockMedicationDelete = jest.fn()

const mockMedicationLogCreate = jest.fn()
const mockMedicationLogFindMany = jest.fn()
const mockMedicationLogFindUnique = jest.fn()
const mockMedicationLogGroupBy = jest.fn()

const mockMedicationScheduleFindMany = jest.fn()
const mockMedicationScheduleDeleteMany = jest.fn()
const mockMedicationScheduleCreate = jest.fn()

const mockTransaction = jest.fn()

const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockFindOrCreate = jest.fn()
const mockSendLinePushToUser = jest.fn()
const mockGetRecipients = jest.fn()

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
      findUnique: mockMedicationLogFindUnique,
      groupBy: mockMedicationLogGroupBy,
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
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

jest.unstable_mockModule('../services/linePushService.js', () => ({
  sendLinePushToUser: mockSendLinePushToUser,
}))

jest.unstable_mockModule('../services/medicationReminderDispatchService.js', () => ({
  getRecipients: mockGetRecipients,
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
    frequency: 'Daily',
    instructions: null,
    startDate: new Date('2026-04-01T00:00:00Z'),
    endDate: null,
    quantity: 10,
    lowStockThreshold: 3,
    lastLowStockAlertDate: null,
    photoUrl: null,
    reminderTimesJson: null,
    active: true,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockSendLinePushToUser.mockResolvedValue(undefined)
  mockGetRecipients.mockResolvedValue({ recipients: [] })
  mockMedicationScheduleDeleteMany.mockResolvedValue({ count: 0 })
  mockMedicationScheduleCreate.mockImplementation(async ({ data }) => ({
    id: `sched-${data.timeLocal}`,
    medicationId: data.medicationId,
    timeLocal: data.timeLocal,
  }))
  mockTransaction.mockImplementation(async (fn) => fn({
    medicationSchedule: {
      deleteMany: mockMedicationScheduleDeleteMany,
      create: mockMedicationScheduleCreate,
    },
  }))
})

describe('GET /api/v1/medications', () => {
  test('returns medications on success', async () => {
    mockMedicationFindMany.mockResolvedValue([fakeMedication()])

    const res = await request
      .get('/api/v1/medications')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(mockAssertCanReadMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
  })

  test('returns 403 when read access is denied', async () => {
    mockAssertCanReadMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get('/api/v1/medications')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
    expect(mockMedicationFindMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/medications/:id', () => {
  test('returns a medication when found', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(MEDICATION_ID)
  })

  test('returns 404 when medication is missing', async () => {
    mockMedicationFindUnique.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ code: 'NOT_FOUND', error: 'Medication not found' })
  })

  test('returns 403 when read access is denied', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockAssertCanReadMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
  })
})

describe('PATCH /api/v1/medications/:id', () => {
  test('supports partial updates', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationUpdate.mockResolvedValue(fakeMedication({ dosage: '2 pills' }))

    const res = await request
      .patch(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)
      .send({ dosage: '2 pills' })

    expect(res.status).toBe(200)
    expect(res.body.data.dosage).toBe('2 pills')
    expect(mockMedicationUpdate).toHaveBeenCalledWith({
      where: { id: MEDICATION_ID },
      data: { dosage: '2 pills' },
    })
  })

  test('supports toggling active', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationUpdate.mockResolvedValue(fakeMedication({ active: false }))

    const res = await request
      .patch(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)
      .send({ active: false })

    expect(res.status).toBe(200)
    expect(res.body.data.active).toBe(false)
    expect(mockMedicationUpdate).toHaveBeenCalledWith({
      where: { id: MEDICATION_ID },
      data: { active: false },
    })
  })
})

describe('DELETE /api/v1/medications/:id', () => {
  test('deletes a medication successfully', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationDelete.mockResolvedValue(fakeMedication())

    const res = await request
      .delete(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(mockMedicationDelete).toHaveBeenCalledWith({ where: { id: MEDICATION_ID } })
  })

  test('returns 404 when deleting a missing medication', async () => {
    mockMedicationFindUnique.mockResolvedValue(null)

    const res = await request
      .delete(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ code: 'NOT_FOUND', error: 'Medication not found' })
  })
})

describe('GET /api/v1/medications/:id/schedule', () => {
  test('returns medication schedules', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationScheduleFindMany.mockResolvedValue([
      { id: 'sched-08:00', medicationId: MEDICATION_ID, timeLocal: '08:00' },
      { id: 'sched-20:00', medicationId: MEDICATION_ID, timeLocal: '20:00' },
    ])

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/schedule`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      { id: 'sched-08:00', medicationId: MEDICATION_ID, timeLocal: '08:00' },
      { id: 'sched-20:00', medicationId: MEDICATION_ID, timeLocal: '20:00' },
    ])
  })
})

describe('PUT /api/v1/medications/:id/schedule', () => {
  test('sets schedule times', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())

    const res = await request
      .put(`/api/v1/medications/${MEDICATION_ID}/schedule`)
      .set(AUTH)
      .send({ times: ['08:00', '20:00'] })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      { id: 'sched-08:00', medicationId: MEDICATION_ID, timeLocal: '08:00' },
      { id: 'sched-20:00', medicationId: MEDICATION_ID, timeLocal: '20:00' },
    ])
    expect(mockMedicationScheduleDeleteMany).toHaveBeenCalledWith({ where: { medicationId: MEDICATION_ID } })
  })

  test('replaces existing times on update', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())

    const res = await request
      .put(`/api/v1/medications/${MEDICATION_ID}/schedule`)
      .set(AUTH)
      .send({ times: ['12:00'] })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      { id: 'sched-12:00', medicationId: MEDICATION_ID, timeLocal: '12:00' },
    ])
    expect(mockMedicationScheduleDeleteMany).toHaveBeenCalledTimes(1)
    expect(mockMedicationScheduleCreate).toHaveBeenCalledTimes(1)
  })

  test('clears times when passed an empty array', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())

    const res = await request
      .put(`/api/v1/medications/${MEDICATION_ID}/schedule`)
      .set(AUTH)
      .send({ times: [] })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(mockMedicationScheduleDeleteMany).toHaveBeenCalledWith({ where: { medicationId: MEDICATION_ID } })
    expect(mockMedicationScheduleCreate).not.toHaveBeenCalled()
  })

  test('rejects invalid time formats', async () => {
    const res = await request
      .put(`/api/v1/medications/${MEDICATION_ID}/schedule`)
      .set(AUTH)
      .send({ times: ['8am'] })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      error: 'Invalid time format: "8am". Expected "HH:mm"',
    })
    expect(mockMedicationFindUnique).not.toHaveBeenCalled()
  })
})
