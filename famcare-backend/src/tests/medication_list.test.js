import { jest } from '@jest/globals'
import { utcInstantFromBangkokYmdHm } from '../utils/datetime.js'

const mockMedicationCreate = jest.fn()
const mockMedicationFindUnique = jest.fn()
const mockMedicationFindMany = jest.fn()
const mockMedicationUpdate = jest.fn()
const mockMedicationDelete = jest.fn()

const mockMedicationLogCreate = jest.fn()
const mockMedicationLogFindMany = jest.fn()
const mockMedicationLogFindUnique = jest.fn()

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

function fakeLog(overrides = {}) {
  return {
    id: 'log-1',
    medicationId: MEDICATION_ID,
    loggedByUserId: USER_ID,
    status: 'TAKEN',
    takenAt: new Date('2026-01-15T05:00:00.000Z'),
    createdAt: new Date('2026-01-15T05:00:05.000Z'),
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

describe('GET /api/v1/medications', () => {
  test('passes active=true through to the DB filter', async () => {
    mockMedicationFindMany.mockResolvedValue([fakeMedication({ active: true })])

    const res = await request
      .get('/api/v1/medications')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID, active: 'true' })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].active).toBe(true)
    expect(mockMedicationFindMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID, active: true },
      orderBy: { createdAt: 'asc' },
    })
  })

  test('preserves existing behavior when active is omitted', async () => {
    mockMedicationFindMany.mockResolvedValue([
      fakeMedication({ id: 'med-1', active: true }),
      fakeMedication({ id: 'med-2', active: false }),
    ])

    const res = await request
      .get('/api/v1/medications')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(mockMedicationFindMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('GET /api/v1/medications/:id/logs', () => {
  test('filters logs using Bangkok-local date boundaries', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationLogFindMany.mockResolvedValue([fakeLog()])

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/logs`)
      .set(AUTH)
      .query({ from: '2026-01-01', to: '2026-01-31' })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)

    const findArg = mockMedicationLogFindMany.mock.calls[0][0]
    expect(findArg.where.medicationId).toBe(MEDICATION_ID)
    expect(findArg.where.takenAt.gte).toEqual(utcInstantFromBangkokYmdHm('2026-01-01', '00:00'))
    expect(findArg.where.takenAt.lte).toEqual(utcInstantFromBangkokYmdHm('2026-01-31', '23:59'))
    expect(findArg.take).toBe(50)
    expect(findArg.orderBy).toEqual({ takenAt: 'desc' })
  })

  test('uses cursor pagination after validating the cursor row', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationLogFindUnique.mockResolvedValue({ id: 'log-cursor', medicationId: MEDICATION_ID })
    mockMedicationLogFindMany.mockResolvedValue([fakeLog({ id: 'log-next' })])

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/logs`)
      .set(AUTH)
      .query({ limit: '10', cursor: 'log-cursor' })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(mockMedicationLogFindUnique).toHaveBeenCalledWith({
      where: { id: 'log-cursor' },
      select: { id: true, medicationId: true },
    })
    expect(mockMedicationLogFindMany).toHaveBeenCalledWith({
      where: { medicationId: MEDICATION_ID },
      orderBy: { takenAt: 'desc' },
      take: 10,
      cursor: { id: 'log-cursor' },
      skip: 1,
    })
  })

  test('rejects an invalid cursor id', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationLogFindUnique.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/medications/${MEDICATION_ID}/logs`)
      .set(AUTH)
      .query({ cursor: 'missing-log' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'Invalid cursor' })
    expect(mockMedicationLogFindMany).not.toHaveBeenCalled()
  })
})
