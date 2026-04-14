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
    dosage: null,
    frequency: null,
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

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockTransaction.mockResolvedValue([])
})

describe('GET /api/v1/medications/:id/adherence', () => {
  test('returns null adherencePct for an empty window', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationLogGroupBy.mockResolvedValue([])

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/adherence`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(0)
    expect(res.body.data.adherencePct).toBeNull()
    expect(res.body.data).toMatchObject({
      medicationId: MEDICATION_ID,
      taken: 0,
      missed: 0,
      skipped: 0,
      total: 0,
    })
    expect(typeof res.body.data.from).toBe('string')
    expect(typeof res.body.data.to).toBe('string')
  })

  test('returns 100.0 when all logs are TAKEN', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationLogGroupBy.mockResolvedValue([
      { status: 'TAKEN', _count: { status: 4 } },
    ])

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/adherence`)
      .set(AUTH)
      .query({ from: '2026-01-01', to: '2026-01-31' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      medicationId: MEDICATION_ID,
      taken: 4,
      missed: 0,
      skipped: 0,
      total: 4,
      adherencePct: 100,
    })

    expect(mockMedicationLogGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['status'],
      where: expect.objectContaining({
        medicationId: MEDICATION_ID,
        takenAt: expect.any(Object),
      }),
    }))
  })

  test('returns correct counts and percentage for mixed statuses', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationLogGroupBy.mockResolvedValue([
      { status: 'TAKEN', _count: { status: 5 } },
      { status: 'MISSED', _count: { status: 1 } },
      { status: 'SKIPPED', _count: { status: 2 } },
    ])

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/adherence`)
      .set(AUTH)
      .query({ from: '2026-01-01', to: '2026-01-31' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      medicationId: MEDICATION_ID,
      taken: 5,
      missed: 1,
      skipped: 2,
      total: 8,
      adherencePct: 62.5,
    })
    expect(res.body.data.from).toBe('2026-01-01T00:00:00.000+07:00')
    expect(res.body.data.to).toBe('2026-01-31T23:59:00.000+07:00')
  })

  test('returns 403 when the user cannot read the family member', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockAssertCanReadMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/adherence`)
      .set(AUTH)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
    expect(mockMedicationLogGroupBy).not.toHaveBeenCalled()
  })

  test('returns 404 for a missing medication', async () => {
    mockMedicationFindUnique.mockResolvedValue(null)

    const res = await request
      .get('/api/v1/medications/missing-med/adherence')
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ code: 'NOT_FOUND', error: 'Medication not found' })
    expect(mockAssertCanReadMember).not.toHaveBeenCalled()
    expect(mockMedicationLogGroupBy).not.toHaveBeenCalled()
  })
})
