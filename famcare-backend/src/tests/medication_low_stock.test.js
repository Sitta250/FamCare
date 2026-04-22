import { jest } from '@jest/globals'
import { bangkokCalendarDate } from '../utils/datetime.js'

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
const mockDispatchMedicationReminders = jest.fn()
const mockDispatchDueReminders = jest.fn()
const mockDispatchExpirationReminders = jest.fn()
const mockCronSchedule = jest.fn()

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
  dispatchMedicationReminders: mockDispatchMedicationReminders,
  getRecipients: mockGetRecipients,
}))

jest.unstable_mockModule('../services/reminderDispatchService.js', () => ({
  dispatchDueReminders: mockDispatchDueReminders,
}))

jest.unstable_mockModule('../services/insuranceService.js', () => ({
  dispatchExpirationReminders: mockDispatchExpirationReminders,
}))

jest.unstable_mockModule('node-cron', () => ({
  default: {
    schedule: mockCronSchedule,
  },
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: medicationsRouter } = await import('../routes/medications.js')
const { errorHandler } = await import('../middleware/errorHandler.js')
const { checkLowStockAlerts } = await import('../services/medicationService.js')
const { startCronJobs } = await import('../jobs/cron.js')

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
    frequency: null,
    instructions: null,
    startDate: new Date('2026-04-01T00:00:00Z'),
    endDate: null,
    quantity: 5,
    lowStockThreshold: 5,
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
  mockGetRecipients.mockResolvedValue({ recipients: ['U_owner_1'] })
  mockSendLinePushToUser.mockResolvedValue(undefined)
  mockMedicationUpdate.mockResolvedValue(fakeMedication())
})

describe('medication low-stock fields', () => {
  test('POST /api/v1/medications accepts lowStockThreshold', async () => {
    mockMedicationCreate.mockResolvedValue(fakeMedication())

    const res = await request
      .post('/api/v1/medications')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        name: 'Aspirin',
        quantity: 5,
        lowStockThreshold: 5,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.lowStockThreshold).toBe(5)
    expect(mockMedicationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lowStockThreshold: 5,
      }),
    }))
  })

  test('POST /api/v1/medications rejects negative lowStockThreshold', async () => {
    const res = await request
      .post('/api/v1/medications')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        name: 'Aspirin',
        lowStockThreshold: -1,
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'lowStockThreshold must be a non-negative integer' })
    expect(mockMedicationCreate).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/medications/:id rejects negative lowStockThreshold', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())

    const res = await request
      .patch(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)
      .send({ lowStockThreshold: -3 })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'lowStockThreshold must be a non-negative integer' })
    expect(mockMedicationUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lowStockThreshold: -3 }) })
    )
  })

  test('PATCH /api/v1/medications/:id updates lowStockThreshold', async () => {
    mockMedicationFindUnique.mockResolvedValue(fakeMedication())
    mockMedicationUpdate.mockResolvedValue(fakeMedication({ lowStockThreshold: 3 }))

    const res = await request
      .patch(`/api/v1/medications/${MEDICATION_ID}`)
      .set(AUTH)
      .send({ lowStockThreshold: 3 })

    expect(res.status).toBe(200)
    expect(res.body.data.lowStockThreshold).toBe(3)
    expect(mockMedicationUpdate).toHaveBeenCalledWith({
      where: { id: MEDICATION_ID },
      data: expect.objectContaining({ lowStockThreshold: 3 }),
    })
  })
})

describe('checkLowStockAlerts', () => {
  test('sends an alert and updates lastLowStockAlertDate when medication is at threshold', async () => {
    mockMedicationFindMany.mockResolvedValue([fakeMedication({ quantity: 5, lowStockThreshold: 5 })])

    await checkLowStockAlerts()

    expect(mockMedicationFindMany).toHaveBeenCalledWith({
      where: {
        active: true,
        quantity: { not: null },
        lowStockThreshold: { not: null },
        OR: [
          { lastLowStockAlertDate: null },
          { lastLowStockAlertDate: { not: expect.any(String) } },
        ],
      },
    })
    expect(mockGetRecipients).toHaveBeenCalledWith(MEMBER_ID)
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      'U_owner_1',
      '⚠️ ยาใกล้หมด: Aspirin เหลือ 5 เม็ด กรุณาจัดซื้อเพิ่ม'
    )
    expect(mockMedicationUpdate).toHaveBeenCalledWith({
      where: { id: MEDICATION_ID },
      data: { lastLowStockAlertDate: expect.any(String) },
    })
  })

  test('does not alert when medication is above threshold', async () => {
    mockMedicationFindMany.mockResolvedValue([fakeMedication({ quantity: 6, lowStockThreshold: 5 })])

    await checkLowStockAlerts()

    expect(mockSendLinePushToUser).not.toHaveBeenCalled()
    expect(mockMedicationUpdate).not.toHaveBeenCalled()
  })

  test('does not re-alert when already alerted today', async () => {
    mockMedicationFindMany.mockResolvedValue([fakeMedication({ lastLowStockAlertDate: bangkokCalendarDate() })])

    await checkLowStockAlerts()

    expect(mockSendLinePushToUser).not.toHaveBeenCalled()
    expect(mockMedicationUpdate).not.toHaveBeenCalled()
  })

  test('skips medications with null lowStockThreshold', async () => {
    mockMedicationFindMany.mockResolvedValue([fakeMedication({ lowStockThreshold: null })])

    await checkLowStockAlerts()

    expect(mockSendLinePushToUser).not.toHaveBeenCalled()
    expect(mockMedicationUpdate).not.toHaveBeenCalled()
  })

  test('skips inactive medications', async () => {
    mockMedicationFindMany.mockResolvedValue([fakeMedication({ active: false })])

    await checkLowStockAlerts()

    expect(mockSendLinePushToUser).not.toHaveBeenCalled()
    expect(mockMedicationUpdate).not.toHaveBeenCalled()
  })
})

describe('startCronJobs', () => {
  test('registers daily low-stock and insurance expiration cron jobs with Bangkok timezone', () => {
    startCronJobs()

    expect(mockCronSchedule).toHaveBeenCalledWith('* * * * *', expect.any(Function))
    expect(mockCronSchedule).toHaveBeenCalledWith(
      '0 8 * * *',
      expect.any(Function),
      { timezone: 'Asia/Bangkok' }
    )
    expect(mockCronSchedule).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function),
      { timezone: 'Asia/Bangkok' }
    )
  })
})
